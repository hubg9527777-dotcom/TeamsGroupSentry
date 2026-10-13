/* ISOLATED world scanner: MAIN can request a rescan, never supply roster data. */
(()=>{
  if(window.top!==window||location.origin!=='https://teams.live.com')return;
  let lastScan=0,pollBusy=null;
  // A browser IndexedDB API can stall without rejecting. Never let one stuck
  // read block every subsequent automatic or user-requested scan indefinitely.
  const READER_TIMEOUT_MS=55000;
  const RECOVERY_AFTER_FAILURES=2, RECOVERY_COOLDOWN_MS=90000;
  let consecutiveReaderFailures=0,lastReaderRecoveryAt=0,recoveryRetryTimer=null;
  function onReaderFailure(){
    consecutiveReaderFailures++;
    if(consecutiveReaderFailures<RECOVERY_AFTER_FAILURES ||
       (lastReaderRecoveryAt&&Date.now()-lastReaderRecoveryAt<RECOVERY_COOLDOWN_MS))return;
    const recover=globalThis.TGSIsolatedReader?.recover;
    if(typeof recover!=='function')return;
    try{
      const result=recover();
      if(result?.ok!==true)return;
      lastReaderRecoveryAt=Date.now();
      consecutiveReaderFailures=0;
      // No page reload: try a fresh IndexedDB reader shortly after cleanup.
      if(recoveryRetryTimer)clearTimeout(recoveryRetryTimer);
      recoveryRetryTimer=setTimeout(()=>{
        recoveryRetryTimer=null;
        scan(true,'PERIODIC').catch(()=>{});
      },4000);
    }catch{}
  }
  function boundedRead(promise){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Teams 缓存读取超时，可自动重试')),READER_TIMEOUT_MS);
    })]).finally(()=>clearTimeout(timer));
  }
  // Alarm delivery can be delayed when Chrome backgrounds or suspends a tab.
  // A visible Teams page supplements alarms without spawning parallel scans.
  // Nonce prevents accidental cross-tab/stale hints; page scripts can observe it.
  // Hints are untrusted and cannot supply member rows or identity.
  const sessionNonce=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const BOOT='TGS_SESSION_INIT_V3',READY='TGS_SESSION_READY_V3';
  let bridgeReady=false,helloAttempts=0;
  // Event-driven scans are throttled and coalesced. A write while a scan is in
  // flight schedules a trailing scan so the new snapshot cannot be missed.
  const DIRTY_MIN_GAP_MS=20000; // MAIN-world hints are untrusted; cap expensive rescan rates.
  let dirtyRevision=0,processedRevision=0,dirtyTimer=null,lastEventScanAt=0;
  function scheduleDirtyScan(){
    if(dirtyTimer||!bridgeReady)return;
    const delay=Math.max(1000,DIRTY_MIN_GAP_MS-(Date.now()-lastEventScanAt));
    dirtyTimer=setTimeout(async()=>{
      dirtyTimer=null;const revision=dirtyRevision;
      if(pollBusy){try{await pollBusy;}catch{}}
      if(revision<=processedRevision)return;
      const remaining=DIRTY_MIN_GAP_MS-(Date.now()-lastEventScanAt);
      if(remaining>0){scheduleDirtyScan();return;}
      // The cache event is just a hint; the full safe roster parser still validates data.
      try{await scan(true,'CACHE_WRITE');}catch{}
      lastEventScanAt=Date.now(); // cooldown begins AFTER the expensive read.
      processedRevision=revision;
      if(dirtyRevision>processedRevision)scheduleDirtyScan();
    },delay);
  }
  const hello=()=>{if(bridgeReady)return;helloAttempts++;
    window.postMessage({type:BOOT,sessionNonce},location.origin);
    if(!bridgeReady)setTimeout(hello,helloAttempts<32?200:10000);
  };
  window.addEventListener('message',e=>{
    if(e.source===window&&e.origin===location.origin&&e.data?.type===READY&&
       e.data.sessionNonce===sessionNonce)bridgeReady=true;
  });
  window.addEventListener('message',e=>{
    if(e.source!==window||e.origin!==location.origin||!bridgeReady||
       e.data?.type!=='TGS_CACHE_DIRTY_V3'||e.data.sessionNonce!==sessionNonce||
       !Number.isFinite(e.data.at)||Math.abs(Date.now()-e.data.at)>15000)return;
    dirtyRevision++;scheduleDirtyScan();
  });
  // Register before sending the initial bootstrap message.
  hello();
  async function scan(force=false,reason='PERIODIC'){
    if(pollBusy)return pollBusy;
    if(!force && Date.now()-lastScan<17000)return {ok:true,throttled:true};
    lastScan=Date.now();
    if(typeof globalThis.TGSIsolatedReader?.scan!=='function')
      return {ok:false,error:'隔离环境成员读取器未初始化'};
    pollBusy=(async()=>{
      let data;
      try{data=await boundedRead(globalThis.TGSIsolatedReader.scan());}
      catch(e){
        onReaderFailure();
        return {ok:false,error:'隔离环境巡检未完成：'+String(e?.message||e).slice(0,100)};
      }
      try{
        if(!Array.isArray(data.rows)||data.rows.length>6000||!data.stats||
           !Number.isInteger(data.stats.databases)||data.stats.databases<1){
          onReaderFailure();
          return {ok:false,error:'本地成员缓存尚未准备好'};
        }
        // A partial roster caused by IndexedDB read errors still needs recovery,
        // even when other databases returned usable diagnostic rows.
        if((data.stats.rosterDatabaseErrors||0)>0)onReaderFailure();
        else consecutiveReaderFailures=0;
        return await chrome.runtime.sendMessage({action:'INGEST',payload:{
          ...data, stats:{...data.stats,cacheWatchActive:bridgeReady}, at:Date.now(), trigger:reason, trustedReader:'ISOLATED'}});
      }catch(e){return {ok:false,error:'无法提交巡检结果：'+String(e?.message||e).slice(0,100)};}
    })().finally(()=>{pollBusy=null;});
    return pollBusy;
  }
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.action==='SCAN'){scan(true,'REQUESTED').then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));return true;}
    if(msg?.action==='GET_ACTIVE_THREAD'){
      let tid='';try{const url=decodeURIComponent(location.href);
        tid=url.match(/19:[^\s&#?"'<>]{1,520}@thread(?:\.[a-z0-9]+)?/i)?.[0]||'';
      }catch{}
      if(!tid){const selected=document.querySelector('[aria-selected="true"][data-chat-id], [aria-current="true"][data-conversation-id]');
        const value=selected?.getAttribute('data-chat-id')||selected?.getAttribute('data-conversation-id')||'';
        if(/^19:[^\s]+@thread/i.test(value))tid=value;}
      sendResponse({ok:!!tid,threadId:tid});return false;
    }
    if(msg?.action==='PING'){sendResponse({ok:true,site:location.origin});return false;}
  });
  // Opportunistic checks complement the alarm. A cache change is only visible after Teams updates IndexedDB.
  const trigger=()=>{if(document.visibilityState==='visible')setTimeout(()=>scan(false).catch(()=>{}),1200);};
  window.addEventListener('focus',trigger);
  document.addEventListener('visibilitychange',trigger);
  document.addEventListener('click',()=>{if(Date.now()-lastScan>20000)setTimeout(trigger,2600);},{passive:true});
  setTimeout(()=>scan(false).catch(()=>{}),2500);
  // 50s foreground fallback also recovers when the page was initially loaded
  // before Teams created its conversation cache. Hidden tabs rely on alarms.
  if(typeof setInterval==='function')setInterval(()=>{if(document.visibilityState==='visible' && Date.now()-lastScan>=50000)
    scan(false,'PERIODIC').catch(()=>{});},25000);
})();
