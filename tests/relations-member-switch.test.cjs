const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.resolve(__dirname,'../ui/dashboard.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../ui/dashboard.css'),'utf8');

test('relation-row person detail preserves its source group for switching',()=>{
  assert.match(js,/click\('查看人员',\(\)=>openPerson\(e\.personId,e\.groupId\)\)/);
  assert.match(js,/click\('人员资料',\(\)=>openPerson\(mid,id\)\)/);
  assert.match(js,/function openPerson\(id,groupId=null\)/);
});
test('in-group person selector is populated with group members and recorded relations',()=>{
  assert.match(js,/new Set\(\[\.\.\.\(group\.memberIds\|\|\[\]\),\.\.\.state\.edges\.filter\(e=>e\.groupId===groupId\)/);
  assert.match(js,/\.filter\(mid=>state\.peopleMap\.has\(mid\)\)/);
  assert.match(js,/memberSelect\.value=id/);
  assert.match(js,/memberSelect\.addEventListener\('change',\(\)=>openPerson\(memberSelect\.value,groupId\)\)/);
  assert.match(js,/memberSelect\.setAttribute\('aria-label','切换查看此群人员'\)/);
  assert.match(css,/\.member-switcher select/);
});
test('edit callbacks preserve group context after person settings save',()=>{
  const functionBody=js.split('function openPerson(id,groupId=null)')[1].split('function showReview(')[0];
  assert.match(functionBody,/manualName'.*?openPerson\(id,groupId\)/s);
  assert.match(functionBody,/status'.*?openPerson\(id,groupId\)/s);
  assert.match(functionBody,/companyApproved'.*?openPerson\(id,groupId\)/s);
});
