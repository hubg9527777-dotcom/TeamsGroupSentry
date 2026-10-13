const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const tables=new Map(['groups','people','edges','events','policies','meta'].map(n=>[n,new Map()]));
function store(name){const map=tables.get(name);return {
 get:key=>({result:map.get(key)}), put:rec=>{map.set(rec.pk||rec.account,structuredClone(rec));return {result:rec};},
 add:rec=>{const key=rec.pk||rec.account;if(map.has(key))throw Error('ConstraintError');map.set(key,structuredClone(rec));return {result:key};},
 getAllKeys:()=>({result:[...map.keys()]}),
 delete:key=>{map.delete(key);return {result:undefined};},
 index:()=>({getAll:key=>({result:[...map.values()].filter(x=>x.account===key)})}),
 getAll:()=>({result:[...map.values()]})
};}
const D={pk:(a,b)=>JSON.stringify([a,b]),request:r=>Promise.resolve(structuredClone(r.result)),
 transaction:async (tables,mode,fn)=>fn({objectStore:store}),
 getMeta:async key=>tables.get('meta').get(key),putMeta:async rec=>tables.get('meta').set(rec.pk,structuredClone(rec)),
 getPolicy:async acc=>tables.get('policies').get(acc)||{account:acc,aaEnabled:true,aaMode:'prefix',aaPrefixes:['AA'],quietApprovedAA:true,notifyUnknown:true,notifyKnownTransfers:true,sound:false},
 getAllFor:async (s,acc)=>[...tables.get(s).values()].filter(x=>x.account===acc),
 getAll:async (s)=>[...tables.get(s).values()].map(x=>structuredClone(x)),
 open:async ()=>({})};
const recoveryHistory=[];
const R={
 capture:async (_,args={})=>{
   const snapshot={id:'11111111-1111-4111-8111-'+String(recoveryHistory.length+1).padStart(12,'0'),
     at:Date.now(),label:args.label||'',version:args.version||'',sourceVersion:args.sourceVersion||'',
     tables:Object.fromEntries([...tables.entries()].map(([name,rows])=>[name,[...rows.values()].map(r=>structuredClone(r))]))};
   snapshot.counts=Object.fromEntries(Object.entries(snapshot.tables).map(([t,rows])=>[t,rows.length]));
   snapshot.total=Object.values(snapshot.counts).reduce((n,v)=>n+v,0);
   recoveryHistory.push(snapshot);return {ok:true,...snapshot,tables:undefined};
 },
 list:async()=>[...recoveryHistory].reverse().map(({id,at,label,version,sourceVersion,counts,total})=>({id,at,label,version,sourceVersion,counts,total})),
 verifyCheckpoint:async(id)=>{const s=recoveryHistory.find(x=>x.id===id);return {ok:true,missing:0,previousPending:s.tables.people.filter(p=>p.status==='NEW').length,priorGroups:s.tables.groups.length};},
 restoreMissing:async(id)=>{const s=recoveryHistory.find(x=>x.id===id);let added=0;
   for(const [name,rows] of Object.entries(s.tables))if(name!=='meta')for(const row of rows){
     const key=row.pk||row.account;if(!tables.get(name).has(key)){tables.get(name).set(key,structuredClone(row));added++;}
   }return {ok:true,added};}
};
const badgeState={text:'',background:'',title:''};
const listeners={},sent=[],sessionStore=new Map(),chrome={runtime:{id:'test',getURL:(s='')=>`chrome-extension://test/${s}`,onInstalled:{addListener:f=>listeners.install=f},
 onStartup:{addListener:f=>listeners.start=f},onMessage:{addListener:f=>listeners.message=f},sendMessage:async m=>{sent.push(m);return {ok:true};}},
 alarms:{get:async()=>null,create:async()=>{},onAlarm:{addListener:f=>listeners.alarm=f}},
 tabs:{query:async()=>[],sendMessage:async()=>({ok:false})},action:{setBadgeBackgroundColor:async({color})=>{badgeState.background=color;},setBadgeText:async({text})=>{badgeState.text=text;},setTitle:async({title})=>{badgeState.title=title;}},
 notifications:{create:async()=>{},onClicked:{addListener:f=>listeners.notificationClick=f}},offscreen:{hasDocument:async()=>true},
 storage:{local:{setAccessLevel:async()=>{},get:async()=>({manualProfile:''}),set:async()=>{}},
 session:{setAccessLevel:async()=>{},get:async key=>({[key]:sessionStore.get(key)}),set:async entries=>{for(const [key,value] of Object.entries(entries))sessionStore.set(key,structuredClone(value));}}}};
const context=vm.createContext({console,crypto:webcrypto,TextEncoder,structuredClone,Uint8Array,Date,URL,JSON,Set,Map,setTimeout,clearTimeout,
 navigator:{storage:{persist:async()=>true}},chrome,importScripts:(...names)=>{
   for(const name of names)if(name==='lib/logic.js')vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
   else if(name==='lib/db.js')context.TGSDB=D;
   else if(name==='lib/recovery.js')context.TGSRecovery=R;
   else if(name==='lib/backup-diff.js')vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
 }});
context.globalThis=context;vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
async function send(action,payload={},source='page'){
 const sender=source==='page'?{id:'test',tab:{id:1},frameId:0,url:'https://teams.live.com/v2/'}:source==='extensionTab'?{id:'test',tab:{id:91},frameId:0,url:'chrome-extension://test/ui/dashboard.html'}:{id:'test',url:'chrome-extension://test/popup/popup.html'};
 return new Promise((resolve,reject)=>{const done=listeners.message({action,...payload},sender,resolve);if(done!==true)reject(new Error('listener did not accept action'));});
}
const groupId=i=>`19:${i}abcdef@thread.v2`,personId=i=>`8:live:cid.${String(i).padStart(16,'0')}`;
const row=(g,members)=>({id:groupId(g),quality:'CACHE_OBSERVED',countOffset:null,title:'',longTitle:'',members:members.map(i=>({id:personId(i),name:i===1?'AA-张三':''}))});
const payload=(rows,identity='8:live:cid.CURRENTACCOUNT')=>({payload:{rows,at:Date.now(),stats:{databases:1,records:1543,candidates:rows.length,complete:0,partial:false},dbName:'Teams:conversation-manager:react-web-client:demo',accountHint:identity,accountHintSource:'ROSTER_INTERSECTION',trustedReader:'ISOLATED',tokenIdentity:null}});
test('worker ingests 400 groups, dedupes people and creates NO false baseline events',async()=>{
 const rows=Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i]));
 const first=await send('INGEST',payload(rows));
 assert.equal(first.ok,true);assert.equal(first.readOnly,true);assert.equal(first.scanned,400);
 assert.equal((await D.getAllFor('groups',first.account||'')).length,0);
 const guard=(await send('SUMMARY',{},'popup')).guard;
 assert.equal(guard.canBind,true);
 await send('BIND_CURRENT',{account:guard.account},'popup');
 const r=await send('INGEST',payload(rows));assert.equal(r.ok,true);assert.equal(r.scanned,400);
 assert.equal(r.observedAdded,0);const overview=await send('SUMMARY',{},'popup');assert.equal(overview.counts.groups,400);
 assert.equal(overview.counts.people,801);assert.equal(overview.counts.openEvents,0);
});
// Identity hints can vanish even when the *same* hundreds of cached groups remain.
// A scope is writable only after prior extension-UI approval and strong roster continuity.
test('previously approved browser-cache scope continues writing despite absent self MRI',async()=>{
  const before=(await send('SUMMARY',{},'popup')).counts;
  sessionStore.clear(); // Simulated MV3 service-worker/browser session restart.
  const original=Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i]));
  const r=await send('INGEST',payload(original,''));
  assert.equal(r.readOnly,undefined);
  assert.equal(r.scanned,400);
  const after=(await send('SUMMARY',{},'popup')).counts;
  assert.equal(after.groups,before.groups);
  assert.equal(after.people,before.people);
});
test('old account without scope binding needs one confirmation, then resumes automatically',async()=>{
  const acc=(await send('SUMMARY',{},'popup')).active.account;
  const scope=[...tables.get('meta').keys()].find(k=>k.startsWith('account-cache-scope:'));
  assert.ok(scope);
  const saved=structuredClone(tables.get('meta').get(scope));tables.get('meta').delete(scope);
  const rows=Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i]));
  try{
    const preview=await send('INGEST',payload(rows,''));
    assert.equal(preview.readOnly,true);assert.equal(preview.compared,400);
    const pending=(await send('SUMMARY',{},'popup')).guard;
    assert.equal(pending.canBind,true);assert.equal(pending.account,acc);
    await send('BIND_CURRENT',{account:acc},'popup');
    const resumed=await send('INGEST',payload(rows,''));
    assert.equal(resumed.readOnly,undefined);assert.equal(resumed.scanned,400);
    assert.equal((await send('SUMMARY',{},'popup')).counts.groups,400);
  }finally{tables.get('meta').set(scope,saved);}
});
test('unknown cached account with different roster stays read-only and never overwrites baseline',async()=>{
  const initial=JSON.stringify([...tables.get('groups').entries()]);
  const different=Array.from({length:400},(_,i)=>row(i+9000,[800000,900000+i,1000000+i]));
  const r=await send('INGEST',payload(different,''));
  assert.equal(r.readOnly,true);assert.equal(r.compared,0);
  const guard=(await send('SUMMARY',{},'popup')).guard;
  assert.equal(guard.canBind,false);
  assert.equal(JSON.stringify([...tables.get('groups').entries()]),initial);
  await send('INGEST',payload(Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i])),''));
});
test('scope mapping from another active account is never auto-trusted',async()=>{
  const scope=[...tables.get('meta').keys()].find(k=>k.startsWith('account-cache-scope:'));
  const active=tables.get('meta').get('active');
  const saved=structuredClone(active);
  tables.get('meta').set('active',{...active,account:'verified:'+'9'.repeat(32)});
  const rows=Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i]));
  try{
    const result=await send('INGEST',payload(rows,''));
    assert.equal(result.readOnly,true);assert.equal(result.compared,0);
    const guard=(await send('SUMMARY',{},'popup')).guard;
    assert.equal(guard.canBind,false);
  }finally{
    tables.get('meta').set('active',saved);
    await send('INGEST',payload(rows,''));
  }
});
test('mark group critical, add new ID and create just one observed event',async()=>{
 const acc=(await send('SUMMARY',{},'popup')).active.account;
 await send('EDIT',{kind:'group',id:groupId(0),field:'level',value:'CRITICAL'},'popup');
 const rows=Array.from({length:400},(_,i)=>row(i,i===0?[1,2,1000,20000]:[1,2+i,1000+i]));
 const r=await send('INGEST',payload(rows));assert.equal(r.observedAdded,1);assert.equal(r.unknown,1);assert.equal(r.critical,1);
 assert.equal(r.summary.newUnknown,1);
 const events=await D.getAllFor('events',acc);assert.equal(events.filter(x=>x.type==='OBSERVED_ADDITION').length,1);
 assert.equal(events[0].quality,'CACHE_OBSERVED');
 const again=await send('INGEST',payload(rows));assert.equal(again.observedAdded,0);
 assert.equal((await D.getAllFor('events',acc)).length,1);
});
test('APPROVED company transfer into standard group logged silently',async()=>{
 const acc=(await send('SUMMARY',{},'popup')).active.account;
 await send('EDIT',{kind:'person',id:personId(1000),field:'status',value:'APPROVED'},'popup');
 await send('EDIT',{kind:'person',id:personId(1000),field:'companyApproved',value:true},'popup');
 const rows=Array.from({length:400},(_,i)=>row(i,i===0?[1,2,1000,20000]:i===1?[1,3,1001,1000]:[1,2+i,1000+i]));
 const r=await send('INGEST',payload(rows));assert.equal(r.observedAdded,1);
 const events=await D.getAllFor('events',acc);assert.equal(events.filter(x=>x.personId===personId(1000)).length,1);
 assert.equal(events.filter(x=>x.personId===personId(1000))[0].severity,'SILENT');
});
test('member disappearance never becomes confirmed leave',async()=>{
 const rows=Array.from({length:400},(_,i)=>row(i,i===0?[1,20000,22222]:i===1?[1,3,1001,1000]:[1,2+i,1000+i]));
 const r=await send('INGEST',payload(rows));assert.equal(r.observedAdded,0);assert.ok(r.ambiguous>0);
 const group=(await D.getAllFor('groups',r.account)).find(g=>g.id===groupId(0));
 assert.equal(group.memberIds.length,4);assert.equal(group.ambiguous,true);
});
test('ID aliases are preserved and manual identity approval not removed by scan',async()=>{
 const active=(await send('SUMMARY',{},'popup')).active;
 await send('EDIT',{kind:'group',id:groupId(0),field:'alias',value:'我的公司重点群'},'popup');
 const group=(await D.getAllFor('groups',active.account)).find(g=>g.id===groupId(0));
 assert.equal(group.alias,'我的公司重点群');
 const person=(await D.getAllFor('people',active.account)).find(p=>p.id===personId(1));
 const company=(await D.getAllFor('people',active.account)).find(p=>p.id===personId(1000));
 assert.equal(company.status,'APPROVED');assert.equal(company.companyApproved,true);
});
test('separate verified account starts baseline rather than inheriting alerts',async()=>{
 const other=payload([row(7,[1,5,9])],'8:live:cid.SECONDACCOUNT');
 const preview=await send('INGEST',other);assert.equal(preview.readOnly,true);
 const pending=(await send('SUMMARY',{},'popup')).guard;
 assert.equal(pending.canBind,true);
 await send('BIND_CURRENT',{account:pending.account},'popup');
 const r=await send('INGEST',other);
 assert.equal(r.scanned,1);assert.equal(r.observedAdded,0);assert.equal(r.summary.groups,1);
});
test('in-page overlay can request non-sensitive status only',async()=>{
 const s=await send('OVERLAY_STATUS',{},'page');assert.equal(s.ok,true);
 assert.equal(typeof s.groups,'number');assert.equal(typeof s.openUrgent,'number');
 assert.equal(s.prefs.mode,'always');assert.equal(Object.hasOwn(s,'people'),false);
});
test('mixed roster replacement with a new ID in ordinary group yields uncertain warning, not confirmed join',async()=>{
 const r=await send('INGEST',payload([row(1,[1,3,1001,30000])],'8:live:cid.CURRENTACCOUNT'));
 // This group was initially observed with a different membership set.
 const matches=(await D.getAllFor('events',r.account)).filter(e=>e.groupId===groupId(1)&&e.type==='ROSTER_UNCERTAIN');
 assert.equal(r.observedAdded,0);assert.ok(matches.length>0);
 assert.equal(matches.at(-1).severity,'REVIEW');
});

test('page-origin injection without matching extension sender ID cannot ingest',()=>{
 const spoof={url:'https://teams.live.com/v2/',tab:{id:1},frameId:0,id:'other-extension'};
 assert.equal(listeners.message({action:'INGEST',payload:payload([row(999,[1,2,3])]).payload},spoof,()=>{}),undefined);
});
test('lower-priority member hint cannot replace existing profile name',()=>{
 const p={name:'资料姓名',nameSource:'Teams 用户资料缓存'};
 assert.equal(context.mayUpdateName(p,'较低可信昵称','Teams 会话元数据'),false);
 assert.equal(context.mayUpdateName(p,'正确资料变更','Teams 用户资料缓存'),true);
});

test('ambiguous account is read-only: snapshots, identity map and history never change',async()=>{
 const before=[...tables.entries()].map(([key,map])=>[key,JSON.stringify([...map.entries()])]);
 const attempt=payload([row(0,[1,2,1000,123450])],'8:live:cid.DIFFERENT_ACCOUNT');
 const result=await send('INGEST',attempt);
 assert.equal(result.readOnly,true);assert.equal(result.compared,0);
 assert.equal(result.observedAdded,0);
 assert.equal(JSON.stringify([...tables.entries()].map(([key,map])=>[key,JSON.stringify([...map.entries()])])),JSON.stringify(before));
});
test('missing account signal uses previous baseline for read-only comparisons with deduplication',async()=>{
 const before=[...tables.entries()].map(([key,map])=>[key,JSON.stringify([...map.entries()])]);
 const input=payload([row(0,[1,2,1000,20000,99999])],'');
 const first=await send('INGEST',input);
 assert.equal(first.readOnly,true);assert.equal(first.compared,1);assert.equal(first.observedAdded,1);
 const again=await send('INGEST',input);
 assert.equal(again.readOnly,true);assert.equal(again.observedAdded,0);
 assert.equal(JSON.stringify([...tables.entries()].map(([key,map])=>[key,JSON.stringify([...map.entries()])])),JSON.stringify(before));
});
test('unexpected MAIN-world token metadata is rejected and cannot affect guard',async()=>{
 const input=payload([row(7,[1,5,9,77777])],'');
 input.payload.tokenIdentity={mri:'8:live:cid.SECONDACCOUNT'};
 const r=await send('INGEST',input);
 assert.equal(r.ok,false);
 assert.match(r.error,/invalid|无效|不符合/i);
});
test('unbound candidate cannot be activated by a Teams page message',async()=>{
 const hint=payload([row(101,[1,2,3])],'8:live:cid.UNBOUND');
 const r=await send('INGEST',hint);assert.equal(r.readOnly,true);
 const state=(await send('SUMMARY',{},'popup')).guard;
 assert.equal(state.canBind,true);
 await assert.rejects(send('BIND_CURRENT',{account:state.account},'page'),/listener did not accept action/);
 assert.equal((await D.getAllFor('groups',state.account)).length,0);
});
test('user-approved link reuses legacy provisional baseline instead of recreating 400 groups',async()=>{
 const account='provisional:'+'1'.repeat(32);
 tables.get('groups').set(D.pk(account,groupId(70)),{pk:D.pk(account,groupId(70)),account,
   id:groupId(70),memberIds:[personId(1),personId(2),personId(3)],quality:'CACHE_OBSERVED',
   countOffset:null,level:'CRITICAL',alias:'历史重点群'});
 tables.get('meta').set('active',{pk:'active',account,verified:false,at:Date.now()});
 const input=payload([row(70,[1,2,3])],'8:live:cid.LEGACYLINK');
 const preview=await send('INGEST',input);
 assert.equal(preview.readOnly,true);assert.equal(preview.compared,1);
 const state=(await send('SUMMARY',{},'popup')).guard;
 assert.equal(state.account,account);assert.equal(state.canBind,true);
 const baselineCount=(await D.getAllFor('groups',account)).length;
 await send('BIND_CURRENT',{account},'popup');
 const enabled=await send('INGEST',input);
 assert.equal(enabled.readOnly,undefined);
 assert.equal(enabled.account,account);
 assert.equal((await D.getAllFor('groups',account)).length,baselineCount);
 assert.equal((await D.getAllFor('groups',account))[0].alias,'历史重点群');
});

test('extension dashboard opened in a tab can approve identity and company classification',async()=>{
 const m=await send('SUMMARY',{},'popup');
 const person=(await D.getAllFor('people',m.active.account))[0];
 const first=await send('EDIT',{kind:'person',id:person.id,field:'status',value:'APPROVED'},'extensionTab');
 assert.equal(first.ok,true);
 const second=await send('EDIT',{kind:'person',id:person.id,field:'companyApproved',value:true},'extensionTab');
 assert.equal(second.ok,true);
 const changed=(await D.getAllFor('people',m.active.account)).find(p=>p.id===person.id);
 assert.equal(changed.status,'APPROVED');assert.equal(changed.companyApproved,true);
});
test('unauthorized Teams page cannot modify an identity or bulk approve',()=>{
 const attacker={id:'test',tab:{id:4},frameId:0,url:'https://teams.live.com/v2/'};
 assert.equal(listeners.message({action:'EDIT',kind:'person',id:personId(1),field:'status',value:'APPROVED'},attacker,()=>{}),undefined);
 assert.equal(listeners.message({action:'BULK_PERSON',ids:[personId(1)],value:'APPROVED'},attacker,()=>{}),undefined);
});
test('foreign extension or nested frame cannot modify identity',()=>{
 for(const sender of [
   {id:'evil',tab:{id:9},frameId:0,url:'chrome-extension://test/ui/dashboard.html'},
   {id:'test',tab:{id:9},frameId:1,url:'chrome-extension://test/ui/dashboard.html'},
   {id:'test',tab:{id:9},frameId:0,url:'https://example.com/x'}]){
   assert.equal(listeners.message({action:'EDIT',kind:'person',id:personId(1),field:'status',value:'APPROVED'},sender,()=>{}),undefined);
 }
});

test('upgrade checkpoint can be listed and records already approved remain unchanged',async()=>{
 const r=await send('RECOVERY_STATUS',{},'extensionTab');
 assert.equal(r.ok,true);assert.equal(r.ready,true);
 const first=await send('CREATE_CHECKPOINT',{},'popup');
 assert.equal(first.ok,true);assert.ok(first.total>0);
 const verified=await send('VERIFY_CHECKPOINT',{id:first.id},'extensionTab');
 assert.equal(verified.ok,true);assert.equal(verified.missing,0);
 const current=(await send('SUMMARY',{},'popup')).active.account;
 const person=(await D.getAllFor('people',current))[0];
 const status=person.status;
 const after=await send('RESTORE_MISSING',{id:first.id},'extensionTab');
 assert.equal(after.ok,true);assert.equal(after.added,0);
 assert.equal((await D.getAllFor('people',current)).find(p=>p.id===person.id).status,status);
});

test('old encrypted backup never overwrites currently approved identity on import',async()=>{
 const account=(await send('SUMMARY',{},'popup')).active.account;
 const current=(await D.getAllFor('people',account)).find(p=>p.status==='APPROVED');
 assert.ok(current,'previous integration tests should have approved someone');
 const newcomer=personId(98765432);
 const outdated={...structuredClone(current),status:'NEW',companyApproved:false,manualName:'旧姓名'};
 const fresh={pk:D.pk(account,newcomer),account,id:newcomer,status:'NEW',name:'',manualName:'',companyApproved:false,firstSeen:Date.now()};
 const backup={format:'TGS3_BACKUP',version:1,account,tables:{groups:[],people:[outdated,fresh],edges:[],events:[],policies:[]}};
 const r=await send('RESTORE',{data:backup},'extensionTab');
 assert.equal(r.ok,true);assert.equal(r.restored,1);assert.equal(r.unchanged,1);
 const people=await D.getAllFor('people',account);
 const protectedPerson=people.find(p=>p.id===current.id);
 assert.equal(protectedPerson.status,'APPROVED');
 assert.equal(protectedPerson.companyApproved,current.companyApproved);
 assert.equal(protectedPerson.manualName,current.manualName);
 assert.equal(people.find(p=>p.id===newcomer).status,'NEW');
});

test('checkpoint failure blocks review writes rather than corrupting existing identity',async()=>{
 const account=(await send('SUMMARY',{},'popup')).active.account;
 const person=(await D.getAllFor('people',account))[0];
 const before=structuredClone(person);
 const previousMarker=structuredClone(tables.get('meta').get('upgrade-safety'));
 const originalCapture=R.capture;
 try{
   tables.get('meta').delete('upgrade-safety');
   R.capture=async()=>{throw new Error('模拟磁盘已满')};
   vm.runInContext('preparationPromise=null',context);
   const result=await send('EDIT',{kind:'person',id:person.id,field:'status',value:'REVOKED'},'extensionTab');
   assert.equal(result.ok,false);
   assert.match(result.error,/升级保护|数据升级保护/);
   assert.deepEqual((await D.getAllFor('people',account)).find(p=>p.id===person.id),before);
 }finally{
   R.capture=originalCapture;
   tables.get('meta').set('upgrade-safety',previousMarker);
   vm.runInContext('preparationPromise=null',context);
 }
});

test('identity conflict fails closed for edits, bulk approvals and backup import while snapshots stay unchanged',async()=>{
 const current=(await send('SUMMARY',{},'popup')).active.account;
 const people=await D.getAllFor('people',current);const target=people[0];
 const before=structuredClone(target);
 const scan=payload([row(0,[1,2,3])],'8:live:cid.CONFLICTING_ACCOUNT');
 const downgraded=await send('INGEST',scan);
 assert.equal(downgraded.readOnly,true);
 const write=await send('EDIT',{kind:'person',id:target.id,field:'status',value:'REVOKED'},'extensionTab');
 assert.equal(write.ok,false);assert.match(write.error,/只读守护/);
 const bulk=await send('BULK_PERSON',{ids:[target.id],value:'APPROVED'},'extensionTab');
 assert.equal(bulk.ok,false);assert.match(bulk.error,/只读守护/);
 const backup={format:'TGS3_BACKUP',version:1,account:current,tables:{groups:[],people:[],edges:[],events:[],policies:[]}};
 const restore=await send('RESTORE',{data:backup},'extensionTab');
 assert.equal(restore.ok,false);assert.match(restore.error,/只读守护/);
 assert.deepEqual((await D.getAllFor('people',current)).find(p=>p.id===target.id),before);
});

test('historical backup comparison finds newer cached identities without rolling back today',async()=>{
 const account=(await send('SUMMARY',{},'popup')).active.account;
 const beforeGroups=structuredClone(await D.getAllFor('groups',account));
 const beforePeople=structuredClone(await D.getAllFor('people',account));
 const backup={format:'TGS3_BACKUP',version:1,at:'2026-10-12T12:00:00Z',account,
  tables:{groups:beforeGroups,people:beforePeople,edges:[],events:[],policies:[]}};
 const target=beforeGroups.find(g=>Array.isArray(g.memberIds)&&g.memberIds.length>1);
 const newcomer=personId(456789);
 const updated=structuredClone(target);updated.memberIds.push(newcomer);
 tables.get('groups').set(updated.pk,updated);
 tables.get('people').set(D.pk(account,newcomer),{pk:D.pk(account,newcomer),account,id:newcomer,status:'NEW',name:'新身份',firstSeen:Date.now()});
 // Cross-account identity conflict stops comparison and historical event writes.
 const denied=await send('COMPARE_BACKUP',{data:backup},'extensionTab');
 assert.equal(denied.ok,false);assert.match(denied.error,/身份/);
 sessionStore.set('tgs-v33-guard-state',{mode:'WRITE',account,at:Date.now()});
 const r=await send('COMPARE_BACKUP',{data:backup},'extensionTab');
 assert.equal(r.ok,true);assert.equal(r.newPeopleCount,1);assert.equal(r.oldGroupNewRelations,1);
 assert.equal(r.people[0].id,newcomer);
 const first=await send('MARK_HISTORICAL',{data:backup},'extensionTab');
 assert.equal(first.ok,true);assert.equal(first.created,1);
 const again=await send('MARK_HISTORICAL',{data:backup},'extensionTab');
 assert.equal(again.created,0);
 assert.equal((await D.getAllFor('events',account)).filter(e=>e.type==='HISTORICAL_NEW_PERSON'&&e.personId===newcomer).length,1);
 assert.equal((await D.getAllFor('groups',account)).find(g=>g.id===target.id).memberIds.length,updated.memberIds.length);
 assert.equal((await D.getAllFor('people',account)).find(p=>p.id===newcomer).status,'NEW');
});

test('browser toolbar badge includes pending identities even without urgent events',async()=>{
  await context.updateActionBadge({newUnknown:1,openUrgent:0});
  assert.equal(badgeState.text,'1');
  assert.match(badgeState.title,/新身份待审 1/);
  assert.equal(badgeState.background,'#c52a32');
});
test('browser toolbar badge reflects both pending categories and clears after resolution',async()=>{
  await context.updateActionBadge({newUnknown:1,openUrgent:2});
  assert.equal(badgeState.text,'3');
  assert.match(badgeState.title,/重要未处理 2/);
  await context.updateActionBadge({newUnknown:0,openUrgent:0});
  assert.equal(badgeState.text,'');
});
test('browser toolbar badge caps large pending item counts',async()=>{
  await context.updateActionBadge({newUnknown:125,openUrgent:25});
  assert.equal(badgeState.text,'99+');
});
test('worker rejects legacy MAIN payload and token injection before any database write',async()=>{
 const current=(await send('SUMMARY',{},'popup')).active.account;
 const snapshot=JSON.stringify((await D.getAllFor('groups',current)).map(g=>[g.pk,g.memberIds]));
 for(const patched of [
   {trustedReader:'MAIN'},
   {trustedReader:undefined},
   {accountHintSource:'PAGE_UNTRUSTED'},
   {tokenIdentity:{mri:'8:live:cid.BAD'}}
 ]){
   const x=payload([row(0,[1,2,3])]);Object.assign(x.payload,patched);
   const result=await send('INGEST',x);
   assert.equal(result.ok,false,'untrusted payload must be rejected');
 }
 assert.equal(JSON.stringify((await D.getAllFor('groups',current)).map(g=>[g.pk,g.memberIds])),snapshot);
});

test('uncertain shrink retains baseline while exposing latest candidate roster for human review',async()=>{
 const account=(await send('SUMMARY',{},'popup')).active.account;
 const group=(await D.getAllFor('groups',account)).find(g=>g.memberIds?.length>=3);
 assert.ok(group);
 const latest=group.memberIds.slice(0,-1);
 const result=await context.applyBatch([{id:group.id,title:group.title||'',longTitle:group.longTitle||'',
   quality:group.quality||'CACHE_OBSERVED',countOffset:group.countOffset,
   members:latest.map(id=>({id,name:''}))}],account,await D.getPolicy(account),false);
 assert.equal(result.ambiguous,1);
 const pending=(await D.getAllFor('groups',account)).find(g=>g.id===group.id);
 assert.deepEqual(pending.memberIds,group.memberIds);
 assert.deepEqual(pending.pendingRosterIds,latest);
 assert.equal(pending.ambiguous,true);
 assert.ok(pending.pendingRevision);
 const reordered=latest.slice().reverse();
 await context.applyBatch([{id:group.id,quality:group.quality||'CACHE_OBSERVED',countOffset:group.countOffset,
   members:reordered.map(id=>({id,name:''}))}],account,await D.getPolicy(account),false);
 const sameMembers=(await D.getAllFor('groups',account)).find(g=>g.id===group.id);
 assert.equal(sameMembers.pendingRevision,pending.pendingRevision,'display-order changes must not invalidate review');
 sessionStore.set('tgs-v33-guard-state',{mode:'WRITE',account,at:Date.now()});
 const wrong=await send('CONFIRM_ROSTER',{id:group.id,revision:'stale-or-tampered'},'extensionTab');
 assert.equal(wrong.ok,false);assert.match(wrong.error,/更新/);
 const untouched=(await D.getAllFor('groups',account)).find(g=>g.id===group.id);
 assert.deepEqual(untouched.memberIds,group.memberIds);
 const bad=structuredClone(untouched);bad.pendingSnapshotAt=Date.now()-360000;
 tables.get('groups').set(bad.pk,bad);
 const expired=await send('CONFIRM_ROSTER',{id:group.id,revision:bad.pendingRevision},'extensionTab');
 assert.equal(expired.ok,false);assert.match(expired.error,/过期/);
 bad.pendingSnapshotAt=Date.now();tables.get('groups').set(bad.pk,bad);
 const accepted=await send('CONFIRM_ROSTER',{id:group.id,revision:bad.pendingRevision},'extensionTab');
 assert.equal(accepted.ok,true);assert.equal(accepted.removed,1);assert.equal(accepted.added,0);
 const after=(await D.getAllFor('groups',account)).find(g=>g.id===group.id);
 assert.deepEqual([...after.memberIds].sort(),[...latest].sort());assert.equal(after.ambiguous,false);
 assert.equal(after.pendingRosterIds,undefined);
 const history=(await D.getAllFor('events',account)).find(e=>e.id===accepted.eventId);
 assert.deepEqual(history.previousMemberIds,group.memberIds);
 assert.deepEqual([...history.acceptedMemberIds].sort(),[...latest].sort());
 assert.equal(history.status,'LOGGED');
 assert.equal((await D.getAllFor('edges',account)).some(e=>e.groupId===group.id&&e.personId===group.memberIds.at(-1)),false);
});

test('read-only account guard rejects manual roster adoption without changing data',async()=>{
 const account=(await send('SUMMARY',{},'popup')).active.account;
 const group=(await D.getAllFor('groups',account)).find(g=>g.memberIds?.length>=2);
 assert.ok(group);
 const before=JSON.stringify(await D.getAllFor('groups',account));
 sessionStore.set('tgs-v33-guard-state',{mode:'READ_ONLY',account,at:Date.now(),reason:'身份待确认'});
 const r=await send('CONFIRM_ROSTER',{id:group.id,revision:'abc'},'extensionTab');
 assert.equal(r.ok,false);assert.match(r.error,/只读守护/);
 assert.equal(JSON.stringify(await D.getAllFor('groups',account)),before);
});

test('one status snapshot drives popup, Teams overlay and browser action badge',async()=>{
 const original=[...tables].map(([name,map])=>[name,new Map(map)]);
 const savedGuard=sessionStore.get('tgs-v33-guard-state');
 const account='verified:'+'d'.repeat(32),other='verified:'+'e'.repeat(32);
 const gId=groupId(909),pId=personId(909);
 try{
  for(const name of ['groups','people','edges','events'])tables.get(name).clear();
  tables.get('meta').set('active',{pk:'active',account,at:Date.now(),verified:true});
  sessionStore.set('tgs-v33-guard-state',{mode:'WRITE',account,at:Date.now()});
  tables.get('groups').set(D.pk(account,gId),{pk:D.pk(account,gId),account,id:gId,ambiguous:true,memberIds:[]});
  let popup=await send('SUMMARY',{},'popup'),overlay=await send('OVERLAY_STATUS',{},'page');
  assert.equal(popup.status.level,'review');assert.equal(overlay.level,popup.status.level);
  assert.equal(overlay.ambiguous,1);assert.equal(popup.status.ambiguous,1);
  await context.refreshBadge();assert.equal(badgeState.text,'!');assert.equal(badgeState.background,'#b7791f');
  // Adding pending work turns all surfaces red from the same persisted record set.
  tables.get('people').set(D.pk(account,pId),{pk:D.pk(account,pId),account,id:pId,status:'NEW'});
  tables.get('events').set(D.pk(account,'e-1'),{pk:D.pk(account,'e-1'),account,id:'e-1',status:'OPEN',severity:'REVIEW'});
  popup=await send('SUMMARY',{},'popup');overlay=await send('OVERLAY_STATUS',{},'page');
  assert.equal(popup.status.level,'alert');assert.equal(overlay.level,popup.status.level);
  assert.equal(popup.status.newUnknown,overlay.newUnknown);assert.equal(popup.status.openUrgent,overlay.openUrgent);
  await context.refreshBadge();assert.equal(badgeState.text,'2');assert.equal(badgeState.background,'#c52a32');
  // A different active Teams identity must not expose the previous account's red counts.
  sessionStore.set('tgs-v33-guard-state',{mode:'READ_ONLY',account:other,inspected:18,compared:0,at:Date.now(),reason:'身份冲突'});
  popup=await send('SUMMARY',{},'popup');overlay=await send('OVERLAY_STATUS',{},'page');
  assert.equal(popup.status.level,'readonly');assert.equal(overlay.level,popup.status.level);
  assert.equal(popup.counts,null);assert.equal(overlay.newUnknown,0);assert.equal(overlay.openUrgent,0);
  assert.equal(overlay.groups,18);
  await context.refreshBadge();assert.equal(badgeState.text,'!');assert.equal(badgeState.background,'#b7791f');
  assert.doesNotMatch(badgeState.title,/新身份待审 1/);
  // With the same protected account, old pending work remains visible but no
  // ephemeral read-only 'observedAdded' count is disguised as a new saved event.
  sessionStore.set('tgs-v33-guard-state',{mode:'READ_ONLY',account,inspected:20,compared:2,observedAdded:7,at:Date.now()});
  popup=await send('SUMMARY',{},'popup');overlay=await send('OVERLAY_STATUS',{},'page');
  assert.equal(popup.status.level,'alert');assert.equal(overlay.level,'alert');
  assert.equal(popup.status.observedOnly,7);assert.equal(overlay.guard.observedAdded,7);
  assert.equal(overlay.openUrgent,1);assert.equal(overlay.newUnknown,1);
  await context.refreshBadge();assert.equal(badgeState.text,'2');
  // Scan expiry is also shared (not silently represented as healthy).
  sessionStore.set('tgs-v33-guard-state',{mode:'WRITE',account,at:Date.now()-190000});
  tables.get('meta').set('active',{pk:'active',account,at:Date.now()-190000});
  tables.get('people').clear();tables.get('events').clear();tables.get('groups').clear();
  popup=await send('SUMMARY',{},'popup');overlay=await send('OVERLAY_STATUS',{},'page');
  assert.equal(popup.status.level,'stale');assert.equal(overlay.level,'stale');
  await context.refreshBadge();assert.equal(badgeState.text,'!');
 }finally{
  for(const [name,map] of original){tables.get(name).clear();for(const [k,v]of map)tables.get(name).set(k,v);}
  if(savedGuard===undefined)sessionStore.delete('tgs-v33-guard-state');
  else sessionStore.set('tgs-v33-guard-state',savedGuard);
 }
});

test('approved account can edit after a browser restart with no new confirmation',async()=>{
  const active=await D.getMeta('active');
  const people=await D.getAllFor('people',active.account);
  assert.ok(people.length>0);
  const person=people[0];
  const savedGuard=sessionStore.get('tgs-v33-guard-state');
  try{
    sessionStore.delete('tgs-v33-guard-state');
    const changed=await send('EDIT',{kind:'person',id:person.id,field:'status',value:person.status},'extensionTab');
    assert.equal(changed.ok,true,'restart must not require a new account confirmation');
    const snapshot=await send('SUMMARY',{},'popup');
    assert.equal(snapshot.active.account,active.account);
  }finally{
    if(savedGuard===undefined)sessionStore.delete('tgs-v33-guard-state');
    else sessionStore.set('tgs-v33-guard-state',savedGuard);
  }
});

test('positive guard for another account never authorizes an old account edit',async()=>{
  const active=await D.getMeta('active');
  const person=(await D.getAllFor('people',active.account))[0];
  const savedGuard=sessionStore.get('tgs-v33-guard-state');
  try{
    sessionStore.set('tgs-v33-guard-state',{mode:'WRITE',account:'verified:'+'f'.repeat(32),at:Date.now()});
    const r=await send('EDIT',{kind:'person',id:person.id,field:'status',value:'APPROVED'},'popup');
    assert.equal(r.ok,false);assert.match(r.error,/不一致/);
  }finally{
    if(savedGuard===undefined)sessionStore.delete('tgs-v33-guard-state');
    else sessionStore.set('tgs-v33-guard-state',savedGuard);
  }
});

test('partial Teams cache is diagnostic only and cannot alter stored membership',async()=>{
  const active=await D.getMeta('active');
  const before=JSON.stringify(await D.getAllFor('groups',active.account));
  const input=payload([row(0,[1,2,1000,999999])],'8:live:cid.LEGACYLINK');
  input.payload.stats.partial=true;
  const result=await send('INGEST',input);
  assert.equal(result.readOnly,true);
  assert.match(result.guardReason,/不完整/);
  assert.equal(JSON.stringify(await D.getAllFor('groups',active.account)),before);
  const state=await send('SUMMARY',{},'popup');
  assert.equal(state.guard.mode,'READ_ONLY');
  assert.equal(state.status.level, state.counts?.newUnknown||state.counts?.openUrgent?'alert':'readonly');
});

test('worker explicitly supplies active account to recovery restore and verification',async()=>{
  const active=await D.getMeta('active');
  const originalRestore=R.restoreMissing,originalVerify=R.verifyCheckpoint;
  const savedGuard=sessionStore.get('tgs-v33-guard-state');
  let restoreAccount='',verifyAccount='';
  try{
    sessionStore.set('tgs-v33-guard-state',{mode:'WRITE',account:active.account,at:Date.now()});
    const cp=await send('CREATE_CHECKPOINT',{},'popup');
    assert.equal(cp.ok,true);
    R.verifyCheckpoint=async(...args)=>{verifyAccount=args[2];return {ok:true,missing:0};};
    R.restoreMissing=async(...args)=>{restoreAccount=args[3];return {ok:true,added:0,unchanged:0};};
    const result=await send('RESTORE_MISSING',{id:cp.id},'extensionTab');
    assert.equal(result.ok,true);
    assert.equal(restoreAccount,active.account);
    assert.equal(verifyAccount,active.account);
  }finally{
    R.restoreMissing=originalRestore;R.verifyCheckpoint=originalVerify;
    if(savedGuard===undefined)sessionStore.delete('tgs-v33-guard-state');
    else sessionStore.set('tgs-v33-guard-state',savedGuard);
  }
});

test('privileged worker rejects malformed cache payload fields before touching records',async()=>{
  const active=await D.getMeta('active');
  const before=JSON.stringify(await D.getAllFor('groups',active.account));
  for(const change of [
    p=>{p.dbName='Teams:conversation-manager:'+('x'.repeat(800));},
    p=>{p.stats.records=-1;},
    p=>{delete p.stats.partial;},
    p=>{p.rows[0].quality='SERVER_AUTHENTICATED';},
    p=>{p.nameHints=Array.from({length:16001},()=>({id:personId(1),name:'test'}));},
  ]){
    const x=payload([row(1,[1,2,3])]);change(x.payload);
    const r=await send('INGEST',x);
    assert.equal(r.ok,false);
  }
  assert.equal(JSON.stringify(await D.getAllFor('groups',active.account)),before);
});

test('scan failure records a useful local diagnostic, without changing the member baseline',async()=>{
  const before=JSON.stringify([...tables.get('groups')]);
  const scan=await send('SCAN_NOW',{},'popup');
  assert.equal(scan.ok,false);
  assert.match(scan.error,/Teams/);
  const overview=await send('SUMMARY',{},'popup');
  assert.ok(overview.status.scanHealth.failedConsecutive>=1);
  assert.match(overview.status.scanHealth.lastError,/Teams/);
  assert.equal(JSON.stringify([...tables.get('groups')]),before);
});

test('concurrent alarm and user clicks share one in-flight Teams scan and recover on success',async()=>{
  const originalQuery=chrome.tabs.query,originalSend=chrome.tabs.sendMessage;
  let started=0,release;
  chrome.tabs.query=async()=>[{id:42,active:true,url:'https://teams.live.com/v2/'}];
  chrome.tabs.sendMessage=async()=>{started++;return new Promise(resolve=>{release=()=>resolve({ok:true,scanned:400});});};
  try{
    const requests=[send('SCAN_NOW',{},'popup'),send('SCAN_NOW',{},'popup')];
    for(let i=0;i<10&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(started,1,'one tab message even with overlapping manual scans');
    release();
    const outcomes=await Promise.all(requests);
    assert.ok(outcomes.every(x=>x.ok));
    const overview=await send('SUMMARY',{},'popup');
    assert.equal(overview.status.scanHealth.failedConsecutive,0);
    assert.equal(overview.status.scanHealth.lastError,'');
  }finally{chrome.tabs.query=originalQuery;chrome.tabs.sendMessage=originalSend;}
});

test('read-only yellow status merges different persisted and observed group IDs exactly once',async()=>{
  const active=await D.getMeta('active');
  const accounts=[...new Set([...tables.get('groups').values()].map(g=>g.account))];
  const account=accounts.find(acc=>[...tables.get('groups').values()].filter(g=>g.account===acc).length>=2);
  const existing=await D.getAllFor('groups',account);
  const [a,b]=existing;
  assert.ok(a&&b&&a.id!==b.id);
  const savedGroups=existing.map(g=>structuredClone(g));
  const savedGuard=sessionStore.get('tgs-v33-guard-state');
  try{
    tables.get('meta').set('active',{...active,account});
    for(const g of existing)tables.get('groups').set(g.pk,{...g,ambiguous:g.id===a.id});
    sessionStore.set('tgs-v33-guard-state',{mode:'READ_ONLY',account,
      inspected:400,compared:400,ambiguous:1,ambiguousGroupIds:[b.id],observedAdded:0,at:Date.now()});
    const persistent=(await D.getAllFor('groups',account)).filter(g=>g.ambiguous).map(g=>g.id);
    const correct=new Set([...persistent,a.id,b.id]).size;
    const status=await send('SUMMARY',{},'popup');
    assert.equal(status.status.ambiguous,correct);
    assert.ok(correct>=2);
    const overlay=await send('OVERLAY_STATUS',{},'page');
    assert.equal(overlay.ambiguous,correct,'popup and on-page indicator use exact same union');
    assert.equal(overlay.guard?.ambiguousGroupIds,undefined,'status overlay never receives raw group IDs');
  }finally{
    for(const g of savedGroups)tables.get('groups').set(g.pk,g);
    tables.get('meta').set('active',active);
    if(savedGuard===undefined)sessionStore.delete('tgs-v33-guard-state');
    else sessionStore.set('tgs-v33-guard-state',savedGuard);
  }
});

test('background foreground success clears a previous alarm failure without user action',async()=>{
  const first=await send('SCAN_NOW',{},'popup');
  assert.equal(first.ok,false);
  const before=await send('SUMMARY',{},'popup');
  assert.ok(before.status.scanHealth.failedConsecutive>=1);
  const healthy=await send('INGEST',payload(Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i])),''));
  assert.equal(healthy.ok,true);
  const recovered=await send('SUMMARY',{},'popup');
  assert.equal(recovered.status.scanHealth.failedConsecutive,0);
  assert.equal(recovered.status.scanHealth.lastError,'');
});

test('incomplete IndexedDB data remains read-only with accurate yellow explanation and recovers automatically',async()=>{
  const active=await D.getMeta('active');
  const original=JSON.stringify(await D.getAllFor('groups',active.account));
  const broken=payload([row(0,[1,2,1000])],'');
  broken.payload.stats.partial=true;
  broken.payload.stats.rosterDatabaseErrors=1;
  const incomplete=await send('INGEST',broken);
  assert.equal(incomplete.ok,true);
  assert.equal(incomplete.incomplete,true);
  assert.equal(JSON.stringify(await D.getAllFor('groups',active.account)),original);
  const waiting=await send('SUMMARY',{},'popup');
  assert.equal(waiting.guard.readerDegraded,true);
  assert.ok(waiting.status.scanHealth.failedConsecutive>=1);
  const overlay=await send('OVERLAY_STATUS',{},'page');
  assert.equal(overlay.guard.readerDegraded,true);
  const healthy=await send('INGEST',payload(Array.from({length:400},(_,i)=>row(i,[1,2+i,1000+i])),''));
  assert.equal(healthy.ok,true);
  const after=await send('SUMMARY',{},'popup');
  assert.notEqual(after.guard?.readerDegraded,true);
  assert.equal(after.status.scanHealth.failedConsecutive,0);
});
