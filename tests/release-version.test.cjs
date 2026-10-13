const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('public release version matches manifest and package',()=>{
  assert.equal(JSON.parse(read('manifest.json')).version,'1.0.0');
  assert.equal(JSON.parse(read('package.json')).version,'1.0.0');
});
test('all displayed release versions and background marker are v1.0.0',()=>{
  assert.match(read('popup/popup.html'),/TEAMSGROUPSENTRY · V1\.0\.0/);
  assert.match(read('ui/dashboard.html'),/TEAMSGROUPSENTRY · LOCAL ONLY · V1\.0\.0/);
  assert.match(read('background.js'),/BUILD_VERSION='1\.0\.0'/);
  assert.match(read('README.md'),/^# TeamsGroupSentry v1\.0\.0/m);
});
