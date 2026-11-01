const {test}=require('node:test');
const assert=require('node:assert/strict');
const {worker}=require('./worker-harness.cjs');
const A='verified:'+'a'.repeat(32),B='verified:'+'b'.repeat(32);
const G1='19:one@thread.v2',G2='19:two@thread.v2',SELF='8:live:self';
async function setup(){
  const w=worker();
  await w.run('ensureUpgradeReady()');
  await w.db.putMeta({pk:'active',account:A,verified:true,at:Date.now(),scanTabId:7});
  await w.db.putMeta({pk:'account:'+A,account:A,verified:true,manualBound:true,manualSelfId:SELF});
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},at:Date.now(),scanTabId:7})`);
  for(const id of [G1,G2])w.db.tables.groups.set(w.db.pk(A,id),{
    pk:w.db.pk(A,id),account:A,id,level:'STANDARD',memberIds:[SELF,'8:live:other'],
    ambiguous:true,pendingRosterIds:['8:live:other'],pendingRevision:'r1',pendingSnapshotAt:Date.now(),
    pendingQuality:'CACHE_OBSERVED',quality:'CACHE_OBSERVED',countOffset:null,
    alias:'',firstSeen:Date.now()});
  return w;
}
const flag=async(w,id,value,expectedStatus='UNMARKED',confirmed=true)=>w.message({
  action:'SET_GROUP_MEMBERSHIP',id,value,expectedStatus,confirmed});
const row=(w,id=G1)=>w.db.tables.groups.get(w.db.pk(A,id));

test('历史385=>人工退群1=>未标记退群384，历史原样保留',async()=>{
  const w=await setup();
  for(let i=0;i<383;i++){
    const id=`19:history${i}@thread.v2`;
    w.db.tables.groups.set(w.db.pk(A,id),{pk:w.db.pk(A,id),account:A,id,memberIds:[SELF],level:'STANDARD'});
  }
  let n=await w.run(`counts(${JSON.stringify(A)})`);
  assert.equal(n.groups,385);assert.equal(n.trackedGroups,385);assert.equal(n.leftGroups,0);
  const r=await flag(w,G1,'LEFT');assert.equal(r.ok,true);assert.equal(r.changed,true);
  n=await w.run(`counts(${JSON.stringify(A)})`);
  assert.equal(n.groups,385);assert.equal(n.trackedGroups,384);assert.equal(n.leftGroups,1);
  assert.equal(row(w).memberIds.length,2);assert.equal(row(w).ambiguous,false);
  assert.equal((await w.db.getAllFor('events',A)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,1);
  assert.equal((await w.run('statusSnapshot()')).groups,384);
  const summary=await w.message({action:'SUMMARY'});
  assert.equal(summary.status.groups,384);assert.equal(summary.counts.groups,385);
  assert.equal(summary.counts.leftGroups,1);
  assert.equal((await w.db.getAllFor('events',A)).filter(e=>e.type==='GROUP_MEMBERSHIP_DECLARED').length,1);
});

test('重新加入或撤销标记可恢复计数，保留两次静默审计',async()=>{
  const w=await setup();await flag(w,G1,'LEFT');
  const r=await flag(w,G1,'UNMARKED','LEFT');assert.equal(r.ok,true);
  const n=await w.run(`counts(${JSON.stringify(A)})`);
  assert.equal(n.trackedGroups,2);assert.equal(n.groups,2);assert.equal(n.leftGroups,0);
  const events=await w.db.getAllFor('events',A);
  assert.deepEqual(events.filter(e=>e.type==='GROUP_MEMBERSHIP_DECLARED').map(e=>e.nextStatus),['LEFT','UNMARKED']);
});

test('重复退群、错误旧状态、无显式确认、伪造群 ID 不更改数据',async()=>{
  const w=await setup();
  assert.equal((await flag(w,G1,'LEFT','UNMARKED',false)).ok,false);
  assert.equal((await flag(w,'19:no@thread.v2','LEFT')).ok,false);
  assert.equal((await flag(w,'not-a-chat','LEFT')).ok,false);
  assert.equal((await flag(w,G1,'LEFT')).ok,true);
  assert.equal((await flag(w,G1,'LEFT')).ok,false);
  assert.equal((await flag(w,G1,'LEFT','LEFT')).changed,false);
  const n=await w.run(`counts(${JSON.stringify(A)})`);
  assert.equal(n.trackedGroups,1);assert.equal((await w.db.getAllFor('events',A)).filter(e=>e.type==='GROUP_MEMBERSHIP_DECLARED').length,1);
});

test('账号只读、账号不一致禁止手动退群，跨账号历史完全隔离',async()=>{
  const w=await setup();
  await w.run(`saveGuard({mode:'READ_ONLY',account:${JSON.stringify(A)}})`);
  assert.equal((await flag(w,G1,'LEFT')).ok,false);assert.equal(row(w).membershipStatus,undefined);
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(B)}})`);
  assert.equal((await flag(w,G1,'LEFT')).ok,false);
  assert.equal(row(w).membershipStatus,undefined);
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)}})`);
  assert.equal((await flag(w,G1,'LEFT')).ok,true);
  assert.equal((await w.run(`counts(${JSON.stringify(B)})`)).groups,0);
});

test('Teams 仅页面脚本无法发起退群标记',async()=>{
  const w=await setup();const sender={id:'unit',url:'https://teams.live.com/v2/',frameId:0,tab:{id:7}};
  assert.equal(await w.message({action:'SET_GROUP_MEMBERSHIP',id:G1,value:'LEFT',expectedStatus:'UNMARKED',confirmed:true},sender),undefined);
  assert.equal(row(w).membershipStatus,undefined);
});

test('退群标记在再次巡检写入缓存群名单后保持，不被缓存重新拉回',async()=>{
  const w=await setup();await flag(w,G1,'LEFT');
  w.context.rows=[{id:G1,quality:'CACHE_OBSERVED',countOffset:null,members:[{id:SELF},{id:'8:live:other'}]}];
  await w.run(`applyBatch(rows,${JSON.stringify(A)},{notifyUnknown:false,notifyKnownTransfers:false},false)`);
  assert.equal(row(w).membershipStatus,'LEFT');
  assert.equal((await w.run(`counts(${JSON.stringify(A)})`)).trackedGroups,1);
});

test('人工退群审计不会在180天常规清理中被删除',async()=>{
  const w=await setup();await flag(w,G1,'LEFT');
  const e=(await w.db.getAllFor('events',A))[0];e.at=1;w.db.tables.events.set(e.pk,e);
  await w.run(`pruneOldEvents(${JSON.stringify(A)})`);
  assert.equal((await w.db.getAllFor('events',A)).filter(e=>e.type==='GROUP_MEMBERSHIP_DECLARED').length,1);
});
