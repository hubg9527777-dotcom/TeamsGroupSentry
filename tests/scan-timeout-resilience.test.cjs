const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
function manualClock(){
  const timers=new Map();let next=0;
  return {timers,setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    fire(ms){const match=[...timers].find(([,t])=>t.ms===ms);assert.ok(match,`no timer at ${ms}ms`);timers.delete(match[0]);match[1].fn();}};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('stuck isolated IndexedDB enumeration releases its scan lock and a later scan retries',async()=>{
  const clock=manualClock();let calls=0;
  const indexedDB={databases(){calls++;return calls===1?new Promise(()=>{}):Promise.resolve([]);}};
  const ctx=vm.createContext({indexedDB,console,Promise,Date,Map,Set,Array,JSON,URL,
    setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout});ctx.globalThis=ctx;
  for(const f of ['lib/logic.js','lib/name-core.js','lib/isolated-reader.js'])vm.runInContext(source(f),ctx);
  const first=ctx.TGSIsolatedReader.scan();await settle();
  clock.fire(52000);
  await assert.rejects(first,/巡检超时/);
  const second=await ctx.TGSIsolatedReader.scan();
  assert.equal(calls,3,'subsequent scan runs roster and optional profile enumeration again');
  assert.equal(second.stats.databases,0);
});
test('optional name-cache enumeration timeout does not reject a completed roster scan',async()=>{
  const clock=manualClock();let calls=0;
  const fakeDb={objectStoreNames:{contains:()=>false},close(){}};
  const indexedDB={databases(){calls++;return calls===1?
    Promise.resolve([{name:'Teams:conversation-manager:react-web-client:test'}]):new Promise(()=>{});},
    open(){const request={result:fakeDb};queueMicrotask(()=>request.onsuccess?.());return request;}};
  const ctx=vm.createContext({indexedDB,console,Promise,Date,Map,Set,Array,JSON,URL,queueMicrotask,
    setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout});ctx.globalThis=ctx;
  for(const f of ['lib/logic.js','lib/name-core.js','lib/isolated-reader.js'])vm.runInContext(source(f),ctx);
  const pending=ctx.TGSIsolatedReader.scan();await settle();clock.fire(4000);
  const result=await pending;
  assert.equal(result.stats.nameLookupDeferred,true);
  assert.equal(result.stats.partial,false,'missing optional names must not mark roster as partial');
  assert.equal(result.stats.databases,1);
});
test('stalled content-script reader returns an error and accepts a later SCAN request',async()=>{
  const clock=manualClock();const listeners=[],win={};win.top=win;
  win.addEventListener=()=>{};win.postMessage=()=>{};
  const doc={visibilityState:'visible',addEventListener:()=>{},querySelector:()=>null};
  let calls=0;
  const reader={scan:()=>{calls++;return calls===1?new Promise(()=>{}):Promise.resolve({rows:[],stats:{databases:1},dbName:'Teams:conversation-manager:demo'});}};
  const chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async()=>({ok:true})}};
  const ctx=vm.createContext({window:win,document:doc,location:{origin:'https://teams.live.com',href:'https://teams.live.com/v2/'},
    crypto:webcrypto,chrome,Date,Promise,Map,URL,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,setInterval:()=>{},TGSIsolatedReader:reader});
  ctx.globalThis=ctx;vm.runInContext(source('content.js'),ctx);
  const request=()=>new Promise(resolve=>listeners[0]({action:'SCAN'},null,resolve));
  const first=request();await settle();clock.fire(55000);
  const failed=await first;assert.equal(failed.ok,false);assert.match(failed.error,/超时/);
  const restored=await request();assert.equal(restored.ok,true);assert.equal(calls,2);
});
