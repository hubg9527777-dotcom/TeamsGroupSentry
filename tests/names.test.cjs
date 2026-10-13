const test=require('node:test');const assert=require('node:assert/strict');
const N=require('../lib/name-core.js');
const id=n=>`8:live:.cid.${String(n).padStart(10,'0')}`;
test('Value nested profile with exact key ID resolves correctly',()=>{
  const pair=N.extract({value:{profile:{displayName:'AA-员工甲'}}},id(1),new Set([id(1)]));
  assert.deepEqual(pair,[{id:id(1),name:'AA-员工甲'}]);
});
test('record without ID or matching database key never assigns name',()=>{
  assert.deepEqual(N.extract({value:{displayName:'某人'}} ,'unrelated',new Set([id(1)])),[]);
});
test('embedded ID takes precedence over unrelated outer profile ID',()=>{
  const p=N.extract({profile:{id:id(2),displayName:'乙'}},id(1),new Set([id(1),id(2)]));
  assert.deepEqual(p,[{id:id(2),name:'乙'}]);
});
test('bulk nested array respects known ID allow-list',()=>{
  const p=N.extract({value:[{mri:id(1),friendlyName:'甲'},{mri:id(2),displayName:'乙'}]},'cache',new Set([id(1)]));
  assert.deepEqual(p,[{id:id(1),name:'甲'}]);
});
test('higher-priority profile replaces weaker name, same priority conflict never leaves a verified pair',()=>{
  const m=new Map(),stats={};N.merge(m,{id:id(1),name:'昵称'},'group',40,stats);
  N.merge(m,{id:id(1),name:'资料名'},'profile',90,stats);
  assert.equal(m.get(id(1)).name,'资料名');
  N.merge(m,{id:id(1),name:'冲突'},'profile',90,stats);
  assert.equal(m.get(id(1)).conflict,true);
});
test('group titles alone do not auto bind a six-person name list',()=>{
  const mids=Array.from({length:6},(_,i)=>id(i+1));const m=new Map(mids.map(v=>[v,{id:v,name:''}]));
  const r=N.inferTitleSuggestions([{id:'g1',memberIds:mids,titleNameHints:['1','2','3','4','5','6']}],m);
  assert.equal(r.size,0);
});
test('two distinct matching group title patterns produce only unique candidates',()=>{
  const a=id(1),b=id(2),c=id(3),d=id(4);const groups=[
    {id:'g1',memberIds:[a,b,c],titleNameHints:['甲','乙','丙']},
    {id:'g2',memberIds:[a,b,d],titleNameHints:['甲','乙','丁']},
    {id:'g3',memberIds:[a,c,d],titleNameHints:['甲','丙','丁']}];
  const r=N.inferTitleSuggestions(groups,new Map());
  assert.equal(r.get(a).name,'甲');assert.equal(r.get(a).verified,false);assert.equal(r.size,4);
});
test('duplicate signatures do not fabricate ID mappings',()=>{
  const a=id(1),b=id(2),c=id(3);const groups=[
    {id:'g1',memberIds:[a,b,c],titleNameHints:['甲','乙','丙']},
    {id:'g2',memberIds:[a,b,c],titleNameHints:['甲','乙','丙']}];
  assert.equal(N.inferTitleSuggestions(groups,new Map()).size,0);
});

test('nested collection name without its own user ID cannot inherit parent identity',()=>{
 const parent=id(11);
 assert.deepEqual(N.extract({id:parent, value:{contacts:[{displayName:'其他人'}]}},parent,new Set([parent])),[]);
});
