const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/request-cache.js');
const row=(extra={})=>({id:'19:synthetic@thread.v2',type:'Chat',memberProperties:{relationshipState:{inQuarantine:true}},members:[{id:'8:synthetic'}],threadProperties:{},chatTitle:{longTitle:'虚构会话'},...extra});
const msg=(extra={})=>({id:'100',version:'1',content:'hello',contenttype:'Text',messagetype:'RichText/Html',imdisplayname:'王六',from:'8:synthetic',fromUserId:'8:synthetic',composetime:'2026-10-16T00:00:00Z',...extra});
const doc={createElement:()=>{let text='';return {set innerHTML(s){text=s;},content:{get textContent(){return text;},querySelectorAll:()=>[]}};}};
test('隔离请求从真实形状末条读取作者正文，不需请求 DOM',()=>{const d=C.project(row({lastMessage:msg()}),doc);assert.equal(d.messages[0].text,'hello');assert.equal(d.messages[0].author,'王六');assert.equal(d.name,'');assert.equal(d.origin,'CACHE');assert(d.messageRevision.includes('100'));assert(!JSON.stringify(d).includes('8:synthetic'));});
test('普通会话、未知类型、人员 ID 均不产生缓存请求',()=>{for(const v of [row({memberProperties:{}}),row({type:'Group'}),row({id:'8:synthetic'})])assert.equal(C.project(v,doc),null);});
test('缺正文仍提示，作者不对应、删除、非文字、本人末条不输出正文',()=>{for(const v of [row(),row({lastMessage:msg({from:'8:other',fromUserId:'8:other'})}),row({lastMessage:msg({deletionInfo:{}})}),row({lastMessage:msg({contenttype:'Image'})}),row({lastMessage:msg(),threadProperties:{isLastMessageFromMe:true}})])assert.equal(C.project(v,doc).messages.length,0);});
test('会议作者不当邀请者，冲突作者 ID 拒绝关联',()=>{const d=C.project(row({type:'Meeting',lastMessage:msg()}),doc);assert.equal(d.kind,'MEETING');assert.equal(d.name,'');assert.equal(d.messages[0].author,'王六');assert.equal(C.project(row({members:[{id:'8:a'},{id:'8:b'}],lastMessage:msg({from:'8:a',fromUserId:'8:b'})}),doc).messages.length,0);});
test('不访问凭据和消息容器字段，限长并清理方向符',()=>{const m=msg({content:'a'.repeat(400),imdisplayname:'王\u202e六'});for(const k of ['token','fromDisplayNameInToken','properties'])Object.defineProperty(m,k,{get(){throw Error('forbidden');}});const v=row({lastMessage:m});Object.defineProperty(v,'messages',{get(){throw Error('unsupported');}});const d=C.project(v,doc);assert.equal(d.messages[0].text.length,300);assert.equal(d.messages[0].author,'王 六');});
test('无缓存和多缓存不打开记录，避免跨账号正文混用',async()=>{for(const count of [0,2]){const idb={databases:async()=>Array.from({length:count},(_,i)=>({name:'Teams:conversation-manager:synthetic'+i})),open(){throw Error('must not open');}};const r=await C.scan(idb,doc);assert.equal(r.details.length,0);assert.equal(r.status,count?'AMBIGUOUS_SCOPE':'NO_CACHE');}});
test('数据库错误不阻塞 DOM 请求提醒',async()=>{const r=await C.scan({databases:async()=>{throw Error('unavailable');}},doc);assert.equal(r.status,'UNAVAILABLE');assert.deepEqual(r.details,[]);});

test('绑定完整本人 ID 后排除本人末条，绝不按相同姓名排除别人',()=>{
 const v=row({lastMessage:msg()});assert.equal(C.project(v,doc,'8:synthetic'),null);
 assert(C.project(v,doc,'8:other').messages.length===1);
 const conflict=row({members:[{id:'8:synthetic'},{id:'8:other'}],lastMessage:msg({fromUserId:'8:other'})});
 assert.equal(C.isSelfMessage(conflict,'8:synthetic'),false);
 assert.equal(C.isSelfMessage(row({lastMessage:msg({fromUserId:'8:not-in-roster'})}),'8:synthetic'),false);
});

test('缓存只能补充同一当前请求，其他隔离缓存不能混入',()=>{
 const a=C.project(row({lastMessage:msg()}),doc),other={...a,key:'old-thread'};
 const snap={observed:true,source:'VISIBLE_ROWS',keys:[a.key],details:[{...a,messages:[]}]};
 const r=C.supplement(snap,[a,other],new Map());assert.equal(r.details.length,1);assert.equal(r.details[0].messages[0].text,'hello');
 const again=C.supplement(snap,[a],new Map([[a.key,r.details[0]]]));assert.equal(again.details[0].origin,'CACHE');
 assert.deepEqual(C.supplement({...snap,observed:false,source:'NONE',count:0},[a],new Map()).details,[]);
 assert.deepEqual(C.supplement({observed:true,source:'BADGE',count:1,keys:[],details:[]},[a],new Map()).details,[]);
});
test('已经取得的预览多条保留，末条缓存独立供小栏使用，最多十条',()=>{
 const cache=C.project(row({lastMessage:msg({content:'最新缓存'})}),doc);
 const messages=Array.from({length:8},(_,i)=>({author:'王六',text:'可见消息'+i}));
 const r=C.supplement({observed:true,keys:[cache.key],details:[{...cache,messages}]},[cache],new Map()).details[0];
 assert.equal(r.messages.length,9);assert.equal(r.messages[0].text,'可见消息0');assert.equal(r.latestMessage.text,'最新缓存');
 const N=require('../lib/request-notice.js');const d={...r,key:'a'.repeat(64)};delete d.messageRevision;
 const n=N.view(N.evolve(null,{adapter:'TEAMS_REQUEST_SIGNAL_V1',observed:true,source:'VISIBLE_ROWS',count:1,meeting:false,fingerprint:'b'.repeat(64),details:[d]},1));
 assert(n.compactReason.includes('最新缓存'));assert(!n.compactReason.includes('可见消息0'));assert(n.detailText.includes('可见消息0'));
});
