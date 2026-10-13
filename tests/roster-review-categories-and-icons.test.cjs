const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root,'ui/dashboard.js'),'utf8');
const css = fs.readFileSync(path.join(root,'ui/dashboard.css'),'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));

// Test the dashboard's actual read-only classification function, not a clone.
const start = dashboard.indexOf('  function rosterIssue(g){');
const end = dashboard.indexOf('\n  const rosterPriority=',start);
assert.ok(start>=0 && end>start,'rosterIssue declaration must exist');
const rosterIssue = new Function(`${dashboard.slice(start,end)};return rosterIssue;`)();

test('review status remains absent on healthy groups and conservative on old flags',()=>{
  assert.equal(rosterIssue({ambiguous:false,memberIds:['a'],pendingRosterIds:['b']}),null);
  assert.equal(rosterIssue({ambiguous:true,memberIds:['a']}),'unknown');
  assert.equal(rosterIssue({ambiguous:true,memberIds:['a'],ambiguousReason:'名单出现减少或替换'}),'change');
});

test('member ID changes outrank cache quality downgrade, and reorder is not a member change',()=>{
  assert.equal(rosterIssue({ambiguous:true,memberIds:['a','b'],pendingRosterIds:['a'],ambiguousReason:'名单可信等级下降'}),'change');
  assert.equal(rosterIssue({ambiguous:true,memberIds:['a','b'],pendingRosterIds:['c','a'],ambiguousReason:'成员计数口径变化'}),'change');
  assert.equal(rosterIssue({ambiguous:true,memberIds:['a','b'],pendingRosterIds:['b','a'],ambiguousReason:'名单可信等级下降'}),'quality');
  assert.equal(rosterIssue({ambiguous:true,memberIds:['a'],pendingRosterIds:['a'],ambiguousReason:'成员计数口径变化'}),'quality');
});

test('quality and membership categories have useful UI filters and detail explanation',()=>{
  assert.match(dashboard,/\['changed','疑似成员变化'\]/);
  assert.match(dashboard,/\['quality','仅缓存质量异常'\]/);
  assert.match(dashboard,/state\.groupFilter==='changed'&&rosterIssue\(g\)!=='change'/);
  assert.match(dashboard,/state\.groupFilter==='quality'&&rosterIssue\(g\)!=='quality'/);
  assert.match(dashboard,/rosterPriority\(a\)-rosterPriority\(b\)/);
  assert.match(dashboard,/【疑似成员变化】/);
  assert.match(dashboard,/【仅缓存质量异常】/);
  assert.match(css,/\.badge\.quality\{/);
  assert.match(dashboard,/click\('重新巡检此群名单'/);
  assert.match(dashboard,/click\('确认当前名单并解除待核查状态'/);
});

test('manifest references the exact four supplied sizes for action and extension icons',()=>{
  assert.equal(manifest.version,'1.0.0');
  for(const map of [manifest.icons,manifest.action.default_icon]){
    assert.deepEqual(Object.keys(map),['16','32','48','128']);
    for(const [size,filename] of Object.entries(map)){
      assert.equal(filename,`icons/icon${size}.png`);
      const bytes=fs.readFileSync(path.join(root,filename));
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.equal(bytes.readUInt32BE(16),Number(size));
      assert.equal(bytes.readUInt32BE(20),Number(size));
    }
  }
  const html=fs.readFileSync(path.join(root,'ui/dashboard.html'),'utf8');
  assert.match(html,/\.\.\/icons\/icon48\.png/);
});
