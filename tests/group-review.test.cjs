const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/group-review.js');
const G='19:test@thread.v2';
test('待核查候选名单优先于历史事件，展示真实完整 ID 而不是标题姓名猜测',()=>{
 const g={id:G,ambiguous:true,memberIds:['8:live:a','8:live:b'],pendingRosterIds:['8:live:b','8:live:c'],pendingSnapshotAt:12};
 const d=R.fromGroup(g,[{groupId:G,type:'ROSTER_UNCERTAIN',at:10,addedIds:['8:live:old']}]);
 assert.equal(d.source,'candidate');assert.deepEqual(d.added,['8:live:c']);assert.deepEqual(d.missing,['8:live:a']);
 assert.deepEqual(R.formatPerson('8:live:c',null),{id:'8:live:c',name:'姓名待核实',status:'UNKNOWN'});
});
test('只有历史事件时可以列出其观察差异，但需标明为旧事件',()=>{
 const d=R.fromGroup({id:G,ambiguous:true,memberIds:['8:live:a']},[
   {groupId:G,type:'ROSTER_UNCERTAIN',at:10,addedIds:['8:live:b'],removedIds:[],diffTruncated:true},
   {groupId:G,type:'ROSTER_UNCERTAIN',at:20,addedIds:[],removedIds:['8:live:a']}]);
 assert.equal(d.source,'event');assert.deepEqual(d.missing,['8:live:a']);assert.deepEqual(d.added,[]);
});
test('确定状态没有 pending，不复活老事件当实时增减',()=>{
 const d=R.fromGroup({id:G,ambiguous:false,memberIds:['8:live:a']},[{groupId:G,type:'ROSTER_UNCERTAIN',addedIds:['8:live:b']}]);
 assert.equal(d.source,'none');assert.equal(d.added.length,0);
});
test('同一个人重复候选 ID 只显示一次，明确备注名高于缓存姓名',()=>{
 const d=R.fromGroup({id:G,ambiguous:true,memberIds:['8:live:a'],pendingRosterIds:['8:live:a','8:live:b','8:live:b']});
 assert.deepEqual(d.added,['8:live:b']);
 assert.equal(R.formatPerson('8:live:b',{manualName:'人工核实名',name:'缓存名',status:'NEW'}).name,'人工核实名');
});

test('成员稳定观察增加后，列表也会直接给出新 ID，不必打开事件详情',()=>{
 const g={id:G,ambiguous:false,memberIds:['8:live:a','8:live:b']};
 const d=R.fromGroup(g,[{groupId:G,type:'OBSERVED_ADDITION',personId:'8:live:b',at:10000}]);
 assert.equal(d.source,'observed');assert.deepEqual(d.added,['8:live:b']);
});
test('人工采用缓存后的旧基线缺少成员仍显示在历史差异，不冒充实际退群',()=>{
 const g={id:G,ambiguous:false,memberIds:['8:live:b']};
 const d=R.fromGroup(g,[{groupId:G,type:'ROSTER_BASELINE_REVIEWED',at:3000,
  previousMemberIds:['8:live:a'],acceptedMemberIds:['8:live:b'],addedIds:['8:live:b'],removedIds:['8:live:a']}]);
 assert.equal(d.source,'reviewed');assert.deepEqual(d.missing,['8:live:a']);assert.deepEqual(d.added,['8:live:b']);
});
