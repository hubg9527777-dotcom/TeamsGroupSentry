const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {worker,root}=require('./worker-harness.cjs');
const A='verified:'+'a'.repeat(32),B='verified:'+'b'.repeat(32);
const SELF='8:live:self123',ORIG='8:live:original456',CHANGED='8:live:new789';
const G='19:someone-left@thread.v2',H='19:active-changed@thread.v2';
async function setup(){
  const w=worker(),now=Date.now();await w.run('ensureUpgradeReady()');
  await w.db.putMeta({pk:'active',account:A,verified:true,at:now,scanTabId:7});
  await w.db.putMeta({pk:'account:'+A,account:A,verified:true,manualBound:true,manualSelfId:SELF});
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},scanTabId:7,at:${now}})`);
  for(const id of [G,H]){
    w.db.tables.groups.set(w.db.pk(A,id),{pk:w.db.pk(A,id),account:A,id,level:'CRITICAL',
      memberIds:[SELF,ORIG],membershipStatus:'UNMARKED',ambiguous:true,
      pendingRosterIds:[SELF,CHANGED],pendingRevision:'r1',pendingSnapshotAt:now,
      pendingQuality:'CACHE_OBSERVED',quality:'CACHE_OBSERVED',ambiguousReason:'名单出现减少或替换'});
    w.db.tables.edges.set(w.db.pk(A,w.db.pk(id,ORIG)),{pk:w.db.pk(A,w.db.pk(id,ORIG)),account:A,groupId:id,personId:ORIG});
    const eid='alert-'+id;
    w.db.tables.events.set(w.db.pk(A,eid),{pk:w.db.pk(A,eid),id:eid,account:A,groupId:id,
      type:'ROSTER_UNCERTAIN',status:'OPEN',severity:'REVIEW',at:now,
      addedIds:[CHANGED],removedIds:[ORIG]});
  }
  w.db.tables.people.set(w.db.pk(A,CHANGED),{pk:w.db.pk(A,CHANGED),account:A,id:CHANGED,status:'NEW',name:'尚未核实'});
  return w;
}
const groups=(w,id=G)=>w.db.tables.groups.get(w.db.pk(A,id));
const events=w=>w.db.getAllFor('events',A);
test('先收他人退群黄提醒，再标本人退出：同一步自动结束黄色提醒，旧名单、候选和审计保留',async()=>{
  const w=await setup();const r=await w.message({action:'SET_GROUP_MEMBERSHIP',id:G,value:'LEFT',expectedStatus:'UNMARKED',confirmed:true});
  assert.equal(r.ok,true);assert.equal(groups(w).membershipStatus,'LEFT');assert.equal(groups(w).ambiguous,false);
  assert.deepEqual(groups(w).memberIds,[SELF,ORIG]);assert.equal(groups(w).pendingRosterIds,undefined);
  const log=(await events(w)).find(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE');
  assert.deepEqual(log.previousMemberIds,[SELF,ORIG]);assert.deepEqual(log.candidateMemberIds,[SELF,CHANGED]);
  assert.deepEqual(log.removedIds,[ORIG]);assert.deepEqual(log.addedIds,[CHANGED]);
  assert.equal((await events(w)).find(e=>e.type==='ROSTER_UNCERTAIN'&&e.groupId===G).status,'ACKNOWLEDGED');
  assert.equal(w.db.tables.people.get(w.db.pk(A,CHANGED)).status,'NEW');
  assert.equal((await w.db.getAllFor('edges',A)).find(e=>e.groupId===G).personId,ORIG);
  const count=await w.run(`counts(${JSON.stringify(A)})`);
  assert.equal(count.groups,2);assert.equal(count.trackedGroups,1);assert.equal(count.ambiguous,1);
});
test('已退群后仍留在缓存的老名单不再触发黄提醒、新身份事件或把退群恢复',async()=>{
  const w=await setup();await w.message({action:'SET_GROUP_MEMBERSHIP',id:G,value:'LEFT',expectedStatus:'UNMARKED',confirmed:true});
  const num=(await events(w)).length;
  w.context.scanRows=[{id:G,quality:'CACHE_OBSERVED',countOffset:null,
    members:[{id:SELF},{id:CHANGED},{id:'8:live:cached444'}]}];
  const r=await w.run(`applyBatch(scanRows,${JSON.stringify(A)},{notifyUnknown:true},false)`);
  assert.equal(r.notifyCount,0);assert.equal(r.unknown,0);
  assert.equal(groups(w).ambiguous,false);assert.equal(groups(w).membershipStatus,'LEFT');
  assert.deepEqual(groups(w).memberIds,[SELF,ORIG]);assert.equal((await events(w)).length,num);
});
test('旧安装版本里已标退群但黄色仍在：只确认关闭，不采纳缓存成员；不要求3分钟新鲜名单',async()=>{
  const w=await setup(),g=groups(w);g.membershipStatus='LEFT';g.pendingSnapshotAt=1;
  const r=await w.message({action:'BULK_CONFIRM_ROSTER',confirmed:true,items:[{id:G,revision:''}]});
  assert.equal(r.ok,true);assert.equal(r.archived,1);assert.equal(groups(w).ambiguous,false);
  assert.deepEqual(groups(w).memberIds,[SELF,ORIG]);assert.equal(w.db.tables.people.get(w.db.pk(A,CHANGED)).status,'NEW');
  const duplicate=await w.message({action:'BULK_CONFIRM_ROSTER',confirmed:true,items:[{id:G,revision:''}]});
  assert.equal(duplicate.ok,false);assert.equal((await events(w)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,1);
});
test('混选已退出群+在群群：一次保存且不能对退出群误采纳候选名单',async()=>{
  const w=await setup();const g=groups(w);g.membershipStatus='LEFT';g.pendingSnapshotAt=1;
  const r=await w.message({action:'BULK_CONFIRM_ROSTER',confirmed:true,items:[{id:G,revision:''},{id:H,revision:'r1'}]});
  assert.equal(r.ok,true);assert.equal(r.changed,2);assert.equal(r.archived,1);
  assert.deepEqual(groups(w).memberIds,[SELF,ORIG]);assert.deepEqual(groups(w,H).memberIds,[SELF,CHANGED]);
  assert.equal((await events(w)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,1);
  assert.equal((await events(w)).filter(e=>e.type==='ROSTER_BASELINE_REVIEWED').length,1);
});
test('混选中若在群群名单过期，不得先部分结束已退群提醒',async()=>{
  const w=await setup();groups(w).membershipStatus='LEFT';groups(w,H).pendingSnapshotAt=1;
  const r=await w.message({action:'BULK_CONFIRM_ROSTER',confirmed:true,items:[{id:G,revision:''},{id:H,revision:'r1'}]});
  assert.equal(r.ok,false);assert.equal(groups(w).ambiguous,true);
  assert.equal((await events(w)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,0);
});
test('跨账号保护及本人退群操作可撤销，撤销后下一次不同成员的缓存仍提示核查',async()=>{
  const w=await setup();const left=await w.message({action:'SET_GROUP_MEMBERSHIP',id:G,value:'LEFT',expectedStatus:'UNMARKED',confirmed:true});
  assert.equal(left.ok,true);await w.run(`saveGuard({mode:'READ_ONLY',account:${JSON.stringify(B)}})`);
  assert.equal((await w.message({action:'BULK_CONFIRM_ROSTER',confirmed:true,items:[{id:H,revision:'r1'}]})).ok,false);
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},at:${Date.now()},scanTabId:7})`);
  const r=await w.message({action:'SET_GROUP_MEMBERSHIP',id:G,value:'UNMARKED',expectedStatus:'LEFT',confirmed:true});
  assert.equal(r.ok,true);w.context.scanRows=[{id:G,quality:'CACHE_OBSERVED',countOffset:null,
    members:[{id:SELF},{id:CHANGED}]}];
  await w.run(`applyBatch(scanRows,${JSON.stringify(A)},{notifyUnknown:true},false)`);
  assert.equal(groups(w).ambiguous,true);assert.equal(groups(w).membershipStatus,'UNMARKED');
});
test('旧退群提醒审计 180 天后仍保存；新版没有第三次勾选确认',async()=>{
  const w=await setup();await w.message({action:'SET_GROUP_MEMBERSHIP',id:G,value:'LEFT',expectedStatus:'UNMARKED',confirmed:true});
  const row=(await events(w)).find(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE');row.at=1;w.db.tables.events.set(row.pk,row);
  await w.run(`pruneOldEvents(${JSON.stringify(A)})`);
  assert.equal((await events(w)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,1);
  const ui=fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
  assert.match(ui,/确认所选名单（/);assert.match(ui,/if\(!confirm\(promptText\)\)return/);
  assert.doesNotMatch(ui,/batch-roster-agree/);
});
