const {test}=require('node:test'),assert=require('node:assert/strict');
const {worker}=require('./worker-harness.cjs');
const A='verified:'+'a'.repeat(32),B='verified:'+'b'.repeat(32),SELF='8:live:self';
const ids=['19:a@thread.v2','19:b@thread.v2','19:c@thread.v2'];
async function setup(){const w=worker();await w.run('ensureUpgradeReady()');
 await w.db.putMeta({pk:'active',account:A,verified:true,at:Date.now(),scanTabId:7});
 await w.db.putMeta({pk:'account:'+A,account:A,verified:true,manualBound:true,manualSelfId:SELF});
 await w.run(`saveGuard({mode:'WRITE',account:${JSON.stringify(A)},at:Date.now(),scanTabId:7})`);
 for(const id of ids)w.db.tables.groups.set(w.db.pk(A,id),{pk:w.db.pk(A,id),account:A,id,memberIds:[SELF,'8:live:new'],
   ambiguous:true,level:'STANDARD',pendingRosterIds:['8:live:new'],pendingRevision:'r1'});
 return w;}
const run=(w,ids,kind,value,confirmed)=>w.message({action:'BULK_GROUP',ids,kind,value,confirmed});
test('多选批量监控级别操作是原子写入，不清除黄色名单或信任状态',async()=>{
 const w=await setup();let result=await run(w,ids,'level','CRITICAL');
 assert.equal(result.ok,true);assert.equal(result.changed,3);
 result=await run(w,ids,'level','CRITICAL');assert.equal(result.changed,0);assert.equal(result.unchanged,3);
 for(const id of ids){const g=w.db.tables.groups.get(w.db.pk(A,id));assert.equal(g.level,'CRITICAL');assert.equal(g.ambiguous,true);assert.deepEqual(g.memberIds,[SELF,'8:live:new']);}
 assert.equal((await w.db.getAllFor('events',A)).length,0);
});
test('批量退群必须确认，未确认绝不扣数，恢复标记保留逐群审计',async()=>{
 const w=await setup();assert.equal((await run(w,ids,'membership','LEFT',false)).ok,false);
 assert.equal((await w.run(`counts(${JSON.stringify(A)})`)).trackedGroups,3);
 let result=await run(w,ids.slice(0,2),'membership','LEFT',true);assert.equal(result.changed,2);
 let count=await w.run(`counts(${JSON.stringify(A)})`);assert.equal(count.groups,3);assert.equal(count.trackedGroups,1);
 assert.equal((await run(w,ids.slice(0,2),'membership','LEFT',true)).changed,0);
 result=await run(w,[ids[0]],'membership','UNMARKED',true);assert.equal(result.changed,1);
 count=await w.run(`counts(${JSON.stringify(A)})`);assert.equal(count.trackedGroups,2);
 const events=await w.db.getAllFor('events',A);assert.equal(events.filter(e=>e.type==='GROUP_MEMBERSHIP_DECLARED').length,3);
 assert.equal(events.filter(e=>e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE').length,2);
 assert.equal((await w.db.getAllFor('groups',A)).filter(g=>g.ambiguous).length,1);
});
test('无效群、重复 ID 或跨账号全数拒绝，没有部分更改',async()=>{
 const w=await setup();let r=await run(w,[ids[0],'19:notfound@thread.v2'],'level','QUIET');assert.equal(r.ok,false);
 r=await run(w,[ids[0],ids[0]],'level','QUIET');assert.equal(r.ok,false);
 r=await run(w,[ids[0]],'level','REVOKED');assert.equal(r.ok,false);
 assert.equal(w.db.tables.groups.get(w.db.pk(A,ids[0])).level,'STANDARD');
 w.db.tables.groups.set(w.db.pk(B,'19:foreign@thread.v2'),{pk:w.db.pk(B,'19:foreign@thread.v2'),account:B,id:'19:foreign@thread.v2'});
 r=await run(w,[ids[0],'19:foreign@thread.v2'],'membership','LEFT',true);assert.equal(r.ok,false);
 assert.equal((await w.db.getAllFor('events',A)).length,0);
 assert.equal((await w.run(`counts(${JSON.stringify(A)})`)).trackedGroups,3);
});
test('账号只读守护拒绝操作',async()=>{
 const w=await setup();await w.run(`saveGuard({mode:'READ_ONLY',account:${JSON.stringify(A)}})`);
 assert.equal((await run(w,ids,'level','QUIET')).ok,false);
 assert.equal((await run(w,ids,'membership','LEFT',true)).ok,false);
});
