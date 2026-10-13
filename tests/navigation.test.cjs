const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(base,n),'utf8');
test('all eight dashboard counters navigate to a dedicated list or filtered view',()=>{
 const js=read('ui/dashboard.js');
 for(const [title,target] of [['已发现群组','groups'],['唯一成员 ID','people'],['待审核新 ID','review'],['未处理事件','events'],['跨群成员关系','relations'],['重点群组','groups'],['未命名/待识别群','groups'],['存在不确定变化的群','groups']]){
  assert.ok(js.includes(`boxStat('${title}'`),title+' missing');
  assert.ok(js.includes(`boxStat('${title}'`) && js.includes(`navigate('${target}'`),title+' link missing');
 }
 assert.match(read('ui/dashboard.html'),/data-page="relations"/);
 assert.match(js,/function showRelations\(/);
 assert.match(js,/function navigate\(/);
});
test('manifest isolates member parsing and only uses MAIN to observe writes',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 assert.deepEqual(manifest.content_scripts[0].js,['lib/logic.js','lib/name-core.js','lib/isolated-reader.js','content.js','overlay/overlay.js']);
 assert.deepEqual(manifest.content_scripts[1].js,['lib/cache-watch.js','page-reader.js']);
 assert.equal(manifest.content_scripts[1].world,'MAIN');
 assert.equal(manifest.content_scripts[0].world||'ISOLATED','ISOLATED');
 assert.equal(manifest.version,'1.0.0');
 assert.ok(!manifest.permissions.includes('cookies'));
});

// Popup KPI links must navigate to a properly filtered dashboard view.
test('popup four KPI cards route to compatible dashboard sections',()=>{
 const html=read('popup/popup.html'),js=read('popup/popup.js');
 for(const [id,dest] of [['statGroups','groups'],['statPeople','people'],['statUnknown','review'],['statEvents','events']]){
   assert.match(html,new RegExp(`id="${id}"`));
   assert.match(html,new RegExp(`data-destination="${dest}"`));
 }
 assert.match(js,/events:\{page:'events',filter:'urgent'\}/);
 assert.match(read('ui/dashboard.js'),/\['CRITICAL','HIGH','REVIEW'\]\.includes\(e\.severity\)/);
});

test('failed review save refreshes and reopens record rather than leaving optimistic approval in the form',()=>{
 const js=read('ui/dashboard.js');
 assert.match(js,/catch\(e\)\{\s*\/\/ Never leave an optimistic dropdown/);
 assert.match(js,/try\{await refresh\(\);if\(after\)after\(\);\}catch\{\}/);
});

test('dashboard preserves urgent filter during internal navigation',()=>{
 const src=read('ui/dashboard.js');
 assert.match(src,/if\(page==='events'\)state\.eventFilter=\['urgent','open','all','ack'\]\.includes\(filter\)\?filter:'open'/);
});
