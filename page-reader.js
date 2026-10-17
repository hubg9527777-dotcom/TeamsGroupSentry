/* MAIN-world event hint only: no member records, identity claims or auth headers
 * ever cross window.postMessage. This message is explicitly untrusted. */
(()=>{
  if(window.__TGS_WATCH_V1__)return;
  Object.defineProperty(window,'__TGS_WATCH_V1__',{value:true});
  const BOOT='TGS_SESSION_INIT_V3',READY='TGS_SESSION_READY_V3';
  let nonce='',last=0;
  window.TGSCacheWatch?.install(window.IDBDatabase,()=>{
    if(!nonce||Date.now()-last<400)return;
    last=Date.now();
    window.postMessage({type:'TGS_CACHE_DIRTY_V3',sessionNonce:nonce,at:last},location.origin);
  });
  window.addEventListener('message',e=>{
    if(e.source!==window||e.origin!==location.origin||e.data?.type!==BOOT)return;
    if(typeof e.data.sessionNonce!=='string'||!/^[a-f0-9]{64}$/.test(e.data.sessionNonce))return;
    // An extension reload may recreate the isolated context while this MAIN
    // script persists. Accept the new nonce so cache-write hints resume.
    nonce=e.data.sessionNonce;
    window.postMessage({type:READY,sessionNonce:nonce},location.origin);
  });
})();
