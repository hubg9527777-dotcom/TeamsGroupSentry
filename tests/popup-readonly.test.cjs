const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const src=fs.readFileSync(path.join(__dirname,'../popup/popup.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function boot(summary,confirms=true){
 const elements=new Map(),sent=[],opened=[];
 function el(id){if(!elements.has(id))elements.set(id,{id,textContent:'',hidden:false,disabled:false,value:'always',classList:{classes:new Set(),toggle(name,on){if(on)this.classes.add(name);else this.classes.delete(name);},contains(name){return this.classes.has(name);}},
   dataset:{destination:{statGroups:'groups',statPeople:'people',statUnknown:'review',statEvents:'events'}[id]},
   handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},click(){this.handlers.click?.();}});return elements.get(id);}
 const chrome={runtime:{getURL:s=>'chrome-extension://extension/'+s,sendMessage:async msg=>{
   sent.push(msg);
   if(msg.action==='SUMMARY')return typeof summary==='function'?summary():summary;
   if(msg.action==='OVERLAY_STATUS')return {ok:true,prefs:{mode:'always'}};
   if(msg.action==='BIND_CURRENT')return {ok:true};
   if(msg.action==='SCAN_NOW')return {ok:true,scanned:400,readOnly:false};
   return {ok:true};
 }},tabs:{create:o=>opened.push(o),query:async()=>[]}};
 const context={document:{body:el('body'),getElementById:el,querySelectorAll:selector=>selector==='.stat-link'?
   ['statGroups','statPeople','statUnknown','statEvents'].map(el):[]},
   chrome,Date,console,URLSearchParams,confirm:()=>confirms,window:{close:()=>{}}};
 vm.runInNewContext(src,context,{filename:'popup.js'});
 return {el,sent,opened};
}
const guard={mode:'READ_ONLY',inspected:400,compared:0,canBind:true,account:'verified:'+'a'.repeat(32),at:Date.now(),reason:'当前身份尚未绑定本地基线',noBaseline:true};
test('popup displays scanned 400 in read-only mode even when persistent active baseline absent',async()=>{
 const {el}=boot({ok:true,guard,active:null,counts:null});await tick();
 assert.equal(el('groups').textContent,'400');assert.equal(el('groupsLabel').textContent,'本次缓存观察群（只读）');
 assert.equal(el('persons').textContent,'—');assert.equal(el('identityAction').hidden,false);
 assert.match(el('status').textContent,/400 群缓存/);assert.match(el('status').textContent,/不能认为正在提供完整新增预警/);
});
test('popup never shows previous account counts if current read-only identity differs',async()=>{
 const {el}=boot({ok:true,guard,active:{account:'verified:'+'b'.repeat(32),at:Date.now()},counts:{groups:450,people:3000,newUnknown:65,openUrgent:20}});
 await tick();assert.equal(el('groups').textContent,'400');assert.equal(el('persons').textContent,'—');
 assert.equal(el('events').textContent,'—');
});
test('popup normal mode retains indexed group and people counts',async()=>{
 const {el}=boot({ok:true,guard:{mode:'WRITE'},active:{account:guard.account,at:Date.now()},counts:{groups:400,people:819,newUnknown:6,openUrgent:2}});
 await tick();assert.equal(el('groups').textContent,'400');assert.equal(el('persons').textContent,'819');
 assert.equal(el('groupsLabel').textContent,'已索引群组');assert.equal(el('identityAction').hidden,true);
});
test('account confirmation uses explicit action and scans after bind, no implicit baseline writes',async()=>{
 const {el,sent}=boot({ok:true,guard,active:null,counts:null});await tick();
 assert.equal(sent.some(x=>x.action==='BIND_CURRENT'),false);
 await el('bindCurrent').onclick();await tick();
 assert.deepEqual(sent.filter(x=>['BIND_CURRENT','SCAN_NOW'].includes(x.action)).map(x=>x.action),['BIND_CURRENT','SCAN_NOW']);
 assert.match(el('scanFeedback').textContent,/400 群索引/);
});
test('declined account confirmation never writes a binding',async()=>{
 const {el,sent}=boot({ok:true,guard,active:null,counts:null},false);await tick();
 await el('bindCurrent').onclick();assert.equal(sent.some(x=>x.action==='BIND_CURRENT'),false);
});

test('all popup summary cards open the intended dashboard views with correct filters',async()=>{
 const {el,opened}=boot({ok:true,guard:{mode:'WRITE'},active:{account:guard.account,at:Date.now()},
   counts:{groups:401,people:820,newUnknown:1,openUrgent:0}});
 await tick();
 for(const id of ['statGroups','statPeople','statUnknown','statEvents'])el(id).click();
 assert.equal(opened.length,4);
 assert.deepEqual(opened.map(o=>new URL(o.url).search),[
   '?page=groups&filter=all', '?page=people&filter=all',
   '?page=review&filter=NEW','?page=events&filter=urgent']);
});

test('new identity pending paints only relevant card and global alert header red',async()=>{
 const {el}=boot({ok:true,guard:{mode:'WRITE'},active:{account:guard.account,at:Date.now()},
   counts:{groups:401,people:821,newUnknown:1,openUrgent:0}});
 await tick();
 assert.equal(el('alertBanner').hidden,false);
 assert.equal(el('body').classList.contains('has-alert'),true);
 assert.equal(el('statUnknown').classList.contains('needs-attention'),true);
 assert.equal(el('statEvents').classList.contains('needs-attention'),false);
 assert.match(el('alertDetail').textContent,/新身份待审 1 · 重要未处理 0/);
});
test('urgent event alone turns popup red and highlights important events card',async()=>{
 const {el}=boot({ok:true,guard:{mode:'WRITE'},active:{account:guard.account,at:Date.now()},
   counts:{groups:401,people:821,newUnknown:0,openUrgent:3}});
 await tick();
 assert.equal(el('body').classList.contains('has-alert'),true);
 assert.equal(el('statUnknown').classList.contains('needs-attention'),false);
 assert.equal(el('statEvents').classList.contains('needs-attention'),true);
});
test('normal counts remove all red styles',async()=>{
 const {el}=boot({ok:true,guard:{mode:'WRITE'},active:{account:guard.account,at:Date.now()},
   counts:{groups:401,people:821,newUnknown:0,openUrgent:0}});
 await tick();
 assert.equal(el('body').classList.contains('has-alert'),false);
 assert.equal(el('alertBanner').hidden,true);
});
test('read-only account mismatch does not show previous account red status',async()=>{
 const {el}=boot({ok:true,guard,active:{account:'verified:'+'c'.repeat(32)},
   counts:{groups:10,people:200,newUnknown:23,openUrgent:45}});
 await tick();
 assert.equal(el('body').classList.contains('has-alert'),false);
 assert.equal(el('alertBanner').hidden,true);
});

test('popup renders yellow roster-review and stale statuses using worker severity',async()=>{
 const now=Date.now();const data={ok:true,guard:{mode:'WRITE'},active:{account:guard.account,at:now},
   counts:{groups:399,people:100,newUnknown:0,openUrgent:0}};
 const {el}=boot({...data,status:{level:'review',indexed:true,groups:399,ambiguous:2}});
 await tick();assert.equal(el('healthBanner').hidden,false);
 assert.match(el('healthDetail').textContent,/2 个群名单待核查/);
 assert.equal(el('body').classList.contains('has-alert'),false);
});
test('popup hides historical account numbers according to worker indexed flag',async()=>{
 const {el}=boot({ok:true,guard:{...guard,account:'verified:'+'f'.repeat(32)},
   active:{account:'verified:'+'b'.repeat(32)},
   counts:{groups:1000,people:5000,newUnknown:700,openUrgent:200},
   status:{level:'readonly',indexed:false,groups:44}});
 await tick();assert.equal(el('groups').textContent,'44');assert.equal(el('unknown').textContent,'—');
 assert.equal(el('events').textContent,'—');assert.equal(el('healthBanner').hidden,false);
});

test('temporary cache degradation is presented as automatic recovery, not a rebind request',async()=>{
 const transient={...guard,readerDegraded:true,canBind:false,reason:'Teams 本地缓存本次读取不完整'};
 const {el}=boot({ok:true,guard:transient,active:null,counts:null,
   status:{level:'readonly',indexed:false,groups:230}});
 await tick();
 assert.match(el('healthDetail').textContent,/自动重试/);
 assert.match(el('status').textContent,/缓存读取待恢复/);
 assert.match(el('identityExplanation').textContent,/无需重新绑定账号/);
 assert.equal(el('identityAction').hidden,true);
});
