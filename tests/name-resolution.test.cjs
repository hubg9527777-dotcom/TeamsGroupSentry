const {test}=require('node:test');
const assert=require('node:assert/strict');
const Names=require('../lib/name-core.js');
const Logic=require('../lib/logic.js');
globalThis.TGSNames=Names;
const UI=require('../lib/member-name-ui.js');
const {worker}=require('./worker-harness.cjs');
const self='8:live:cid.self-000001', alice='8:live:cid.alice-000001', bob='8:live:cid.bob-000001';

test('Teams 个人资料里的嵌套姓名按完整 ID 对应，不按人名或顺序推断',()=>{
 const records={value:{profiles:{[alice]:{displayName:'Alice 示例'},[bob]:{profile:{displayName:'Bob 示例'}}}}};
 const found=Names.extract(records,'profiles',new Set([alice,bob]));
 assert.deepEqual(Object.fromEntries(found.map(x=>[x.id,x.name])),{[alice]:'Alice 示例',[bob]:'Bob 示例'});
 assert.deepEqual(Names.extract({value:{contacts:[{displayName:'不能继承父 ID'}]}},alice,new Set([alice])),[]);
});

test('会话成员的 profileInfo 和 data 可以准确回填姓名，其他 ID 不借用姓名',()=>{
 const group={id:'19:group@thread.v2',isGroupChat:true,
  members:[{id:self},{id:alice,profileInfo:{displayName:'Alice 示例'}},{id:bob,data:{id:alice,displayName:'不应关联 Bob'}}]};
 const parsed=Logic.parseRecord(group);
 assert.equal(parsed.members[1].name,'Alice 示例');
 assert.equal(parsed.members[2].name,'');
});

test('个人资料中的同优先级冲突不能任意选一个姓名',()=>{
 const map=new Map(),stats={};
 Names.merge(map,{id:alice,name:'甲'},'Teams 用户资料缓存',90,stats);
 Names.merge(map,{id:alice,name:'乙'},'Teams 用户资料缓存',90,stats);
 assert.equal(map.get(alice).conflict,true);
 Names.merge(map,{id:alice,name:'丙'},'Teams 用户资料缓存',80,stats);
 assert.equal(map.get(alice).conflict,true);
});

function mockUI({id=alice,name='Alice 示例',extraId='',panel=true,visible=true}={}){
 const nameEl={textContent:name,isConnected:true,getClientRects:()=>visible?[{}]:[]};
 let entry;
 const row={isConnected:true,getClientRects:()=>visible?[{}]:[],getAttribute:()=>null,
  closest:selector=>selector.includes('[role="dialog"]')?(panel?{}:null):null,
  querySelectorAll:selector=>selector.includes('participant-name')?[nameEl]:
   [entry,...(extraId?[{getAttribute:attr=>attr==='data-mri'?extraId:null}]:[])]};
 entry={isConnected:true,getClientRects:()=>visible?[{}]:[],
  getAttribute:attr=>attr==='data-mri'?id:null,closest:()=>row};
 return {doc:{querySelectorAll:()=>[entry]}};
}
test('仅提取可见成员行中绑定了完整 ID 的姓名；不同人的 ID 不会误配',()=>{
 const {doc}=mockUI();
 assert.deepEqual(UI.inspect(doc,new Set([alice])),[{id:alice,name:'Alice 示例',source:'Teams 当前可见成员名单'}]);
 assert.deepEqual(UI.inspect(doc,new Set([bob])),[]);
 assert.deepEqual(UI.inspect(mockUI({extraId:bob}).doc,new Set([alice,bob])),[]);
 assert.deepEqual(UI.inspect(mockUI({panel:false}).doc,new Set([alice])),[]);
 assert.deepEqual(UI.inspect(mockUI({visible:false}).doc,new Set([alice])),[]);
});

test('后一次巡检能给旧的无姓名 NEW 身份补名，且不改变审核状态与原事件',async()=>{
 const w=worker();const p={rows:[{id:'19:one@thread.v2',quality:'CACHE_CONSISTENT',countOffset:0,members:[{id:self},{id:alice}]}],
  at:Date.now(),dbName:'Teams:conversation-manager:synthetic',stats:{databases:1,records:1,partial:false},
  trustedReader:'ISOLATED',accountHintSource:'ROSTER_INTERSECTION',tokenIdentity:null};
 // Install a self account using the same setup as the extension's real first-run flow.
 w.context.payload=p;
 const first=await w.run('ingest(payload,1)');
 const guard=await w.run('sessionGuard()');
 assert(guard.canBind);
 const confirmed=await w.message({action:'BIND_CURRENT',account:guard.account,selfId:self,last6:self.slice(-6),smallConfirmed:true});
 assert.equal(confirmed.ok,true);
 await w.run('ingest(payload,1)');
 p.rows[0].members.push({id:bob});p.rows[0].countOffset=0;p.at=Date.now();
 await w.run('ingest(payload,1)');
 let account=(await w.db.getMeta('active')).account;
 let person=(await w.db.getAllFor('people',account)).find(x=>x.id===bob);
 assert.equal(person.status,'NEW');assert.equal(person.name,'');
 const priorEvents=(await w.db.getAllFor('events',account)).length;
 p.nameHints=[{id:bob,name:'Bob 新显示的姓名',source:'Teams 用户资料缓存'}];p.at=Date.now();
 await w.run('ingest(payload,1)');
 person=(await w.db.getAllFor('people',account)).find(x=>x.id===bob);
 assert.equal(person.name,'Bob 新显示的姓名');assert.equal(person.status,'NEW');
 assert.equal((await w.db.getAllFor('events',account)).length,priorEvents);
});

test('成员姓名从界面获取后可以覆盖较弱的旧成员缓存姓名，但不改变 NEW 审核状态',async()=>{
 const w=worker();const groupId='19:ui-name-correction@thread.v2';
 const p={rows:[{id:groupId,quality:'CACHE_CONSISTENT',countOffset:0,members:[{id:self},{id:alice}]}],
  at:Date.now(),dbName:'Teams:conversation-manager:test-name-priority',stats:{databases:1,records:1,partial:false},
  trustedReader:'ISOLATED',accountHintSource:'ROSTER_INTERSECTION',tokenIdentity:null};
 w.context.payload=p;
 await w.run('ingest(payload,1)');
 const guard=await w.run('sessionGuard()');
 assert(guard.canBind);
 assert.equal((await w.message({action:'BIND_CURRENT',account:guard.account,selfId:self,last6:self.slice(-6),smallConfirmed:true})).ok,true);
 await w.run('ingest(payload,1)');
 p.rows[0].members.push({id:bob,name:'旧的群缓存姓名',nameSource:'members'});p.at=Date.now();
 await w.run('ingest(payload,1)');
 const account=(await w.db.getMeta('active')).account;
 let person=(await w.db.getAllFor('people',account)).find(x=>x.id===bob);
 assert.equal(person.name,'旧的群缓存姓名');assert.equal(person.status,'NEW');
 const eventsBefore=(await w.db.getAllFor('events',account)).length;
 p.nameHints=[{id:bob,name:'Teams 中实际显示的姓名',source:'Teams 当前可见成员名单'}];p.at=Date.now();
 await w.run('ingest(payload,1)');
 person=(await w.db.getAllFor('people',account)).find(x=>x.id===bob);
 assert.equal(person.name,'Teams 中实际显示的姓名');
 assert.equal(person.status,'NEW');
 assert.equal((await w.db.getAllFor('events',account)).length,eventsBefore);
});

test('可靠的用户资料姓名优先于界面提示；同级冲突提示不覆盖现有姓名',async()=>{
 const w=worker();const p={rows:[{id:'19:name-sources@thread.v2',quality:'CACHE_CONSISTENT',countOffset:0,
   members:[{id:self},{id:alice},{id:bob}]}],
  at:Date.now(),dbName:'Teams:conversation-manager:test-name-conflict',stats:{databases:1,records:1,partial:false},
  trustedReader:'ISOLATED',accountHintSource:'ROSTER_INTERSECTION',tokenIdentity:null};
 w.context.payload=p;
 await w.run('ingest(payload,1)');
 const guard=await w.run('sessionGuard()');
 assert.equal((await w.message({action:'BIND_CURRENT',account:guard.account,selfId:self,last6:self.slice(-6),smallConfirmed:true})).ok,true);
 p.nameHints=[{id:bob,name:'可信缓存姓名',source:'Teams 用户资料缓存'}];
 await w.run('ingest(payload,1)');
 const account=(await w.db.getMeta('active')).account;
 p.nameHints=[{id:bob,name:'页面较弱的姓名',source:'Teams 当前可见成员名单'},
              {id:bob,name:'可信缓存姓名',source:'Teams 用户资料缓存'}];p.at=Date.now();
 await w.run('ingest(payload,1)');
 let person=(await w.db.getAllFor('people',account)).find(x=>x.id===bob);
 assert.equal(person.name,'可信缓存姓名');
 p.nameHints=[{id:bob,name:'UI 甲',source:'Teams 当前可见成员名单'},
              {id:bob,name:'UI 乙',source:'Teams 当前可见成员名单'}];p.at=Date.now();
 await w.run('ingest(payload,1)');
 person=(await w.db.getAllFor('people',account)).find(x=>x.id===bob);
 assert.equal(person.name,'可信缓存姓名');
});

test('点重新查找姓名会跳过旧资料缓存；名单不要求用户通过 MRI 搜索',()=>{
 const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');
 const reader=fs.readFileSync(path.join(root,'lib/isolated-reader.js'),'utf8');
 const dashboard=fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
 const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
 assert.match(reader,/async function scan\(\{refreshProfiles=false\}=\{\}\)/);
 assert.match(reader,/const fresh=!refreshProfiles&&profileCache/);
 assert.match(dashboard,/function groupsForPerson\(personId\)/);
 assert.match(dashboard,/打开相关群/);
 assert.match(dashboard,/关联群记录：/);
 assert.doesNotMatch(content,/if\(!alreadyNamed\.has\(hint\.id\)/);
});

test('打开 Teams 群成员列表后立即补名：只改姓名，不改变本人审核或成员关系',async()=>{
 const w=worker();
 const p={rows:[{id:'19:visible-name@thread.v2',quality:'CACHE_CONSISTENT',countOffset:0,
   members:[{id:self},{id:alice},{id:bob}]}],
   at:Date.now(),dbName:'Teams:conversation-manager:ui-name',stats:{databases:1,records:1,partial:false},
   trustedReader:'ISOLATED',accountHintSource:'ROSTER_INTERSECTION',tokenIdentity:null};
 w.context.payload=p;await w.run('ingest(payload,1)');
 const guard=await w.run('sessionGuard()');
 assert.equal((await w.message({action:'BIND_CURRENT',account:guard.account,selfId:self,last6:self.slice(-6),smallConfirmed:true})).ok,true);
 await w.run('ingest(payload,1)');
 const account=(await w.db.getMeta('active')).account;
 const beforeEdges=(await w.db.getAllFor('edges',account)).length;
 const beforeEvents=(await w.db.getAllFor('events',account)).length;
 const sender={id:'unit',url:'https://teams.live.com/v2/',tab:{id:1},frameId:0};
 const r=await w.message({action:'SUPPLEMENT_VISIBLE_NAMES',hints:[{id:alice,name:'Teams 内的正确姓名'}],at:Date.now()},sender);
 assert.equal(r.ok,true);assert.equal(r.changed,1);
 const person=(await w.db.getAllFor('people',account)).find(x=>x.id===alice);
 assert.equal(person.name,'Teams 内的正确姓名');assert.equal(person.status,'LEGACY');
 assert.equal((await w.db.getAllFor('edges',account)).length,beforeEdges);
 assert.equal((await w.db.getAllFor('events',account)).length,beforeEvents);
 const unseen=await w.message({action:'SUPPLEMENT_VISIBLE_NAMES',hints:[{id:'8:live:cid.unseen',name:'不能创建新人'}],at:Date.now()},sender);
 assert.equal(unseen.ok,true);assert.equal(unseen.changed,0);
 assert.equal((await w.db.getAllFor('people',account)).length,3);
});

test('补名仅允许当前 Teams 标签页、当前已核实账号，拒绝冲突和其他标签页',async()=>{
 const w=worker();
 const p={rows:[{id:'19:name-scope@thread.v2',quality:'CACHE_CONSISTENT',countOffset:0,members:[{id:self},{id:alice}]}],
   at:Date.now(),dbName:'Teams:conversation-manager:name-scope',stats:{databases:1,records:1,partial:false},
   trustedReader:'ISOLATED',accountHintSource:'ROSTER_INTERSECTION',tokenIdentity:null};
 w.context.payload=p;await w.run('ingest(payload,1)');
 const g=await w.run('sessionGuard()');
 assert.equal((await w.message({action:'BIND_CURRENT',account:g.account,selfId:self,last6:self.slice(-6),smallConfirmed:true})).ok,true);
 await w.run('ingest(payload,1)');
 const sender={id:'unit',url:'https://teams.live.com/v2/',tab:{id:99},frameId:0};
 let r=await w.message({action:'SUPPLEMENT_VISIBLE_NAMES',at:Date.now(),hints:[{id:alice,name:'不准跨标签页'}]},sender);
 assert.equal(r.ok,false);
 sender.tab.id=1;
 r=await w.message({action:'SUPPLEMENT_VISIBLE_NAMES',at:Date.now(),hints:[{id:alice,name:'甲'},{id:alice,name:'乙'}]},sender);
 assert.equal(r.ok,false);
 const account=(await w.db.getMeta('active')).account;
 const person=(await w.db.getAllFor('people',account)).find(x=>x.id===alice);
 assert.equal(person.name,'');
});
