/* ISOLATED world scanner: MAIN can request a rescan, never supply roster data. */
(()=>{
  if(window.top!==window||location.origin!=='https://teams.live.com')return;
  if(globalThis.__TGS_CONTENT_ACTIVE_V4__)return;
  globalThis.__TGS_CONTENT_ACTIVE_V4__=true;
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
    dirtyRevision++;scheduleDirtyScan();scheduleRequestCache();
  });
  // Register before sending the initial bootstrap message.
  hello();
  // Capture names when Teams finishes rendering the member dialog, without
  // waiting for the next expensive IndexedDB scan. No roster/approval changes.
  let lastKnownNames=new Set(),visibleNameTimer=null,lastVisibleDigest='',lastVisibleCheck=0;
  function scheduleVisibleNames(){
    if(!lastKnownNames.size||visibleNameTimer||Date.now()-lastVisibleCheck<1500||
       !globalThis.TGSMemberNameUI?.hasPanel(document))return;
    visibleNameTimer=setTimeout(async()=>{
      visibleNameTimer=null;lastVisibleCheck=Date.now();
      let hints=[];
      try{hints=globalThis.TGSMemberNameUI.inspect(document,lastKnownNames)||[];}catch{return;}
      if(!hints.length)return;
      const digest=hints.map(h=>h.id+'\u001f'+h.name).sort().join('\u001e');
      if(digest===lastVisibleDigest)return;
      try{const result=await chrome.runtime.sendMessage({action:'SUPPLEMENT_VISIBLE_NAMES',
        hints:hints.slice(0,300),at:Date.now()});
        if(result?.ok)lastVisibleDigest=digest;
      }catch{} // Teams functionality must never be interrupted by the extension.
    },750);
  }
  const visibleObserver=new MutationObserver(scheduleVisibleNames);
  if(document.documentElement)visibleObserver.observe(document.documentElement,{childList:true,subtree:true});
  else document.addEventListener('DOMContentLoaded',()=>{
    visibleObserver.observe(document.documentElement,{childList:true,subtree:true});
  },{once:true});
  async function scan(force=false,reason='PERIODIC'){
    if(pollBusy)return pollBusy;
    if(!force && Date.now()-lastScan<17000)return {ok:true,throttled:true};
    lastScan=Date.now();
    if(typeof globalThis.TGSIsolatedReader?.scan!=='function')
      return {ok:false,error:'隔离环境成员读取器未初始化'};
    pollBusy=(async()=>{
      let data;
      try{data=await boundedRead(globalThis.TGSIsolatedReader.scan({refreshProfiles:force&&reason==='REQUESTED'}));}
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
        let requestUI;
        try{requestUI=globalThis.TGSRequestUI?.inspect(document);}catch{}
        // Optional display-only labels from an open Teams members dialog.
        // These never create a member, change a roster or approve any identity.
        const known=new Set(data.rows.flatMap(row=>(row.members||[]).map(m=>m.id)));
        lastKnownNames=known;lastVisibleDigest='';
        let uiNames=[];
        try{uiNames=globalThis.TGSMemberNameUI?.inspect(document,known)||[];}catch{}
        // Do not discard an exact ID+name pair just because weaker cached
        // metadata already contains a (possibly outdated) label. The worker
        // selects by source priority and rejects equal-priority conflicts.
        const nameHints=[...uiNames.slice(0,300),...(data.nameHints||[]).slice(0,15700)];
        return await chrome.runtime.sendMessage({action:'INGEST',payload:{
          ...data,nameHints,requestUI, stats:{...data.stats,uiNamesFound:uiNames.length,cacheWatchActive:bridgeReady},
          at:Date.now(), trigger:reason, trustedReader:'ISOLATED'}});
      }catch(e){return {ok:false,error:'无法提交巡检结果：'+String(e?.message||e).slice(0,100)};}
    })().finally(()=>{pollBusy=null;});
    return pollBusy;
  }
  // Open an EXISTING conversation only. Its Teams title/visible name is used
  // to populate the native left-rail filter; never trust a name match for ID.
  const CHAT_ITEM_PREFIX='title-chat-list-item_';
  // Exact DOM attributes verified in the user's Teams personal v2 UI.
  // The Fluent CSS classes are generated and must NOT be used as selectors.
  const SEARCH_INPUT_ID='simple-collab-left-rail-sticky-filter-input-id';
  const SEARCH_TOGGLE_TESTID='simple-collab-left-rail-header-sticky-filter-v2-button';
  const SEARCH_SELECTOR='input[id*="left-rail-sticky-filter-input"]';
  const SEARCH_ACCESSIBLE_NAMES=['依人员或聊天室名称筛选','依人員或聊天室名稱篩選'];
  const waitForList=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  // chrome.tabs.update(active:true) and chrome.windows.update(focused:true) are
  // asynchronous from the web page's point of view. Never toggle Teams search
  // or send React input events while the page is still backgrounded.
  async function waitForTeamsForeground(){
    for(let attempt=0;attempt<24;attempt++){
      if(document.visibilityState==='visible'&&
         (typeof document.hasFocus!=='function'||document.hasFocus()))return true;
      await waitForList(125);
    }
    return false;
  }
  function renderedChat(chatId){
    const item=document.getElementById(CHAT_ITEM_PREFIX+chatId);
    if(!item?.isConnected || typeof item.click!=='function')return null;
    // The sidebar can keep hidden rows in the DOM after a filter.
    if(typeof item.getClientRects==='function'&&item.getClientRects().length===0)return null;
    return item;
  }
  function clickExact(chatId){
    const item=renderedChat(chatId);
    if(!item)return false;
    item.click();return true;
  }
  function safeSearchText(value){
    if(typeof value!=='string')return '';
    const clean=value.trim().replace(/\s+/g,' ');
    if(clean.length<2||clean.length>100||/[\x00-\x1f\x7f]/.test(clean)||
       /^(?:19:|8:live:|未命名群|成员：)/i.test(clean))return '';
    return clean;
  }
  function setSearchValue(input,value){
    // React-controlled input requires the prototype setter to notify the
    // framework. We dispatch only input, never Enter or a search result click.
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(typeof setter!=='function')return false;
    setter.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  }
  function visibleControl(el){
    return !!el?.isConnected&&!el.disabled&&!el.readOnly&&
      (typeof el.getClientRects!=='function'||el.getClientRects().length>0);
  }
  function findChatSearch(){
    if(typeof document.querySelectorAll!=='function')return null;
    // Prefer the real, verified Teams chat filter. An unrelated Teams search
    // field or the message composer must never be overwritten.
    const selectors=[
      'input[id="'+SEARCH_INPUT_ID+'"]',
      SEARCH_SELECTOR,
      'input[id^="simple-collab-left-rail-sticky-filter-input"]',
      ...SEARCH_ACCESSIBLE_NAMES.flatMap(name=>[
        'input[aria-label="'+name+'"]',
        'input[placeholder="'+name+'"]',
        'input[title="'+name+'"]'])
    ];
    // Return an unambiguous exact match even if the page has other inputs.
    const exact=[...document.querySelectorAll(selectors[0])].filter(visibleControl);
    if(exact.length===1)return exact[0];
    if(exact.length>1)return null;
    const matches=new Set();
    for(const selector of selectors.slice(1)){
      for(const el of document.querySelectorAll(selector)||[]){
        if(visibleControl(el))matches.add(el);
      }
    }
    return matches.size===1?[...matches][0]:null;
  }
  function filterToggleLooksOpen(el){
    // The same button toggles search *closed* when the label says 關閉.
    // During an asynchronous React render the button may already be in its
    // OPEN state while the input has not mounted. Never click it again.
    const label=[el?.getAttribute?.('aria-label'),el?.getAttribute?.('title')]
      .filter(Boolean).join(' ');
    return /(關閉|关闭|收起|隱藏|隐藏|hide|close|collapse)/i.test(label)||
      el?.getAttribute?.('aria-expanded')==='true'||
      el?.getAttribute?.('aria-pressed')==='true';
  }
  function findChatSearchToggle(){
    if(typeof document.querySelectorAll!=='function')return null;
    const controls=[...document.querySelectorAll('button,[role="button"]')]
      .filter(visibleControl);
    // Target the exact chat-filter toolbar button observed in Teams v2:
    // simple-collab-left-rail-header-sticky-filter-v2-button. Do not infer
    // intent from SVG, generated Fluent CSS classes, position or neighbour
    // buttons: those can be Meet Now or New Message.
    const exact=controls.filter(el=>
      el.getAttribute?.('data-testid')===SEARCH_TOGGLE_TESTID);
    if(exact.length>1)return null;
    if(exact.length===1)return filterToggleLooksOpen(exact[0])?null:exact[0];
    // Backwards-compatible fallback for versions with an accessible label.
    // Never use the ambiguous three-icon toolbar geometry fallback.
    const labelled=controls.filter(el=>{
      if(filterToggleLooksOpen(el))return false;
      const label=[el.getAttribute?.('aria-label'),el.getAttribute?.('title')]
        .filter(Boolean).join(' ');
      return /(顯示篩選文字方塊|显示筛选文字方框|显示筛选文本框|筛选聊天|篩選聊天)/i.test(label);
    });
    return labelled.length===1?labelled[0]:null;
  }
  async function waitForChatSearch(attempts=5){
    for(let i=0;i<attempts;i++){
      await waitForList(120);
      const input=findChatSearch();
      if(input)return input;
    }
    return null;
  }
  async function ensureChatSearch(){
    // The verified Teams tab must be frontmost before interacting with its UI.
    // Native macOS Shift+Cmd+F cannot be generated reliably by extension DOM
    // events; use the actual Teams search-toggle button instead.
    if(!await waitForTeamsForeground())return null;
    let input=findChatSearch();
    if(input)return input; // Never close an already visible filter.
    // A React input may mount a moment AFTER the button changes to "Close".
    input=await waitForChatSearch(5);
    if(input)return input;
    const toggle=findChatSearchToggle();
    if(!toggle||typeof toggle.click!=='function'){
      // If the button already says "close", give the pending input another
      // chance to mount rather than clicking and accidentally closing search.
      return waitForChatSearch(12);
    }
    toggle.click(); // Exactly one click on the verified chat-filter control.
    return waitForChatSearch(24);
  }
  async function prepareManualPersonSearch(searchText){
    const query=safeSearchText(searchText);
    if(!query)return {ok:false,code:'NO_SEARCH_NAME'};
    const input=await ensureChatSearch();
    if(!input)return {ok:false,code:'SEARCH_ACTIVATION_REQUIRED'};
    if(typeof input.focus==='function')input.focus();
    if(!setSearchValue(input,query))return {ok:false,code:'SEARCH_UNAVAILABLE'};
    // The user's search stays visible: do NOT restore the old text in assisted
    // mode, click a name-only result, create a chat, or send a message.
    return {ok:true,opened:false,assisted:true};
  }
  async function filterToChat(chatIds,searchText){
    const names=[...new Set(chatIds.filter(id=>globalThis.TGSLogic?.threadId(id)))];
    if(!names.length)return {ok:false,code:'INVALID_CHAT'};
    const query=safeSearchText(searchText);
    if(!query)return {ok:false,code:'NO_SEARCH_NAME'};
    const input=await ensureChatSearch();
    if(!input)return {ok:false,code:'SEARCH_ACTIVATION_REQUIRED'};
    // When opening a chat required native Teams search, KEEP this query in
    // the filter (group names and unnamed-group member-name combinations).
    // A chat opened directly by its exact 19: ID never reaches this function
    // and leaves the existing filter untouched.
    if(typeof input.focus==='function')input.focus();
    if(!setSearchValue(input,query))return {ok:false,code:'SEARCH_UNAVAILABLE'};
    let result={ok:false,code:'SEARCH_NO_MATCH'};
    // Search results are asynchronous and may be virtualized. Observe a
    // bounded interval; don't scroll chat/message panes or issue network calls.
    const until=Date.now()+4500;
    while(Date.now()<until){
      const matches=names.filter(id=>!!renderedChat(id));
      if(matches.length>1){result={ok:false,code:'AMBIGUOUS_CHAT',chatIds:matches};break;}
      if(matches.length===1){
        // If multiple verified personal chats exist, allow a short period
        // for the remaining results to render before opening anything.
        if(names.length>1){await waitForList(280);
          const updated=names.filter(id=>!!renderedChat(id));
          if(updated.length>1){result={ok:false,code:'AMBIGUOUS_CHAT',chatIds:updated};break;}
        }
        if(clickExact(matches[0])){result={ok:true,opened:true,foundBySearch:true};break;}
      }
      await waitForList(120);
    }
    // The query was successfully entered into Teams. Preserve it so the user
    // can pick a result manually even if virtualized DOM did not reveal the
    // verified conversation ID. This is NOT a verified automatic chat open.
    return result.code==='SEARCH_NO_MATCH'?{...result,searched:true}:result;
  }
  async function openChat(chatId,searchText){
    if(!globalThis.TGSLogic?.threadId(chatId))return {ok:false,code:'INVALID_CHAT'};
    if(clickExact(chatId))return {ok:true,opened:true};
    return filterToChat([chatId],searchText);
  }
  async function navigateChat(msg){
    if(!await waitForTeamsForeground())return {ok:false,code:'TEAMS_NOT_FOCUSED'};
    if(msg.kind==='group')return openChat(msg.chatId,msg.searchText);
    if(msg.kind!=='person'||!globalThis.TGSLogic?.personId(msg.personId)||
       !globalThis.TGSLogic?.personId(msg.selfId)||msg.personId===msg.selfId)
      return {ok:false,code:'INVALID_PERSON'};
    const lookup=globalThis.TGSIsolatedReader?.findDirectChat;
    if(typeof lookup!=='function')return {ok:false,code:'READER_UNAVAILABLE'};
    const resolved=await lookup(msg.selfId,msg.personId);
    if(resolved?.ok){
      if(msg.chatId&&msg.chatId!==resolved.chatId)return {ok:false,code:'INVALID_CHAT_SELECTION'};
      return openChat(resolved.chatId,msg.searchText);
    }
    if(resolved?.code==='AMBIGUOUS_CHAT'&&Array.isArray(resolved.chatIds)){
      const ids=[...new Set(resolved.chatIds.filter(id=>globalThis.TGSLogic.threadId(id)))];
      if(msg.chatId){
        if(!ids.includes(msg.chatId))return {ok:false,code:'INVALID_CHAT_SELECTION'};
        return openChat(msg.chatId,msg.searchText);
      }
      const visible=ids.filter(id=>!!renderedChat(id));
      if(visible.length>1)return {ok:false,code:'AMBIGUOUS_CHAT',chatIds:visible};
      if(visible.length===1)return openChat(visible[0],msg.searchText);
      const searched=await filterToChat(ids,msg.searchText);
      if(searched.ok||searched.code==='AMBIGUOUS_CHAT')return searched;
      // Search is a navigation aid; verified multiple direct sessions remain
      // available for explicit user selection even when search yields nothing.
      return {ok:false,code:'AMBIGUOUS_CHAT',chatIds:ids};
    }
    // Cache typing is unreliable for some Teams personal accounts. A missing
    // verified 1:1 mapping must NEVER result in name-only automatic clicking,
    // but it need not prevent opening a native Teams name search for the user.
    if(['NO_DIRECT_CHAT','UNVERIFIED_CHAT_TYPE','CACHE_INCOMPLETE','TOO_MANY_CHATS']
       .includes(resolved?.code)){
      const assisted=await prepareManualPersonSearch(msg.searchText);
      if(assisted.ok)return {...assisted,reason:resolved.code};
      // Keep the original diagnosis if the Teams filter cannot be opened.
      return {...assisted,originalCode:resolved.code};
    }
    return resolved;
  }
  // Observe the actual user-confirmed Teams leave-chat UI. No page-supplied
  // message or cached roster may write membership status by itself.
  if(globalThis.TGSMembershipUI?.start){
    globalThis.TGSMembershipUI.start(document,detail=>{
      chrome.runtime.sendMessage({action:'AUTO_GROUP_MEMBERSHIP',...detail})
        .catch(()=>{}); // An unavailable background must never affect Teams.
    },{onUnresolved:code=>{
      // Diagnostic only: cannot change a group or invent a chat ID.
      chrome.runtime.sendMessage({action:'GROUP_MEMBERSHIP_DIAGNOSTIC',code,observedAt:Date.now()})
        .catch(()=>{});
    }});
  }
  let chatNavigationBusy=false;
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.action==='REQUEST_NOTICE_CONTEXT'){sendResponse({token:sessionNonce});return false;}
    if(msg?.action==='NAVIGATE_TEAMS_CHAT'){
      if(chatNavigationBusy){sendResponse({ok:false,code:'NAVIGATION_BUSY'});return false;}
      chatNavigationBusy=true;
      navigateChat(msg).then(result=>{chatNavigationBusy=false;sendResponse(result);},
        ()=>{chatNavigationBusy=false;sendResponse({ok:false,code:'LOOKUP_FAILED'});});return true;
    }
    if(msg?.action==='SCAN'){scan(true,'REQUESTED').then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));return true;}
    if(msg?.action==='PING'){sendResponse({ok:true,site:location.origin});return false;}
  });
  // Opportunistic checks complement the alarm. A cache change is only visible after Teams updates IndexedDB.
  const trigger=()=>{if(document.visibilityState==='visible')setTimeout(()=>scan(false).catch(()=>{}),1200);};
  window.addEventListener('focus',trigger);
  document.addEventListener('visibilitychange',trigger);
  document.addEventListener('click',()=>{if(Date.now()-lastScan>20000)setTimeout(trigger,2600);},{passive:true});
  const requestDetailsSeen=new Map();
  let requestCacheKeys='',cachedRequestDetails=[],requestCacheBusy=false,lastRequestCacheAt=0,requestCacheTimer=null;
  function scheduleRequestCache(){
    if(requestCacheTimer||!globalThis.TGSRequestCache)return;
    requestCacheTimer=setTimeout(readRequestCache,Math.max(0,2000-(Date.now()-lastRequestCacheAt)));
  }
  async function readRequestCache(){
    requestCacheTimer=null;if(requestCacheBusy)return;
    requestCacheBusy=true;lastRequestCacheAt=Date.now();
    try{const live=globalThis.TGSRequestUI?.inspectSignal(document);
      if(!live?.observed||!live.keys?.length){cachedRequestDetails=[];scheduleRequestCheck();return;}
      const result=await globalThis.TGSRequestCache.scan(indexedDB,document,async dbName=>{
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(dbName)))].map(x=>x.toString(16).padStart(2,'0')).join('');
        const r=await chrome.runtime.sendMessage({action:'REQUEST_SELF_CONTEXT',scopeDigest:digest});
        return r?.ok&&typeof r.selfId==='string'?r.selfId:'';
      },live.keys);
      cachedRequestDetails=result.status==='OK'?result.details:[];
      // A separate pass: cache latency must never hold up the initial DOM alert.
      scheduleRequestCheck();
    }catch{cachedRequestDetails=[];scheduleRequestCheck();}
    finally{requestCacheBusy=false;}
  }
  let requestFingerprint='',requestCheckTimer=null,requestNoticeBusy=false,requestNoticeDirty=false;
  async function checkRequestUI(){
    requestCheckTimer=null;
    if(!globalThis.TGSRequestUI?.inspectSignal)return;
    if(requestNoticeBusy){requestNoticeDirty=true;return;}
    requestNoticeBusy=true;
    try{const snapshot=globalThis.TGSRequestUI.inspectSignal(document);
      // Only current Teams UI establishes existence; no cache-only request alerts.
      const liveKeys=new Set(snapshot.keys||[]);
      const currentCacheKeys=[...liveKeys].sort().join('|');
      if(currentCacheKeys!==requestCacheKeys){requestCacheKeys=currentCacheKeys;scheduleRequestCache();}
      for(const key of requestDetailsSeen.keys())if(!snapshot.observed||!liveKeys.has(key))requestDetailsSeen.delete(key);
      const supplemented=globalThis.TGSRequestCache?.supplement?
        globalThis.TGSRequestCache.supplement(snapshot,cachedRequestDetails,requestDetailsSeen):snapshot;
      for(const d of supplemented.details||[])requestDetailsSeen.set(d.key,d);
      while(requestDetailsSeen.size>20)requestDetailsSeen.delete(requestDetailsSeen.keys().next().value);
      const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const details=[];
      for(const d of supplemented.details||[]){
        const {messageRevision,...safe}=d;
        details.push({...safe,key:await sha(d.key),...(messageRevision?{messageStamp:await sha(messageRevision)}:{})});
      }
      // Preserve the live list's order; numbering must match the visible requests.
      const {details:_rawDetails,...signal}=snapshot;
      const fingerprint=JSON.stringify({...signal,details});
      if(fingerprint!==requestFingerprint){
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
        const signature=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
        const {keys,...evidence}=snapshot;
        evidence.details=details;
        const result=await chrome.runtime.sendMessage({action:'REQUEST_UI_NOTICE',token:sessionNonce,
          evidence:{...evidence,adapter:'TEAMS_REQUEST_SIGNAL_V1',fingerprint:signature}});
        if(result?.ok)requestFingerprint=fingerprint;
      }
    }catch{} // no group-cache dependency; failures retry on the next check
    finally{requestNoticeBusy=false;if(requestNoticeDirty){requestNoticeDirty=false;scheduleRequestCheck();}}
  }
  function scheduleRequestCheck(){if(!requestCheckTimer)requestCheckTimer=setTimeout(checkRequestUI,250);}
  function watchRequests(){if(!document.body)return;
    new MutationObserver(scheduleRequestCheck)
      .observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,
        attributeFilter:['aria-label','aria-selected','id','data-testid','data-tid','hidden','aria-hidden','style','class']});
    checkRequestUI();
  }
  if(document.body)watchRequests();else document.addEventListener('DOMContentLoaded',watchRequests,{once:true});
  document.addEventListener('visibilitychange',scheduleRequestCheck);
  window.addEventListener('focus',()=>{scheduleRequestCheck();scheduleRequestCache();});
  scheduleRequestCache();
  if(typeof setInterval==='function')setInterval(()=>{scheduleRequestCheck();scheduleRequestCache();},5000);
  setTimeout(()=>scan(false).catch(()=>{}),2500);
  // 50s foreground fallback also recovers when the page was initially loaded
  // before Teams created its conversation cache. Hidden tabs rely on alarms.
  if(typeof setInterval==='function')setInterval(()=>{if(document.visibilityState==='visible' && Date.now()-lastScan>=50000)
    scan(false,'PERIODIC').catch(()=>{});},25000);
})();
