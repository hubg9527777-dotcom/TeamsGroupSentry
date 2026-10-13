const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const src=fs.readFileSync(path.resolve(__dirname,'../content.js'),'utf8');
function harness(){
 const listeners=new Map(),timers=[],messages=[],sent=[];
 const win={};win.top=win;
 win.addEventListener=(type,cb)=>listeners.set(type,[...(listeners.get(type)||[]),cb]);
 win.postMessage=data=>messages.push(data);
 const doc={visibilityState:'visible',addEventListener(){},querySelector(){return null;}};
 const chrome={runtime:{sendMessage:async req=>{sent.push(req);return {ok:true};},onMessage:{addListener(){}}}};
 const ctxt=vm.createContext({window:win,document:doc,location:{origin:'https://teams.live.com',href:'https://teams.live.com/v2/'},
   chrome,crypto:webcrypto,Date,Promise,Map,URL,
   setTimeout:cb=>{timers.push(cb);return timers.length;},clearTimeout:()=>{},setInterval:()=>0});
 vm.runInContext(src,ctxt);
 const dispatch=async x=>{for(const cb of listeners.get('message')||[])await cb({source:win,origin:'https://teams.live.com',data:x});};
 const runTimer=async()=>{const cb=timers.shift();if(cb)await cb();};
 return {messages,sent,timers,dispatch,runTimer};
}
test('valid cache dirty signal performs accelerated scan but invalid nonce does not',async()=>{
 const h=harness(),boot=h.messages.find(x=>x.type==='TGS_SESSION_INIT_V3');
 await h.dispatch({type:'TGS_SESSION_READY_V3',sessionNonce:boot.sessionNonce});
 const before=h.timers.length;
 await h.dispatch({type:'TGS_CACHE_DIRTY_V3',at:Date.now(),sessionNonce:'0'.repeat(64)});
 assert.equal(h.timers.length,before);
 await h.dispatch({type:'TGS_CACHE_DIRTY_V3',at:Date.now()-60000,sessionNonce:boot.sessionNonce});
 assert.equal(h.timers.length,before);
 await h.dispatch({type:'TGS_CACHE_DIRTY_V3',at:Date.now(),sessionNonce:boot.sessionNonce});
 await h.dispatch({type:'TGS_CACHE_DIRTY_V3',at:Date.now(),sessionNonce:boot.sessionNonce});
 assert.equal(h.timers.length,before+1,'burst coalesced into one scan');
});
