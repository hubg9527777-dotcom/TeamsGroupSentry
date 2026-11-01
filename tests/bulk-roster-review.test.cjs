const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {worker,root}=require('./worker-harness.cjs');
const A='verified:'+'a'.repeat(32),B='verified:'+'b'.repeat(32);
const SELF='8:live:self0001',NEW='8:live:new0002',OLD='8:live:old0003';
const groupIds=['19:roster-a@thread.v2','19:roster-b@thread.v2','19:roster-c@thread.v2'];
async function setup(){
  const w=worker(),now=Date.now();await w.run('ensureUpgradeReady()');
  await w.db.putMeta({pk:'active',account:A,verified:true,at:now,scanTabId:7});
  await w.db.putMeta({pk:'account:'+A,account:A,verified:true,manualBound:true,manualSelfId:SELF});
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},at:${now},scanTabId:7})`);
  w.db.tables.people.set(w.db.pk(A,NEW),{pk:w.db.pk(A,NEW),id:NEW,account:A,status:'NEW',name:'不认识的人'});
  for(const id of groupIds){
    w.db.tables.groups.set(w.db.pk(A,id),{pk:w.db.pk(A,id),id,account:A,level:'CRITICAL',
      memberIds:[SELF,OLD],ambiguous:true,ambiguousReason:'群成员减少或替换',
      pendingRosterIds:[SELF,NEW],pendingRevision:'r1',pendingSnapshotAt:now,pendingQuality:'CACHE_OBSERVED'});
    w.db.tables.edges.set(w.db.pk(A,w.db.pk(id,OLD)),{pk:w.db.pk(A,w.db.pk(id,OLD)),account:A,groupId:id,personId:OLD});
    w.db.tables.events.set(w.db.pk(A,'uncertain-'+id),{pk:w.db.pk(A,'uncertain-'+id),id:'uncertain-'+id,
      account:A,groupId:id,type:'ROSTER_UNCERTAIN',status:'OPEN',severity:'REVIEW',at:now});
  }
  return w;
}
const items=(ids=groupIds,revision='r1')=>ids.map(id=>({id,revision}));
const run=(w,arr,confirmed=true)=>w.message({action:'BULK_CONFIRM_ROSTER',items:arr,confirmed});
const rows=w=>w.db.getAllFor('groups',A);
const edges=w=>w.db.getAllFor('edges',A);
const events=w=>w.db.getAllFor('events',A);
test('两群一次确认，更新成员和关系、消除黄色提醒，保留逐群审计且陌生人不自动批准',async()=>{
  const w=await setup();const result=await run(w,items(groupIds.slice(0,2)));
  assert.equal(result.ok,true);assert.equal(result.changed,2);assert.equal(result.added,2);assert.equal(result.removed,2);
  for(const group of await rows(w)){
    if(group.id===groupIds[2]){assert.equal(group.ambiguous,true);assert.deepEqual(group.memberIds,[SELF,OLD]);continue;}
    assert.equal(group.ambiguous,false);assert.deepEqual(group.memberIds,[SELF,NEW]);assert(!('pendingRevision' in group));
    assert(group.baselineReviewEventId);assert.equal(group.level,'CRITICAL');
  }
  const e=await edges(w);assert.equal(e.filter(v=>v.personId===NEW).length,2);
  assert.equal(e.filter(v=>v.personId===OLD).length,1);
  const logs=await events(w);assert.equal(logs.filter(v=>v.type==='ROSTER_BASELINE_REVIEWED').length,2);
  assert.equal(logs.filter(v=>v.type==='ROSTER_UNCERTAIN'&&v.status==='ACKNOWLEDGED').length,2);
  assert.equal(logs.filter(v=>v.type==='ROSTER_UNCERTAIN'&&v.status==='OPEN').length,1);
  assert.equal(w.db.tables.people.get(w.db.pk(A,NEW)).status,'NEW');
});
test('未勾选人工确认时拒绝，不能一键自动信任',async()=>{
  const w=await setup();assert.equal((await run(w,items(),false)).ok,false);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
  assert.equal((await events(w)).filter(v=>v.type==='ROSTER_BASELINE_REVIEWED').length,0);
});
test('某一群 revision 不一致时全部回滚，不能只确认一部分',async()=>{
  const w=await setup();const r=await run(w,[{id:groupIds[0],revision:'r1'},{id:groupIds[1],revision:'old'}]);
  assert.equal(r.ok,false);assert.match(r.error,/名单刚发生变化/);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
  assert.equal((await events(w)).filter(v=>v.type==='ROSTER_BASELINE_REVIEWED').length,0);
});
test('名单超过三分钟/未来时间均拒绝整个批次',async()=>{
  const w=await setup();const g=w.db.tables.groups.get(w.db.pk(A,groupIds[1]));
  g.pendingSnapshotAt=Date.now()-181000;
  assert.equal((await run(w,items(groupIds.slice(0,2)))).ok,false);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
  g.pendingSnapshotAt=Date.now()+40000;
  assert.equal((await run(w,items(groupIds.slice(0,2)))).ok,false);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
});
test('名单缺失和非法成员 ID 均不能确认',async()=>{
  const w=await setup();const g=w.db.tables.groups.get(w.db.pk(A,groupIds[1]));
  delete g.pendingRosterIds;assert.equal((await run(w,items(groupIds.slice(0,2)))).ok,false);
  g.pendingRosterIds=[SELF,SELF];assert.equal((await run(w,items(groupIds.slice(0,2)))).ok,false);
  g.pendingRosterIds=[SELF,'not-a-person'];assert.equal((await run(w,items(groupIds.slice(0,2)))).ok,false);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
});
test('重复群 ID、无效群 ID、超过 100 群都拒绝',async()=>{
  const w=await setup();assert.equal((await run(w,items([groupIds[0],groupIds[0]]))).ok,false);
  assert.equal((await run(w,[{id:'oops',revision:'r1'}])).ok,false);
  assert.equal((await run(w,Array.from({length:101},(_,i)=>({id:`19:group-${i}@thread.v2`,revision:'r1'})))).ok,false);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
});
test('另一个账号的群不能混到当前账号批量确认',async()=>{
  const w=await setup(),foreign='19:cross-account@thread.v2';
  w.db.tables.groups.set(w.db.pk(B,foreign),{pk:w.db.pk(B,foreign),account:B,id:foreign,
    ambiguous:true,memberIds:[SELF,OLD],pendingRosterIds:[SELF,NEW],pendingSnapshotAt:Date.now(),pendingRevision:'r1'});
  assert.equal((await run(w,[...items(groupIds.slice(0,1)),{id:foreign,revision:'r1'}])).ok,false);
  assert.equal(w.db.tables.groups.get(w.db.pk(B,foreign)).ambiguous,true);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
});
test('只读保护、过期巡检不能修改列表',async()=>{
  const w=await setup();await w.run(`saveGuard({mode:'READ_ONLY',account:${JSON.stringify(A)},at:Date.now()})`);
  assert.equal((await run(w,items())).ok,false);
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},scanTabId:7,at:1})`);
  assert.equal((await run(w,items())).ok,false);
  assert.equal((await rows(w)).filter(g=>g.ambiguous).length,3);
});
test('同版本号保留、批量确认只有一次确认弹窗',()=>{
  const html=fs.readFileSync(path.join(root,'ui/dashboard.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.version,'1.0.2');assert.match(html,/立即检查/);
  assert.match(ui,/确认所选名单（/);assert.match(ui,/BULK_CONFIRM_ROSTER/);
  assert.doesNotMatch(ui,/我已在 Teams 核对上面这些群/);assert.match(ui,/pendingRevision/);
});
