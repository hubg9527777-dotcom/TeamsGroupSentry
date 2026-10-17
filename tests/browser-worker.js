/* Test-only worker. Runs shipped code against native IndexedDB on localhost,
   with synthetic account data and a minimal Chrome API fixture. */
const testSession={},testLocal={};
const testStorage=data=>({get:async key=>({[key]:data[key]}),set:async row=>Object.assign(data,row),setAccessLevel:async()=>{}});
let testMessageListener;
const noEvent={addListener(){}};
globalThis.chrome={runtime:{id:'test',getURL:s=>'chrome-extension://test/'+s.replace(/^\//,''),onInstalled:noEvent,onStartup:noEvent,onMessage:{addListener:fn=>{testMessageListener=fn;}},sendMessage:async()=>({ok:true})},
 storage:{session:testStorage(testSession),local:testStorage(testLocal)},alarms:{get:async()=>true,create:async()=>{},onAlarm:noEvent},
 notifications:{onClicked:noEvent,create:async()=>{}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
 tabs:{query:async()=>[],sendMessage:async()=>({ok:true})},offscreen:{hasDocument:async()=>true}};
const nativeImport=globalThis.importScripts.bind(globalThis);
globalThis.importScripts=(...files)=>nativeImport(...files.map(s=>'../'+s));
nativeImport('../background.js');
const testA='verified:'+'a'.repeat(32),testB='verified:'+'b'.repeat(32);
const testPayload={stats:{databases:1},requestUI:{adapter:'VISIBLE_REQUEST_V1',coverage:'LIMITED_UI',observations:[{kind:'CONTACT',personId:'8:live:synthetic123456',name:'张三',context:'visible-request',evidence:'虚构请求界面样本（仅测试）'}]}};
const smallPayload=()=>({trustedReader:'ISOLATED',accountHintSource:'ROSTER_INTERSECTION',accountHint:'',tokenIdentity:null,
 at:Date.now(),dbName:'Teams:conversation-manager:synthetic-small',stats:{databases:1,records:1,partial:false},
 rows:[{id:'19:small-synthetic@thread.v2',quality:'CACHE_OBSERVED',countOffset:null,members:[{id:'8:live:self123456',name:'本人（虚构）'},{id:'8:live:peer654321',name:'群友（虚构）'}]}]});
onmessage=async event=>{try{let result;
 switch(event.data.action){
 case 'small-auto-offer':{
   const p=smallPayload();p.rows[0].members.forEach(m=>delete m.name);
   p.nameHints=[{id:'8:live:self123456',name:'资料补全本人（虚构）',source:'Teams 用户资料缓存'}];
   p.selfEvidence=[{personId:'8:live:self123456',kind:'PROFILE_SELF',count:1}];
   await ingest(p,1);result=await sessionGuard();break;
 }
 case 'small-offer':await ingest(smallPayload(),1);result=await sessionGuard();break;
 case 'small-bind':{
   const state=await sessionGuard();
   const r=await new Promise(resolve=>testMessageListener({action:'BIND_CURRENT',account:state.account,
     selfId:'8:live:self123456',smallConfirmed:true,selfConfirmed:true,last6:'123456'},
     {id:'test',url:'chrome-extension://test/ui/dashboard.html',frameId:0},resolve));
   if(!r?.ok)throw Error(r?.error||'bind failed');result=await ingest(smallPayload(),1);break;
 }
 case 'small-resume':result=await ingest(smallPayload(),1);break;
 case 'small-growth':{const p=smallPayload();p.rows[0].members.push({id:'8:live:stranger999999'});result=await ingest(p,1);break;}
 case 'api':
   result=await new Promise(resolve=>testMessageListener(event.data.message,{id:'test',url:'chrome-extension://test/ui/dashboard.html',frameId:0},resolve));break;
 case 'demo':{
   await ensureUpgradeReady();
   await D.putMeta({pk:'active',account:testA,verified:true,at:Date.now(),scanTabId:1});
   await D.putMeta({pk:'account:'+testA,account:testA,manualBound:true,verified:true});
   await saveGuard({mode:'WRITE',account:testA,at:Date.now(),scanTabId:1});
   await D.transaction(['people','groups','edges'],'readwrite',async tx=>{
     const person={pk:D.pk(testA,'8:live:original_demo'),id:'8:live:original_demo',account:testA,name:'张三',status:'APPROVED',reviewedAt:Date.now()};
     await D.request(tx.objectStore('people').put(person));
     const group={pk:D.pk(testA,'19:demo@thread.v2'),account:testA,id:'19:demo@thread.v2',title:'演示项目群',memberIds:[person.id,'8:live:self'],level:'STANDARD'};
     await D.request(tx.objectStore('groups').put(group));
     await D.request(tx.objectStore('edges').put({pk:D.pk(testA,D.pk(group.id,person.id)),account:testA,groupId:group.id,personId:person.id}));
   });
   const request=structuredClone(testPayload);request.requestUI.observations[0].personId='8:live:stranger_demo';
   await ingestContactRequests(request,testA);result={ok:true};break;
 }
 case 'setup':
   await ensureUpgradeReady();
   await D.putMeta({pk:'active',account:testA,verified:true,at:Date.now()});
   await D.putMeta({pk:'account:'+testA,account:testA,manualBound:true,verified:true});
   await saveGuard({mode:'WRITE',account:testA});result={ok:true};break;
 case 'observe':result=await ingestContactRequests(testPayload,testA);break;
 case 'snapshot':result={events:await D.getAllFor('events',testA),people:await D.getAllFor('people',testA),state:await statusSnapshot()};break;
 case 'invalid-review':{
   const row=(await D.getAllFor('events',testA)).find(e=>e.type==='CONTACT_REQUEST');
   result=await reviewContactRequest({account:testA,id:row.id,revision:row.reviewRevision,decision:'VERIFY',confirmed:true,personId:row.personId,last6:'wrong'});break;}
 case 'verify':{
   const row=(await D.getAllFor('events',testA)).find(e=>e.type==='CONTACT_REQUEST');
   result=await reviewContactRequest({account:testA,id:row.id,revision:row.reviewRevision,decision:'VERIFY',confirmed:true,personId:row.personId,last6:row.personId.slice(-6)});break;}
 case 'group':result=await applyBatch([{id:'19:synthetic@thread.v2',members:[{id:'8:live:newgroup',name:'新成员'},{id:'8:live:other',name:'其他'}],quality:'CACHE_OBSERVED',countOffset:null}],testA,{notifyUnknown:true},false);break;
 case 'partition':
   await ingestContactRequests(testPayload,testB);result=await D.getAllFor('events',testB);break;
 case 'checkpoint':{
   const checkpoint=await R.capture(D,{label:'Synthetic test',version:'1.0.1'});result=await R.verifyCheckpoint(checkpoint.id,D,testA);break;}
 default:throw Error('unknown test action');
 }postMessage({ok:true,result});}catch(e){postMessage({ok:false,error:e.message});}};
