const {test}=require('node:test'),assert=require('node:assert/strict');
const {worker}=require('./worker-harness.cjs');
const ACCOUNT='verified:'+'a'.repeat(32),OTHER='verified:'+'b'.repeat(32);
const G='19:auto-leave@thread.v2';
const sender={id:'unit',frameId:0,tab:{id:7},url:'https://teams.live.com/v2/'};
async function setup(){
  const w=worker();await w.run('ensureUpgradeReady()');
  await w.db.putMeta({pk:'active',account:ACCOUNT,verified:true,scanTabId:7,at:Date.now()});
  await w.db.putMeta({pk:'account:'+ACCOUNT,account:ACCOUNT,manualBound:true,verified:true,manualSelfId:'8:live:self'});
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(ACCOUNT)},scanTabId:7,at:Date.now()})`);
  w.db.tables.groups.set(w.db.pk(ACCOUNT,G),{pk:w.db.pk(ACCOUNT,G),account:ACCOUNT,id:G,
    memberIds:['8:live:self'],level:'STANDARD',membershipStatus:'UNMARKED'});
  return w;
}
const leave=(w,id=G,source=sender,patch={})=>w.message({action:'AUTO_GROUP_MEMBERSHIP',chatId:id,
  kind:'LEFT',evidence:'DIALOG_DISMISSED_AFTER_CONFIRM',observedAt:Date.now(),...patch},source);
const group=w=>w.db.tables.groups.get(w.db.pk(ACCOUNT,G));
test('群数自动扣一：不删除历史、成员、审计，自动来源可辨认',async()=>{
  const w=await setup();const result=await leave(w);assert.equal(result.status,'AUTO_LEFT');
  const count=await w.run(`counts(${JSON.stringify(ACCOUNT)})`);
  assert.equal(count.groups,1);assert.equal(count.trackedGroups,0);assert.equal(count.autoLeftGroups,1);
  assert.equal(group(w).membershipMethod,'TEAMS_UI_OBSERVED');
  assert.deepEqual(group(w).memberIds,['8:live:self']);
  assert.equal((await w.db.getAllFor('events',ACCOUNT)).filter(e=>e.type==='GROUP_MEMBERSHIP_UI_OBSERVED').length,1);
  const stats=await w.message({action:'SUMMARY'});
  assert.equal(stats.membershipAutomation.status,'AUTO_LEFT');
});
test('同一个群重复退出事件只扣一次，用户撤销后恢复',async()=>{
  const w=await setup();await leave(w);
  assert.equal((await leave(w)).status,'ALREADY_LEFT');
  assert.equal((await w.db.getAllFor('events',ACCOUNT)).length,1);
  assert.equal((await w.message({action:'SET_GROUP_MEMBERSHIP',id:G,value:'UNMARKED',expectedStatus:'LEFT',confirmed:true})).ok,true);
  assert.equal((await w.run(`counts(${JSON.stringify(ACCOUNT)})`)).trackedGroups,1);
});
test('没有建档的群不会改写总数或虚构历史',async()=>{
  const w=await setup();const result=await leave(w,'19:not-indexed@thread.v2');
  assert.equal(result.status,'NOT_INDEXED');
  assert.equal((await w.run(`counts(${JSON.stringify(ACCOUNT)})`)).trackedGroups,1);
});
test('跨账号、错误巡检标签页、过期巡检及只读状态均禁止自动扣数',async()=>{
  const w=await setup();
  assert.equal((await leave(w,G,{...sender,tab:{id:9}})).ok,false);
  assert.equal(group(w).membershipStatus,'UNMARKED');
  await w.run(`saveGuard({mode:'READ_ONLY',account:${JSON.stringify(OTHER)},at:Date.now(),scanTabId:7})`);
  assert.equal((await leave(w)).ok,false);
  assert.equal(group(w).membershipStatus,'UNMARKED');
  await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(ACCOUNT)},at:Date.now()-999999,scanTabId:7})`);
  assert.equal((await leave(w)).ok,false);
  assert.equal(group(w).membershipStatus,'UNMARKED');
});
test('未知页面、伪造时间、凭据或错误事件类型不准触发写入',async()=>{
  const w=await setup();
  for(const source of [{...sender,id:'external'}, {...sender,url:'chrome-extension://unit/popup/popup.html'},{...sender,frameId:1}]){
    const result=await leave(w,G,source);assert.equal(result,undefined);
  }
});

test('合规页面也无法用伪造证据或陈旧时间通过后台校验',async()=>{
  const w=await setup();
  assert.equal((await leave(w,G,sender,{evidence:'CLICK_ONLY'})).ok,false);
  assert.equal((await leave(w,G,sender,{observedAt:Date.now()-200000})).ok,false);
  assert.equal((await leave(w,G,sender,{kind:'UNMARKED'})).ok,false);
  assert.equal(group(w).membershipStatus,'UNMARKED');
});

test('缺失准确群 ID 只提示原因，不修改群组及安全历史',async()=>{
  const w=await setup();const before=(await w.db.getAllFor('events',ACCOUNT)).length;
  const r=await w.message({action:'GROUP_MEMBERSHIP_DIAGNOSTIC',code:'NO_EXACT_GROUP_ID',observedAt:Date.now()},sender);
  assert.equal(r.ok,true);
  assert.equal((await w.message({action:'SUMMARY'})).membershipAutomation.status,'NO_EXACT_GROUP_ID');
  assert.equal(group(w).membershipStatus,'UNMARKED');
  assert.equal((await w.db.getAllFor('events',ACCOUNT)).length,before);
});
test('只有实际 Teams 页面与当前巡检标签一致才能发布诊断',async()=>{
  const w=await setup();
  const msg={action:'GROUP_MEMBERSHIP_DIAGNOSTIC',code:'NO_EXACT_GROUP_ID',observedAt:Date.now()};
  assert.equal(await w.message(msg,{...sender,id:'external'}),undefined);
  assert.equal((await w.message(msg,{...sender,tab:{id:9}})).ok,false);
  assert.equal((await w.message({...msg,code:'USER_REQUEST_LEFT'},sender)).ok,false);
  assert.equal((await w.message({action:'SUMMARY'})).membershipAutomation,null);
});
test('相同公开版本号的旧构建仍能刷新内部升级保护标记',async()=>{
  const w=worker();await w.db.putMeta({pk:'upgrade-safety',version:'1.0.2',featureBuild:'old-feature',ready:true});
  const marker=await w.run('ensureUpgradeReady()');
  assert.equal(marker.version,'1.0.2');
  assert.equal(marker.featureBuild,'group-history-2026-11-01-r9');
  assert.equal((await w.run('ensureUpgradeReady()')).featureBuild,marker.featureBuild);
});
