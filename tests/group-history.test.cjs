const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('../lib/group-history.js');
const {worker}=require('./worker-harness.cjs');
const G='19:history@thread.v2',ALT='19:other@thread.v2';
const a='8:live:alpha',b='8:live:beta',c='8:live:charlie',d='8:live:delta';
const day=86400000,now=Date.now(),account='verified:'+'a'.repeat(32);
const event=(type,at,more={})=>({groupId:G,type,at,...more});
const row=(members)=>({id:G,quality:'CACHE_OBSERVED',countOffset:0,members:members.map(id=>({id,name:id===a?'李明':id===b?'张佳':id===c?'陈秀':'王莉'}))});
test('一群按时间倒序展示，其他群不可混入；7/30/90天筛选与人数汇总',()=>{
 const r=H.entries(G,[event('ROSTER_CHANGE_OBSERVED',now-3*day,{addedIds:[c],removedIds:[b]}),
  event('ROSTER_CHANGE_OBSERVED',now-35*day,{addedIds:[d],removedIds:[]}),
  {groupId:ALT,type:'ROSTER_CHANGE_OBSERVED',at:now-2*day,addedIds:[a]}]);
 assert.equal(r.length,2);assert.deepEqual(r[0].added,[c]);assert.deepEqual(r[0].missing,[b]);
 assert.equal(H.summary(r,7,now).changes,1);assert.equal(H.summary(r,30,now).missing,1);
 assert.equal(H.summary(r,90,now).added,2);
});
test('同一次变化只展示一次，不因黄色提醒或逐人审核重复计数',()=>{
 const r=H.entries(G,[event('ROSTER_CHANGE_OBSERVED',now-2000,{addedIds:[c],removedIds:[b]}),
  event('ROSTER_UNCERTAIN',now-1900,{addedIds:[c],removedIds:[b]}),
  event('FIRST_SEEN_ID',now-1800,{personId:c}),
  event('ROSTER_ALERT_CLOSED_AFTER_LEAVE',now-1000,{addedIds:[c],removedIds:[b]})]);
 assert.equal(r.length,1);assert.deepEqual(H.summary(r,30,now),{changes:1,added:1,missing:1});
});
test('本人退群后的旧记录保留；人工确认不会宣称是实际进退群时间',()=>{
 const r=H.entries(G,[event('ROSTER_BASELINE_REVIEWED',now-1000,{addedIds:[b],removedIds:[a]})]);
 assert.equal(r[0].kind,'reviewed');assert.deepEqual(r[0].missing,[a]);
});
test('时间异常、重复ID、长数组不会渗透到页面，首次发现不误称入群',()=>{
 const r=H.entries(G,[event('FIRST_SEEN_ID',now-1000,{personId:b}),
  event('ROSTER_CHANGE_OBSERVED',now-500,{addedIds:[c,c,null],removedIds:[a,a]}),
  event('ROSTER_UNCERTAIN',now+100000,{addedIds:[d]})]);
 assert.equal(r.length,2);assert.equal(r.find(x=>x.kind==='firstSeen').added[0],b);
 assert.equal(r.find(x=>x.kind==='observed').added.length,1);
});
test('真实 worker：缓存减少或替换仍记录历史，即使未通知也不重复；按账号隔离',async()=>{
 const w=worker();w.context.incoming=[row([a,b])];
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false,notifyKnownTransfers:false},true)`);
 w.context.incoming=[row([a,c])];
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false,notifyKnownTransfers:false},false)`);
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false,notifyKnownTransfers:false},false)`);
 const records=(await w.db.getAllFor('events',account)).filter(e=>e.type==='ROSTER_CHANGE_OBSERVED');
 assert.equal(records.length,1);assert.deepEqual([...records[0].addedIds],[c]);assert.deepEqual([...records[0].removedIds],[b]);
 assert.equal(records[0].status,'LOGGED');assert.equal(records[0].severity,'SILENT');
 assert.equal((await w.db.getAllFor('events','verified:'+'b'.repeat(32))).length,0);
});
test('真实 worker：稳定新增只记录一次，已标记退群不产生新增记录',async()=>{
 const w=worker();w.context.incoming=[row([a,b])];
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false},true)`);
 w.context.incoming=[row([a,b,c])];
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false},false)`);
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false},false)`);
 const groups=await w.db.getAllFor('groups',account);groups[0].membershipStatus='LEFT';
 w.db.tables.groups.set(groups[0].pk,groups[0]);
 w.context.incoming=[row([a,b,c,d])];
 await w.run(`applyBatch(incoming,${JSON.stringify(account)},{notifyUnknown:false},false)`);
 assert.equal((await w.db.getAllFor('events',account)).filter(e=>e.type==='ROSTER_CHANGE_OBSERVED').length,1);
});

test('核对同一次变化不会重复增加近30天的变更次数，保留核对日期',()=>{
 const r=H.entries(G,[event('ROSTER_CHANGE_OBSERVED',now-2*day,{addedIds:[c],removedIds:[b]}),
  event('ROSTER_BASELINE_REVIEWED',now-day,{addedIds:[c],removedIds:[b]})]);
 assert.equal(r.length,1);assert.equal(r[0].reviewedAt,now-day);assert.equal(r[0].at,now-2*day);
});

test('60天默认查看窗口：45天前可见，65天前不计入，已有30天筛选继续可用',()=>{
 const sample=H.entries(G,[event('ROSTER_CHANGE_OBSERVED',now-45*day,{addedIds:[d]}),
   event('ROSTER_CHANGE_OBSERVED',now-65*day,{removedIds:[b]})]);
 assert.equal(H.summary(sample,60,now).changes,1);
 assert.equal(H.summary(sample,30,now).changes,0);
 assert.equal(H.summary(sample,90,now).changes,2);
 assert.deepEqual(H.filter(sample,60,now).map(e=>e.added[0]),[d]);
});

test('大量历史事件的重复判断使用索引，不反复读取全部记录',()=>{
 let idReads=0;
 const rows=[];
 const ts=now-3600000;
 for(let i=0;i<1600;i++){
   // Each event can originate from a user-supplied historic backup; reading
   // all prior events for each new event would freeze the dashboard.
   const e={groupId:G,type:i%2?'ROSTER_UNCERTAIN':'ROSTER_CHANGE_OBSERVED',at:ts-i*40000,id:`bulk${i}`,
     get addedIds(){idReads++;return ['8:live:member'+i];},
     get removedIds(){idReads++;return ['8:live:old'+i];}};
   rows.push(e);
 }
 const result=H.entries(G,rows,now);
 assert.equal(result.length,300);
 assert(idReads<5000,`each history event should be normalized once, but read ${idReads} input arrays`);
});

test('含有分隔符的不同 ID 组合不能碰撞为同一人员变化',()=>{
 const at=now-30000;
 const one=event('ROSTER_CHANGE_OBSERVED',at,{addedIds:['8:live:a,b','8:live:c'],removedIds:[]});
 const two=event('ROSTER_CHANGE_OBSERVED',at,{addedIds:['8:live:a','8:live:b,c'],removedIds:[]});
 const all=H.entries(G,[one,two],now);
 assert.equal(all.length,2);
 assert.notDeepEqual(all[0].added,all[1].added);
});
