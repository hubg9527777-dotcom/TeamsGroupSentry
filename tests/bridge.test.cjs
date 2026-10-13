const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const nonce='a'.repeat(64);
function pageHarness(){
  const listeners=[],posted=[],win={IDBDatabase:function(){}};
  win.addEventListener=(type,fn)=>{if(type==='message')listeners.push(fn);};
  win.postMessage=(data,origin)=>posted.push({data,origin});
  const ctx=vm.createContext({window:win,location:{origin:'https://teams.live.com'},Date});
  vm.runInContext(read('page-reader.js'),ctx);
  const dispatch=async data=>{for(const fn of listeners)await fn({source:win,origin:'https://teams.live.com',data});};
  return {win,posted,dispatch};
}
test('MAIN only emits ready/dirty signals and never accepts roster scan commands',async()=>{
  const h=pageHarness();
  await h.dispatch({type:'TGS_SCAN_V3',sessionNonce:nonce,requestId:'c'.repeat(32)});
  assert.equal(h.posted.length,0);
  await h.dispatch({type:'TGS_SESSION_INIT_V3',sessionNonce:nonce});
  assert.equal(h.posted[0].data.type,'TGS_SESSION_READY_V3');
  await h.dispatch({type:'TGS_SCAN_V3',sessionNonce:nonce,requestId:'c'.repeat(32)});
  assert.ok(h.posted.every(v=>!('rows' in v.data)&&!('tokenIdentity' in v.data)));
  assert.doesNotMatch(read('page-reader.js'),/XMLHttpRequest|authorization|TGS_DATA_V3|function scan\(/);
});
test('content script ignores forged MAIN roster results and loads scanner itself',async()=>{
  const listeners=new Map(),messages=[],sent=[];
  const win={};win.top=win;
  win.addEventListener=(type,fn)=>listeners.set(type,[...(listeners.get(type)||[]),fn]);
  win.postMessage=x=>messages.push(x);
  const chrome={runtime:{sendMessage:async x=>{sent.push(x);return {ok:true};},onMessage:{addListener(fn){chrome.listener=fn;}}}};
  const ctx=vm.createContext({window:win,globalThis:{TGSIsolatedReader:{scan:async()=>({
    rows:[], nameHints:[], stats:{databases:1}, dbName:'Teams:conversation-manager:react-web-client:demo',
    accountHint:'',accountHintSource:'ROSTER_INTERSECTION',tokenIdentity:null})}},
    document:{visibilityState:'visible',addEventListener(){},querySelector(){return null;}},
    location:{origin:'https://teams.live.com',href:'https://teams.live.com/v2/'},
    crypto:webcrypto,chrome,Date,URL,Promise,Map,
    setTimeout:()=>1,clearTimeout:()=>{}});
  vm.runInContext(read('content.js'),ctx);
  const boot=messages.find(x=>x.type==='TGS_SESSION_INIT_V3');
  assert.match(boot.sessionNonce,/^[a-f0-9]{64}$/);
  const dispatch=async msg=>{for(const fn of listeners.get('message')||[])await fn({source:win,origin:'https://teams.live.com',data:msg});};
  await dispatch({type:'TGS_SESSION_READY_V3',sessionNonce:boot.sessionNonce});
  await dispatch({type:'TGS_DATA_V3',sessionNonce:boot.sessionNonce,requestId:'c'.repeat(32),rows:[{id:'attacker'}]});
  assert.equal(sent.length,0);
  const scanned=await new Promise(resolve=>chrome.listener({action:'SCAN'},{},resolve));
  assert.equal(scanned.ok,true);assert.equal(sent.length,1);
  assert.equal(sent[0].action,'INGEST');
  assert.equal(sent[0].payload.trustedReader,'ISOLATED');
  assert.equal(sent[0].payload.rows.length,0);
});
test('isolated scanner source cannot be reached via page postMessage',()=>{
  const js=read('lib/isolated-reader.js');
  assert.match(js,/globalThis\.TGSIsolatedReader/);
  assert.doesNotMatch(js,/postMessage|addEventListener\(['"]message/);
});
