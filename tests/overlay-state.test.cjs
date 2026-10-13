const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../overlay/overlay.js'),'utf8');
function element(tag){
  const classes=new Set();
  return {tag,children:[],style:{},hidden:false,className:'',textContent:'',
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},
    append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},
    attachShadow(){this.shadow=element('shadow');this.children.push(this.shadow);return this.shadow;},setAttribute(){},addEventListener(){}};
}
function find(node,predicate){if(predicate(node))return node;
  for(const child of node.children||[]){const found=find(child,predicate);if(found)return found;}return null;}
async function run(status){
  const root=element('documentElement'),document={documentElement:root,visibilityState:'visible',
    createElement:element,addEventListener(){}};
  const window={addEventListener(){}};window.top=window;
  const chrome={runtime:{sendMessage:async()=>status,onMessage:{addListener(){}}}};
  vm.runInNewContext(script,{window,document,location:{origin:'https://teams.live.com'},chrome,Date,
    setInterval(){},setTimeout(){},console},{filename:'overlay/overlay.js'});
  await new Promise(resolve=>setImmediate(resolve));
  const shell=find(root,x=>x.className==='shell');
  const title=find(root,x=>x.className==='title');
  return {shell,title,root};
}
const base={ok:true,prefs:{mode:'always',compact:true,offset:'top'},groups:398,
  lastRead:Date.now(),newUnknown:0,openUrgent:0,guard:{mode:'READ_ONLY',inspected:398,compared:398,reason:'当前缺少可信用户标识'}};
test('account read-only alone is amber, never a red personnel alert',async()=>{
  const {shell,title}=await run(base);
  assert.equal(shell.classList.contains('alert'),false);
  assert.equal(shell.classList.contains('stale'),true);
  assert.match(title.textContent,/只读守护/);
});
test('an actual pending review overrides read-only amber with red',async()=>{
  const {shell,title}=await run({...base,openUrgent:1});
  assert.equal(shell.classList.contains('alert'),true);
  assert.equal(shell.classList.contains('stale'),false);
  assert.match(title.textContent,/待核查 1/);
});
test('alerts-only preference still shows account-protection notice without masking it',async()=>{
  const {shell,root}=await run({...base,prefs:{mode:'alerts'}});
  assert.equal(shell.classList.contains('stale'),true);
  assert.notEqual(root.children[0].style.display,'none');
});

test('yellow group-roster review is visible in alert-only overlay preference',async()=>{
 const {shell,title,root}=await run({ok:true,prefs:{mode:'alerts',compact:true},
   level:'review',groups:399,ambiguous:2,newUnknown:0,openUrgent:0,lastRead:Date.now()});
 assert.equal(shell.classList.contains('alert'),false);
 assert.equal(shell.classList.contains('stale'),true);
 assert.match(title.textContent,/2 群名单待核查/);
 assert.notEqual(root.children[0].style.display,'none');
});
test('uninitialized site status is not hidden in alert-only mode',async()=>{
 const {shell,title,root}=await run({ok:true,prefs:{mode:'alerts'},level:'uninitialized',groups:0,lastRead:0});
 assert.equal(shell.classList.contains('stale'),true);
 assert.match(title.textContent,/尚未建立巡检/);
 assert.notEqual(root.children[0].style.display,'none');
});
