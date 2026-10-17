const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto'),{worker,root}=require('./worker-harness.cjs');
const N=require('../lib/request-notice.js');
const token='a'.repeat(64),fp='b'.repeat(64),fp2='c'.repeat(64);
const evidence=(extra={})=>({adapter:'TEAMS_REQUEST_SIGNAL_V1',observed:true,fingerprint:fp,source:'VISIBLE_ROWS',count:1,meeting:false,...extra});
const page=(id=11,documentId='doc-A')=>({id:'unit',url:'https://teams.live.com/v2/',frameId:0,tab:{id},documentId});
function setup(){const w=worker(),tabs=[{id:11,url:'https://teams.live.com/v2/'},{id:22,url:'https://teams.live.com/v2/'}],tokens={11:token,22:'d'.repeat(64)},sent=[];let active=11;
 w.chrome.tabs.query=async q=>q.active?tabs.filter(t=>t.id===active):tabs;
 w.chrome.tabs.sendMessage=async(id,msg,options)=>{sent.push({id,msg,options});return msg.action==='REQUEST_NOTICE_CONTEXT'?{token:tokens[id]}:{ok:true};};
 return {...w,sent,tokens,setActive:id=>active=id,push:(extra={},sender=page())=>w.message({action:'REQUEST_UI_NOTICE',token:tokens[sender.tab.id],evidence:evidence(extra)},sender)};}
const deadline=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('waited for group scan')),400);})]);}finally{clearTimeout(timer);}};
test('请求变化独立提交，群巡检队列永久阻塞也可通知，不写入身份表',async()=>{const w=setup();w.run('queue=new Promise(()=>{})');assert.equal((await deadline(w.push())).ok,true);await new Promise(setImmediate);
 assert(w.sent.some(x=>x.msg.action==='REQUEST_NOTICE_CHANGED'&&x.msg.notice.pending));
 for(const table of ['groups','people','edges','events','meta'])assert.equal(w.db.tables[table].size,0);
 const s=await w.message({action:'REQUEST_NOTICE_STATUS'});assert(s.requestNotice.pending);assert.match(s.requestNotice.compactReason,/先预览，核实后再接受/);assert.equal(s.requestNotice.tabId,11);
});
test('会议邀请只说请求待核实，缺 ID/正文不会自动成为好友或冒充',async()=>{const w=setup();await w.push({meeting:true});const s=await w.message({action:'REQUEST_NOTICE_STATUS'});assert.match(s.requestNotice.headline,/会议聊天请求待核实/);assert(!/疑似冒充|陌生好友/.test(s.requestNotice.headline));assert.equal(s.requestNotice.personId,undefined);});
test('入口徽标或混合多行不会把全部请求误称为会议邀请',()=>{for(const o of [evidence({source:'BADGE',meeting:true,count:5}),evidence({meeting:true,count:2})])assert.match(N.view(N.evolve(null,o,10)).headline,/^聊天请求待核实/);});
test('同一当前请求不叠加；没有界面证据即撤下提醒，不接受或批准身份',()=>{let p=N.evolve(null,evidence(),10);p=N.evolve(p,evidence(),20);assert.equal(p.revision,1);p=N.evolve(p,evidence({observed:false,source:'NONE',count:0}),30);assert.equal(p.pending,false);assert.equal(p.details.length,0);assert.equal(N.view(p).pending,false);});
test('已查看只收起本地提示，新证据才重新提醒，不批准任何人员',async()=>{const w=setup();await w.push();const s=(await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice;
 assert((await w.message({action:'ACK_REQUEST_UI_NOTICE',revision:s.revision,tabId:s.tabId,token:s.token})).ok);
 await w.push();assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,false);
 await w.push({fingerprint:fp2,count:2});assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,true);
 assert.equal(w.db.tables.people.size,0);assert.equal(w.db.tables.events.size,0);
});
test('旧提醒不能收起更新后的请求变化',async()=>{const w=setup();await w.push();const s=(await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice;await w.push({fingerprint:fp2});const r=await w.message({action:'ACK_REQUEST_UI_NOTICE',revision:s.revision,tabId:11,token});assert.equal(r.ok,false);assert((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending);});
test('两个 Teams 页签/账号不共用请求提醒，切换页面文档不能沿用旧观察',async()=>{const w=setup();await w.push();w.setActive(22);assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,false);
 assert.equal((await w.message({action:'OVERLAY_STATUS'},page(11,'new-document'))).requestNotice.pending,false);
 await w.push({fingerprint:fp2,count:2},page(22,'doc-B'));assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.count,2);
 assert.equal((await w.message({action:'OVERLAY_STATUS'},page())).requestNotice.count,1);
 w.tokens[11]='e'.repeat(64);w.setActive(11);assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,false);
});
test('错误来源、子框架、非法证据、会话 ID 冒充人员不会进入独立提醒',async()=>{const w=setup();for(const sender of [{...page(),id:'foreign'},{...page(),frameId:1},{...page(),url:'https://example.com'}])assert.equal(await w.push({},sender),undefined);
 for(const e of [{count:-1},{fingerprint:'19:meeting_test@thread.v2'},{observed:false},{source:'GUESS'}])assert.equal((await w.push(e)).ok,false);
 assert.equal(Object.keys(w.session).length,0);
});
test('后台 worker 重启保留本次会话提醒，完整浏览器重启重新观察不声称新消息',async()=>{const w=setup();await w.push();const again=setup();Object.assign(again.session,structuredClone(w.session));assert((await again.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending);
 const browserRestart=setup();assert.equal((await browserRestart.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,false);await browserRestart.push();const n=(await browserRestart.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice;assert(n.pending);assert(!/新消息|刚收到/.test(n.headline+n.reason));
});
test('空缓存/只读账号仍有界面提示，不能绕过身份审核动作',async()=>{const w=setup();w.session['tgs-v33-guard-state']={mode:'READ_ONLY',account:'B'};await w.push();const s=await w.message({action:'OVERLAY_STATUS'},page());assert(s.requestNotice.pending);assert.equal(w.db.tables.people.size,0);assert.equal(await w.message({action:'REVIEW_CONTACT_REQUEST',decision:'VERIFY'},page()),undefined);});
test('提醒只保存白名单字段，不保存名字/正文/ID；投递绑定当前文档',async()=>{const w=setup();await w.push({name:'Private Name',personId:'8:private',message:'private-body',secret:'token'});await new Promise(setImmediate);const saved=JSON.stringify(w.session);assert(!/Private Name|8:private|private-body|secret/.test(saved));const signal=w.sent.find(x=>x.msg.action==='REQUEST_NOTICE_CHANGED');assert.equal(signal.options.documentId,'doc-A');});

async function simulatedContent(cache=null){
 let now=0,nextId=0,mutation,hasRequest=false,groupStarted=false;const timers=new Map(),calls=[];
 const enqueue=(fn,ms=0)=>{const id=++nextId;timers.set(id,{fn,at:now+ms});return id;};
 const window={addEventListener(){},postMessage(){}};window.top=window;
 const document={body:{},visibilityState:'visible',addEventListener(){}};
 const context=vm.createContext({window,document,location:{origin:'https://teams.live.com'},Date:class extends Date{static now(){return 1700000000000+now;}},
  crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:async(_algorithm,bytes)=>createHash('sha256').update(Buffer.from(bytes)).digest()}},TextEncoder,setTimeout:enqueue,clearTimeout:id=>timers.delete(id),setInterval:()=>1,
  MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},
  indexedDB:{},TGSRequestCache:cache?{supplement:require('../lib/request-cache.js').supplement,scan:()=>cache==='HANG'?new Promise(()=>{}):Promise.resolve({status:'OK',details:cache})}:undefined,
  TGSIsolatedReader:{scan:()=>{groupStarted=true;return new Promise(()=>{});}},
  TGSRequestUI:{inspectSignal:()=>({observed:hasRequest,source:hasRequest?'VISIBLE_ROWS':'NONE',count:hasRequest?1:0,meeting:false,keys:hasRequest?['synthetic-thread']:[],details:hasRequest?[{key:'synthetic-thread',title:'虚构请求',kind:'CHAT',name:'',previewAvailable:false,messages:[]}]:[]})},
  chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{calls.push({at:now,...msg});return {ok:true};}}}});
 vm.runInContext(fs.readFileSync(path.join(root,'content.js'),'utf8'),context);
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
 const advance=async end=>{await flush();while(true){const pair=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!pair)break;timers.delete(pair[0]);now=pair[1].at;pair[1].fn();await flush();}now=end;};
 await advance(3000);hasRequest=true;mutation();await advance(3400);hasRequest=false;mutation();await advance(3900);
 return {calls,groupStarted};
}
test('实际 content 调度：群缓存悬挂时，UI 请求变化在模拟 250ms 提交',async()=>{const r=await simulatedContent();assert(r.groupStarted);const notice=r.calls.find(c=>c.action==='REQUEST_UI_NOTICE'&&c.evidence.observed);assert(notice);assert.equal(notice.at-3000,250);assert(!r.calls.some(c=>c.action==='INGEST'));assert.equal(notice.evidence.keys,undefined);assert.equal(notice.evidence.count,1);});

const displayDetail=(extra={})=>({key:'f'.repeat(64),title:'王六',name:'王六',kind:'CHAT',previewAvailable:false,officialWarning:true,messages:[{author:'王六',text:'你好，请核实我是谁。'}],...extra});
test('红色请求提醒展示姓名与正文，缺 ID 不会认定陌生 ID 或冒充',async()=>{const w=setup();await w.push({details:[displayDetail()]});const n=(await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice;
 assert.equal(n.severity,'HIGH');assert.match(n.detailText,/王六.*想和你聊天/);assert.match(n.detailText,/你好，请核实/);assert.match(n.compactReason,/王六/);assert.match(n.identityNote,/已读取.*ID：待核实/);assert.equal(w.db.tables.people.size,0);
 const saved=JSON.stringify(w.session);assert.match(saved,/你好，请核实/);assert.equal(w.db.tables.events.size,0);});
test('会议发起人与消息作者分别保留，会议标题不能当作人员姓名',()=>{const n=N.view(N.evolve(null,evidence({meeting:true,details:[displayDetail({title:'虚构会议',name:'已停用帐户',kind:'MEETING',messages:[{author:'另外的人',text:'这是另一成员的消息'}]})]}),1));
 assert.match(n.detailText,/已停用帐户 邀请你/);assert.match(n.detailText,/另外的人：“这是/);assert(!n.detailText.includes('已停用帐户：“这是'));});
test('姓名正文仅保存限定显示字段，不接收任何附加身份或凭据',async()=>{const w=setup();const d={...displayDetail(),personId:'8:private',token:'credential-value',messages:[{author:'王六',text:'hi',secret:'private-secret'}]};await w.push({details:[d]});
 assert(!/8:private|credential-value|private-secret/.test(JSON.stringify(w.session)));});
test('过长、控制字符、伪造键、过多消息均拒绝，不覆盖已有提示',async()=>{const w=setup();await w.push();for(const d of [displayDetail({key:'19:bad@thread.v2'}),displayDetail({name:'a'.repeat(121)}),displayDetail({name:'王\u202e六'}),displayDetail({messages:[{author:'王六',text:'x'.repeat(301)}]}),displayDetail({messages:[1,2,3]})]){
 assert.equal((await w.push({details:[d]})).ok,false);}assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.count,1);});
test('预览摘录随 worker 重启保留，但不进入其他账号或长期数据库',async()=>{const w=setup();await w.push({details:[displayDetail()]});const again=setup();Object.assign(again.session,structuredClone(w.session));assert.match((await again.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.detailText,/王六/);
 again.setActive(22);assert.equal((await again.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,false);for(const t of ['people','groups','events','meta'])assert.equal(w.db.tables[t].size,0);});

test('正文暂不可得时明确引导预览，不能直接接受',()=>{const n=N.view(N.evolve(null,evidence({details:[displayDetail({messages:[]})]}),1));assert.match(n.advice,/预览他们的消息/);assert.match(n.advice,/不要.*直接点「接受」/);assert.match(n.advice,/核实身份后再决定是否接受/);});
test('缓存作者不当作会议邀请者，标注缓存来源与滞后',async()=>{const w=setup();await w.push({source:'VISIBLE_ROWS',details:[displayDetail({origin:'CACHE',messageStamp:'1'.repeat(64),name:'',kind:'MEETING',title:'虚构会议'})]});const n=(await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice;assert.match(n.identityNote,/本地缓存/);assert.match(n.reason,/当前可见请求/);assert.match(n.detailText,/发起者待核实/);assert.doesNotMatch(n.detailText,/王六 邀请/);assert.equal(w.db.tables.events.size,0);});

test('实际 content：有历史缓存、没有请求界面时绝不生成缓存请求警示',async()=>{
 const r=await simulatedContent([{key:'old-thread',title:'历史缓存',kind:'CHAT',name:'',origin:'CACHE',previewAvailable:false,messages:[{author:'历史姓名',text:'不应出现'}]}]);
 assert(!r.calls.some(x=>x.action==='REQUEST_UI_NOTICE'&&x.evidence.source==='CACHE'));
 assert(!r.calls.some(x=>x.action==='REQUEST_UI_NOTICE'&&JSON.stringify(x.evidence).includes('不应出现')));
 assert(!r.calls.some(x=>x.action==='REQUEST_UI_NOTICE'&&x.evidence.observed&&x.at<3000));
});
test('实际 content：缓存读取悬挂仍不拖延独立 DOM 警报',async()=>{const r=await simulatedContent('HANG');const n=r.calls.find(x=>x.action==='REQUEST_UI_NOTICE'&&x.evidence.observed);assert(n);assert.equal(n.at,3250);});

test('旧 CACHE 会话记录立即不显示，新缓存来源拒绝入库；不删除身份审核',async()=>{
 const w=setup();assert.equal(N.view({pending:true,visible:true,source:'CACHE',details:[displayDetail()]}).pending,false);
 assert.equal((await w.push({source:'CACHE',details:[displayDetail()]})).ok,false);
 await w.push({details:[displayDetail()]});await w.push({observed:false,source:'NONE',count:0,details:[]});
 assert.equal((await w.message({action:'REQUEST_NOTICE_STATUS'})).requestNotice.pending,false);
 for(const table of ['people','groups','events'])assert.equal(w.db.tables[table].size,0);
});
test('两条请求正文与收起摘要均按 1、2 编号，不重复安全段落',()=>{
 const n=N.view(N.evolve(null,evidence({count:2,details:[displayDetail(),displayDetail({key:'3'.repeat(64),name:'李四',title:'李四',messages:[]})]}),1));
 assert.match(n.detailText,/^1\./);assert.match(n.detailText,/\n\n2\./);assert.match(n.compactReason,/^1\./);assert.match(n.compactReason,/\n2\./);
 assert(!n.detailText.includes('切勿共享'));assert.match(n.advice,/切勿共享/);assert.match(n.advice,/预览他们的消息/);
});
test('本人查询只按已批准缓存范围返回已确认 ID，不使用全局活动账号',async()=>{
 const w=setup(),digest='9'.repeat(64),account='verified:synthetic-A',self='8:live:self123456';
 assert.equal((await w.message({action:'REQUEST_SELF_CONTEXT',scopeDigest:digest},page())).selfId,'');
 await w.db.putMeta({pk:'account-cache-scope:'+digest.slice(0,32),approved:true,account});
 await w.db.putMeta({pk:'account:'+account,verified:true,manualBound:true,manualSelfId:self});
 assert.equal((await w.message({action:'REQUEST_SELF_CONTEXT',scopeDigest:digest},page())).selfId,self);
 assert.equal((await w.message({action:'REQUEST_SELF_CONTEXT',scopeDigest:'8'.repeat(64)},page())).selfId,'');
 assert.equal(await w.message({action:'REQUEST_SELF_CONTEXT',scopeDigest:digest},{...page(),frameId:1}),undefined);
 await w.db.putMeta({pk:'account:'+account,verified:true,manualBound:false,manualSelfId:self});
 assert.equal((await w.message({action:'REQUEST_SELF_CONTEXT',scopeDigest:digest},page())).selfId,'');
});

test('实际 content：请求界面消失后发送空观察，历史缓存不能维持旧警示',async()=>{
 const r=await simulatedContent([{key:'synthetic-thread',title:'虚构请求',kind:'CHAT',name:'',origin:'CACHE',previewAvailable:false,messages:[{author:'王六',text:'缓存摘要'}]}]);
 const signals=r.calls.filter(x=>x.action==='REQUEST_UI_NOTICE');const live=signals.findIndex(x=>x.evidence.observed);
 assert(live>=0);const cleared=signals.slice(live+1).find(x=>!x.evidence.observed);assert(cleared);assert.equal(cleared.evidence.details.length,0);
});
