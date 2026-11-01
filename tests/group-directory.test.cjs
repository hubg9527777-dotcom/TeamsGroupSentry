const {test}=require('node:test');
const assert=require('node:assert/strict');
const {preview}=require('../lib/group-directory.js');
const now=Date.UTC(2026,10,1,12);
test('inline list shows new and missing people from full 60-day events, newest first',()=>{
 const records=[{at:now-2*86400000,added:['a'],missing:['b']},{at:now-55*86400000,added:['c'],missing:['d']}];
 const data=preview(records,60,now);
 assert.deepEqual(data.added.map(x=>x.id),['a','c']);
 assert.deepEqual(data.missing.map(x=>x.id),['b','d']);
});
test('preview excludes older, future and invalid events without changing records',()=>{
 const records=[{at:now-61*86400000,added:['old']},{at:now+40000,added:['future']},{at:0,missing:['bad']},{at:now,added:['x','x',null],missing:['z']}];
 const data=preview(records,60,now);
 assert.deepEqual(data.added.map(x=>x.id),['x']);assert.deepEqual(data.missing.map(x=>x.id),['z']);
 assert.equal(records[3].added.length,3);
});
test('snapshot names are only attributed to a single ID with direct evidence',()=>{
 const data=preview([{at:now,added:['a','b'],nameSnapshot:'错误名字'},{at:now-1,added:['c'],nameSnapshot:'正确名字'}],60,now);
 assert.equal(data.added[0].nameSnapshot,'');assert.equal(data.added[1].nameSnapshot,'');assert.equal(data.added[2].nameSnapshot,'正确名字');
});

test('unsaved pending roster change appears inline without falsely treating it as saved history',()=>{
 const r=preview([],60,now,{source:'candidate',at:now-3000,added:['x'],missing:['y']});
 assert.equal(r.added[0].kind,'pending');assert.equal(r.missing[0].kind,'pending');
});
test('candidate already in saved observation does not create a second person event',()=>{
 const r=preview([{at:now-5000,added:['x'],missing:['y']}],60,now,{source:'candidate',at:now-3000,added:['x'],missing:['y']});
 assert.equal(r.added.length,1);assert.equal(r.missing.length,1);
});
test('leave-marker does not get a fabricated pending join or leave',()=>{
 const r=preview([],60,now,{source:'archived',at:now,added:['x'],missing:['y']});
 assert.equal(r.added.length,0);assert.equal(r.missing.length,0);
});
