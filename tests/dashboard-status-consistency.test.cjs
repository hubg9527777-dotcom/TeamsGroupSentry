const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const dashboard=fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'background.js'),'utf8');

test('dashboard stale warning is tied to the shared background status level',()=>{
  assert.match(dashboard,/state\.summaryLevel=summary\?\.status\?\.level\|\|''/);
  assert.match(dashboard,/state\.summaryLevel==='stale'/);
  assert.doesNotMatch(dashboard,/Date\.now\(\)-a>2\*60\*1000/);
});

test('dashboard fallback and background use the same 180 second threshold',()=>{
  assert.match(worker,/SCAN_STALE_MS=180000/);
  assert.match(dashboard,/Date\.now\(\)-a>3\*60\*1000/);
});
