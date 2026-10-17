const {test}=require('node:test'),assert=require('node:assert/strict');
const {worker}=require('./worker-harness.cjs');
const A='verified:'+'a'.repeat(32), SELF='8:live:self00001', OTHER='8:live:other00002';
const G='19:safe-review@thread.v2';
async function setup(){
  const w=worker(),now=Date.now();
  await w.run('ensureUpgradeReady()');
  await w.db.putMeta({pk:'active',account:A,verified:true,at:now,scanTabId:7});
  await w.db.putMeta({pk:'account:'+A,account:A,manualBound:true,verified:true,manualSelfId:SELF});
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},at:${now},scanTabId:7})`);
  w.db.tables.people.set(w.db.pk(A,OTHER),{pk:w.db.pk(A,OTHER),account:A,id:OTHER,status:'NEW',companyApproved:false,name:'来访者'});
  const group={pk:w.db.pk(A,G),account:A,id:G,memberIds:[SELF,'8:live:previous'],
    ambiguous:true,pendingRosterIds:[SELF,OTHER],pendingRevision:'rev1',pendingSnapshotAt:now,
    pendingQuality:'CACHE_OBSERVED',quality:'CACHE_OBSERVED',pendingCountOffset:null};
  w.db.tables.groups.set(group.pk,group);
  return w;
}
const person=w=>w.db.getAllFor('people',A).then(list=>list.find(p=>p.id===OTHER));
async function editTrust(w,field='status',value='APPROVED'){
  w.context.targetEdit={kind:'person',id:OTHER,field,value};return w.run('edit(targetEdit)');
}
async function changeActive(w,key,val){const row=await w.db.getMeta('active');row[key]=val;await w.db.putMeta(row);}
async function changeGuard(w,overrides){const now=Date.now();const next={mode:'WRITE',account:A,scanTabId:7,at:now,...overrides};w.context.nextGuard=next;await w.run('saveGuard(nextGuard)');}
const group=w=>w.db.getAllFor('groups',A).then(items=>items.find(g=>g.id===G));
const adopt=w=>{w.context.roster={id:G,revision:'rev1'};return w.run('confirmRosterReview(roster)');};
async function request(w){
  const id='contact-'+'a'.repeat(48),row={pk:w.db.pk(A,id),id,account:A,type:'CONTACT_REQUEST',status:'OPEN',
    personId:OTHER,nameSnapshot:'来访者',reviewRevision:1,at:Date.now()};
  w.db.tables.events.set(row.pk,row);
  w.context.reviewRequest={account:A,id,revision:1,decision:'VERIFY',confirmed:true,personId:OTHER,last6:OTHER.slice(-6)};
  return row;
}
test('过期 active 禁止单个人员授信，恢复新巡检后无需重新人工绑定即可操作',async()=>{
  const w=await setup();await changeActive(w,'at',1);
  await assert.rejects(editTrust(w),/立即巡检/);assert.equal((await person(w)).status,'NEW');
  await changeActive(w,'at',Date.now());await editTrust(w);
  assert.equal((await person(w)).status,'APPROVED');
});
test('过期 guard 禁止修改公司可信标记，不影响普通人员备注',async()=>{
  const w=await setup();await changeGuard(w,{at:1});
  await assert.rejects(editTrust(w,'companyApproved',true),/立即巡检/);
  assert.equal((await person(w)).companyApproved,false);
  await editTrust(w,'manualName','我的备注');assert.equal((await person(w)).manualName,'我的备注');
});
test('过期或未来巡检状态禁止采用名单，不改群组基线',async()=>{
  const w=await setup();await changeGuard(w,{at:1});
  await assert.rejects(adopt(w),/立即巡检/);
  assert.deepEqual((await group(w)).memberIds,[SELF,'8:live:previous']);
  await changeGuard(w,{at:Date.now()+60000});
  await assert.rejects(adopt(w),/立即巡检/);
  assert.deepEqual((await group(w)).memberIds,[SELF,'8:live:previous']);
});
test('最近巡检 Teams 标签页不一致时拒绝批量修改人员状态',async()=>{
  const w=await setup();await changeGuard(w,{scanTabId:99});
  w.context.ids=[OTHER];await assert.rejects(w.run('bulkPeople(ids,"APPROVED")'),/立即巡检/);
  assert.equal((await person(w)).status,'NEW');
});
test('重启后缺少 guard 只阻止敏感操作；完成一次巡检后可操作',async()=>{
  const w=await setup();await w.run('saveGuard(null)');
  await assert.rejects(editTrust(w),/立即巡检/);assert.equal((await person(w)).status,'NEW');
  await changeGuard(w,{});await editTrust(w);assert.equal((await person(w)).status,'APPROVED');
});
test('好友请求核实身份需新鲜巡检；过期时 KEEP 和 CLOSE 不被误阻止',async()=>{
  const w=await setup();const row=await request(w);await changeActive(w,'at',1);
  await assert.rejects(w.run('reviewContactRequest(reviewRequest)'),/立即巡检/);
  assert.equal((await person(w)).status,'NEW');
  w.context.reviewRequest={...w.context.reviewRequest,decision:'CLOSE',confirmed:false};
  await assert.rejects(w.run('reviewContactRequest(reviewRequest)'),/单独确认/);
  w.context.reviewRequest.confirmed=true;
  await w.run('reviewContactRequest(reviewRequest)');
  assert.equal((await person(w)).status,'NEW');
  assert.equal((await w.db.getAllFor('events',A)).find(e=>e.id===row.id).status,'ACKNOWLEDGED');
});
test('有效巡检允许采用最新候选名单，仍不自动批准陌生人',async()=>{
  const w=await setup();const result=await adopt(w);
  assert.equal(result.ok,true);assert.deepEqual((await group(w)).memberIds,[SELF,OTHER]);
  assert.equal((await person(w)).status,'NEW');
});
test('有效巡检允许批量审核以及明确核实好友请求',async()=>{
  const w=await setup();await request(w);
  await w.run('reviewContactRequest(reviewRequest)');assert.equal((await person(w)).status,'APPROVED');
  await w.run('bulkPeople(["'+OTHER+'"],"REVOKED")');assert.equal((await person(w)).status,'REVOKED');
});
