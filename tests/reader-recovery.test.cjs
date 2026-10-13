const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function clock(){
  const jobs=new Map();let id=0;
  return {jobs,setTimeout(fn,ms){const n=++id;jobs.set(n,{fn,ms});return n;},
    clearTimeout(n){jobs.delete(n);},
    fire(ms){const hit=[...jobs].find(([,job])=>job.ms===ms);
      assert.ok(hit,`missing timer ${ms}`);jobs.delete(hit[0]);return hit[1].fn();}};
}
function pageHarness(reader,ingest=async()=>({ok:true})){
  const c=clock(),listeners=[],w={};w.top=w;w.addEventListener=()=>{};w.postMessage=()=>{};
  const page={visibilityState:'visible',addEventListener(){},querySelector(){return null;}};
  const chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:ingest}};
  const context=vm.createContext({window:w,document:page,location:{origin:'https://teams.live.com',href:'https://teams.live.com/v2'},
    chrome,crypto:webcrypto,Date,Promise,Map,URL,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,setInterval(){},TGSIsolatedReader:reader});
  context.globalThis=context;vm.runInContext(source('content.js'),context);
  const request=()=>new Promise(resolve=>listeners[0]({action:'SCAN'},null,resolve));
  return {request,clock:c};
}
const valid=()=>({rows:[{id:'19:abc@thread.v2',members:[]}],stats:{databases:1,partial:false},dbName:'Teams:conversation-manager:demo'});
test('two reader failures reset the reader and schedule a no-refresh retry, then clear failure streak',async()=>{
  let calls=0,rebuilds=0,sends=0;
  const reader={scan:()=>++calls<=2?Promise.reject(new Error('database stalled')):Promise.resolve(valid()),
    recover:()=>{rebuilds++;return {ok:true};}};
  const h=pageHarness(reader,async()=>{sends++;return {ok:true};});
  assert.equal((await h.request()).ok,false);
  assert.equal(rebuilds,0);
  assert.equal((await h.request()).ok,false);
  assert.equal(rebuilds,1);
  assert.equal(h.clock.jobs.size>0,true);
  await h.clock.fire(4000);await flush();
  assert.equal(calls,3);assert.equal(sends,1);
  assert.equal((await h.request()).ok,true);assert.equal(rebuilds,1);
});
test('repeated partial database errors trigger the same bounded reader rebuild',async()=>{
  let rebuilds=0;
  const reader={scan:async()=>({...valid(),stats:{databases:1,partial:true,rosterDatabaseErrors:1}}),
    recover:()=>{rebuilds++;return {ok:true};}};
  const h=pageHarness(reader);
  assert.equal((await h.request()).ok,true);assert.equal(rebuilds,0);
  assert.equal((await h.request()).ok,true);assert.equal(rebuilds,1);
});
test('worker message failure does not reset a functioning reader',async()=>{
  let resets=0;
  const reader={scan:async()=>valid(),recover(){resets++;return {ok:true};}};
  const h=pageHarness(reader,async()=>{throw new Error('worker unavailable');});
  assert.equal((await h.request()).ok,false);
  assert.equal((await h.request()).ok,false);
  assert.equal(resets,0);
});
test('rebuild cancels old IDB transaction and closes connection, allowing fresh scan',async()=>{
  let opens=0,aborts=0,closes=0;
  const indexedDB={databases:async()=>[{name:'Teams:conversation-manager:test'}],open(){
    const attempt=++opens;
    const db={close(){closes++;},objectStoreNames:{contains:()=>attempt===1},transaction(){
      const tx={onabort:null,abort(){aborts++;tx.onabort?.();},objectStore(){return {openCursor(){return {onsuccess:null,onerror:null};}}}};
      return tx;
    }};
    const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;
  }};
  const ctx=vm.createContext({indexedDB,Date,Promise,Map,Set,JSON,URL,console,queueMicrotask,setTimeout,clearTimeout});
  ctx.globalThis=ctx;
  for(const f of ['lib/logic.js','lib/name-core.js','lib/isolated-reader.js'])vm.runInContext(source(f),ctx);
  const first=ctx.TGSIsolatedReader.scan();await flush();
  const recovery=ctx.TGSIsolatedReader.recover();
  assert.equal(recovery.ok,true);assert.equal(aborts,1);assert.ok(closes>=1);
  await assert.rejects(first,/取消|失效/);
  const next=await ctx.TGSIsolatedReader.scan();
  assert.equal(next.stats.databases,1);assert.equal(next.rows.length,0);
  assert.ok(opens>=2);
});
test('persistent failure is rate-limited: never rebuild on every alarm or manual click',async()=>{
 let resets=0;
 const reader={scan:async()=>{throw new Error('indexedDB busy');},recover(){resets++;return {ok:true};}};
 const h=pageHarness(reader);
 for(let i=0;i<8;i++)await h.request();
 assert.equal(resets,1,'reader rebuild has a 90-second minimum interval');
});
