const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {worker,root}=require('./worker-harness.cjs');
const A='verified:'+'a'.repeat(32),B='verified:'+'b'.repeat(32),SELF='8:live:self';
const G='19:stale-gone@thread.v2',H='19:also-left@thread.v2',K='19:still-here@thread.v2';
async function setup(){
  const w=worker(),now=Date.now();await w.run('ensureUpgradeReady()');
  await w.db.putMeta({pk:'active',account:A,verified:true,at:1,scanTabId:7});
  await w.db.putMeta({pk:'account:'+A,account:A,manualBound:true,manualSelfId:SELF});
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},scanTabId:7,at:1})`);
  for(const [id,left] of [[G,false],[H,true],[K,false]]){
    w.db.tables.groups.set(w.db.pk(A,id),{pk:w.db.pk(A,id),account:A,id,level:'STANDARD',
      membershipStatus:left?'LEFT':'UNMARKED',ambiguous:true,
      memberIds:[SELF,'8:live:old'],pendingRosterIds:[SELF,'8:live:new'],
      pendingRevision:'oldRevision',pendingSnapshotAt:now-86400000,ambiguousReason:'名单减少或替换'});
    const eid='old-event-'+id;w.db.tables.events.set(w.db.pk(A,eid),{pk:w.db.pk(A,eid),id:eid,
      account:A,groupId:id,type:'ROSTER_UNCERTAIN',status:'OPEN',severity:'REVIEW',at:now-86400000});
  }
  w.db.tables.people.set(w.db.pk(A,'8:live:new'),{pk:w.db.pk(A,'8:live:new'),account:A,id:'8:live:new',status:'NEW'});
  return w;
}
const group=(w,id)=>w.db.tables.groups.get(w.db.pk(A,id));
const events=w=>w.db.getAllFor('events',A);
test('真正退群后，旧候选名单过期也能一次关闭提醒并扣一个群',async()=>{
  const w=await setup();const r=await w.message({action:'BULK_GROUP',ids:[G],kind:'membership',value:'LEFT',confirmed:true});
  assert.equal(r.ok,true);assert.equal(r.changed,1);assert.equal(r.alertsClosed,1);
  assert.equal(group(w,G).membershipStatus,'LEFT');assert.equal(group(w,G).ambiguous,false);
  assert.deepEqual(group(w,G).memberIds,[SELF,'8:live:old']);
  assert.equal(group(w,G).pendingRosterIds,undefined);
  assert.equal((await events(w)).find(e=>e.type==='ROSTER_UNCERTAIN'&&e.groupId===G).status,'ACKNOWLEDGED');
  assert.equal((await events(w)).find(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').candidateMemberIds[1],'8:live:new');
  assert.equal(w.db.tables.people.get(w.db.pk(A,'8:live:new')).status,'NEW');
  assert.equal((await w.run(`counts(${JSON.stringify(A)})`)).trackedGroups,1);
});
test('旧版本已记录退群但仍有黄色提醒，重复确认也能修复而不二次扣群',async()=>{
  const w=await setup();const before=(await w.run(`counts(${JSON.stringify(A)})`)).trackedGroups;
  const r=await w.message({action:'BULK_GROUP',ids:[H],kind:'membership',value:'LEFT',confirmed:true});
  assert.equal(r.ok,true);assert.equal(r.changed,0);assert.equal(r.alertsClosed,1);
  assert.equal((await w.run(`counts(${JSON.stringify(A)})`)).trackedGroups,before);
  assert.equal(group(w,H).ambiguous,false);
  const again=await w.message({action:'BULK_GROUP',ids:[H],kind:'membership',value:'LEFT',confirmed:true});
  assert.equal(again.changed,0);assert.equal(again.alertsClosed,0);
  assert.equal((await events(w)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE'&&e.groupId===H).length,1);
});
test('单群确认退群也修复已退出但仍留旧黄色提醒的记录',async()=>{
  const w=await setup();const r=await w.message({action:'SET_GROUP_MEMBERSHIP',id:H,
    value:'LEFT',expectedStatus:'LEFT',confirmed:true});
  assert.equal(r.ok,true);assert.equal(r.changed,false);assert.equal(r.alertsClosed,1);
  assert.equal(group(w,H).ambiguous,false);
  assert.deepEqual(group(w,H).memberIds,[SELF,'8:live:old']);
});
test('多个旧提醒批量结束：只变动实际需要的退出标记，保留原来的各项历史',async()=>{
  const w=await setup();const r=await w.message({action:'BULK_GROUP',ids:[G,H],kind:'membership',value:'LEFT',confirmed:true});
  assert.equal(r.ok,true);assert.equal(r.changed,1);assert.equal(r.alertsClosed,2);
  assert.equal(group(w,K).ambiguous,true);assert.equal(group(w,K).membershipStatus,'UNMARKED');
  assert.equal((await events(w)).filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,2);
});
test('未确认不能操作，跨账号/无效群必须全部回滚，不能顺手消除其他提醒',async()=>{
  const w=await setup();const no=await w.message({action:'BULK_GROUP',ids:[G],kind:'membership',value:'LEFT',confirmed:false});
  assert.equal(no.ok,false);assert.equal(group(w,G).ambiguous,true);
  const bad=await w.message({action:'BULK_GROUP',ids:[G,'19:notfound@thread.v2'],kind:'membership',value:'LEFT',confirmed:true});
  assert.equal(bad.ok,false);assert.equal(group(w,G).membershipStatus,'UNMARKED');
  await w.run(`saveGuard({mode:'READ_ONLY',account:${JSON.stringify(B)},at:${Date.now()}})`);
  const other=await w.message({action:'BULK_GROUP',ids:[G],kind:'membership',value:'LEFT',confirmed:true});
  assert.equal(other.ok,false);assert.equal(group(w,G).ambiguous,true);
});
test('若没有明确本人退出确认，不会采用过期人员名单或关闭黄色提醒',async()=>{
  const w=await setup();const r=await w.message({action:'BULK_CONFIRM_ROSTER',confirmed:true,
    items:[{id:G,revision:'oldRevision'}]});
  assert.equal(r.ok,false);assert.equal(group(w,G).ambiguous,true);
  assert.equal(group(w,G).membershipStatus,'UNMARKED');
});
test('界面同时提供快捷退群处理和单次确认，重新读取只用于仍在群内',()=>{
  const ui=fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
  const bg=fs.readFileSync(path.join(root,'background.js'),'utf8');
  assert.match(ui,/finishExitedAlerts\(/);
  assert.match(ui,/我已退群，关闭提醒/);
  assert.match(ui,/if\(g\.membershipStatus!=='LEFT'\)control\.append\(click\('重新读取群名单'/);
  assert.match(ui,/if\(!confirm\(`请确认：你本人已经在 Teams 退出/);
  assert.match(ui,/kind:'membership',value:'LEFT',confirmed:true/);
  assert.match(bg,/BULK_ALREADY_LEFT_REPAIR/);
});
