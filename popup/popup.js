const by=id=>document.getElementById(id);
let lastGuard=null,summaryRevision=0;
let requestNoticeRevision=0,lastRequestNotice=null;
let bindingOfferKey='',lastSuggestedId='';
const safeCount=n=>Number.isInteger(n)&&n>=0?n:0;
const text=(id,value)=>{const e=by(id),s=String(value);if(e.textContent!==s)e.textContent=s;};
// An open identity-review item is not proof of a malicious join. Emphasize action required.
// Counts are intentionally hidden if the current read-only identity cannot be linked
// to the persisted account. Never display the previous account's urgent counters.
function updateAlertAppearance(unknown, urgent, safe, requests={}){
  const newCount=safe?safeCount(unknown):0,urgentCount=safe?safeCount(urgent):0;
  const requestCount=safe?safeCount(requests.pending):0;
  const hasAlert=newCount>0||urgentCount>0||requestCount>0;
  document.body.classList.toggle('has-alert',hasAlert);
  by('statUnknown').classList.toggle('needs-attention',newCount>0);
  by('statEvents').classList.toggle('needs-attention',urgentCount>0);
  by('alertBanner').hidden=!hasAlert;
  by('alertBanner').classList.toggle('request-danger',requestCount>0);
  by('alertAdvice').hidden=requestCount===0;
  by('contactRequests').hidden=requestCount===0;
  if(requestCount){
    text('alertTitle','🔴 '+(requests.headline||`联系请求 · ${requestCount} 条待核实`));
    text('alertDetail',requests.reason||'对方身份尚未核实，请先确认完整 Teams ID。');
    text('alertAdvice',requests.advice||'核实前请勿通过请求。');
    text('contactRequests',`查看陌生好友 · ${requestCount} 条待核实 →`);
  }else if(hasAlert){
    text('alertTitle','⚠ 有重要事项待处理');
    const detail=[newCount>0?`新人员待审核 ${newCount}`:'',urgentCount>0?`重要事件 ${urgentCount}`:''].filter(Boolean);
    text('alertDetail',detail.join(' · ')+'。点击下方对应数字处理。');
  }
}

function feedback(message){const el=by('scanFeedback');el.hidden=false;el.textContent=message;}
async function loadRequestNotice(){
  const revision=++requestNoticeRevision;
  try{const r=await chrome.runtime.sendMessage({action:'REQUEST_NOTICE_STATUS'});
    if(revision!==requestNoticeRevision||!r?.ok)return;
    lastRequestNotice=r.requestNotice||{pending:false};
    by('requestNotice').hidden=!lastRequestNotice.pending;
    document.body.classList.toggle('has-request-notice',!!lastRequestNotice.pending);
    if(lastRequestNotice.pending){TGSRequestView.render(by('requestNoticeDetails'),lastRequestNotice);
      text('requestNoticeIdentity',lastRequestNotice.identityNote||'人员 ID：待核实 · 消息内容：尚未读取');
      text('requestNoticeAdvice',lastRequestNotice.advice||'未知联系请求，务必核实身份。切勿共享账号信息或授权登录。');
      text('requestNoticeTitle','🔴 '+lastRequestNotice.headline);
      text('requestNoticeReason',lastRequestNotice.reason+(lastRequestNotice.visible===false?' 请求当前未显示，官方处理状态未知。':''));}
  }catch{} // group summary failure must not suppress this independent card
}
by('requestNoticeAck').onclick=async()=>{
  if(!lastRequestNotice?.pending)return;
  const b=by('requestNoticeAck');b.disabled=true;
  try{const r=await chrome.runtime.sendMessage({action:'ACK_REQUEST_UI_NOTICE',revision:lastRequestNotice.revision,
    tabId:lastRequestNotice.tabId,token:lastRequestNotice.token});
    if(!r?.ok)feedback(r?.error||'提醒已变化，请刷新后再查看');
    await loadRequestNotice();
  }catch{feedback('暂时无法收起提醒，请稍后重试');}finally{b.disabled=false;}
};
async function summary(){
  const revision=++summaryRevision;
  try{
    const m=await chrome.runtime.sendMessage({action:'SUMMARY'});
    if(revision!==summaryRevision)return;
    if(!m?.ok)throw new Error(m?.error||'暂无状态');
    const guard=m.guard||null, n=m.counts||{},status=m.status||{};
    const readOnly=guard?.mode==='READ_ONLY';lastGuard=readOnly?guard:null;
    // Active may point to ANOTHER account. Never display its cached counts as current-user facts.
    const sameAccount=!!m.active?.account && !!guard?.account && m.active.account===guard.account;
    const safeIndexed=typeof status.indexed==='boolean'?status.indexed:(!readOnly||sameAccount);
    text('groups',typeof status.groups==='number'?safeCount(status.groups):(readOnly?safeCount(guard.inspected):safeCount(n.groups)));
    text('groupsLabel',readOnly?'本次读取群（只读）':'已记录群组（含历史）');
    text('groupCountNote',readOnly?'此处是本次缓存读到的群，账号未确认前不更新历史名单。':'已记录群组包含历史记录，不等于当前仍加入的群。');
    text('persons',safeIndexed?safeCount(n.people):'—');
    text('unknown',safeIndexed?safeCount(n.newUnknown):'—');
    text('events',safeIndexed?safeCount(n.openUrgent):'—');
    text('personsLabel',safeIndexed?'已记录人员':'人员待确认');
    text('unknownLabel',safeIndexed?'新人员待审核':'待审核数未知');
    text('eventsLabel',safeIndexed?'重要事件待处理':'事件数未知');
    const requests=safeIndexed?(n.requests||{pending:0}):{pending:0};
    updateAlertAppearance(n.newUnknown,n.openUrgent,safeIndexed,requests);

    // Only stored, current-account groups have a usable filtered destination.
    // READ_ONLY scan-only observations must not open an empty group list.
    const savedRosterReviews=safeIndexed?safeCount(n.ambiguous):0;
    by('rosterReviewBanner').hidden=savedRosterReviews===0;
    text('rosterReviewCount',savedRosterReviews);
    const info=safeIndexed?safeCount(n.openInfo):0;
    by('infoEvents').hidden=info===0;
    text('infoEventCount',info);
    const level=status.level||((safeIndexed&&(n.newUnknown>0||n.openUrgent>0))?'alert':readOnly?'readonly':'ok');
    const notice=by('healthBanner');
    // A saved yellow roster review uses the actionable shortcut, even when
    // red items take priority in the main toolbar status.
    notice.hidden=!['readonly','review','stale','uninitialized'].includes(level) ||
      (level==='review'&&savedRosterReviews>0);
    document.body.classList.toggle('has-warning',!notice.hidden||savedRosterReviews>0);
    if(level==='readonly')text('healthTitle',guard?.readerDegraded===true?'⚠ 缓存读取需恢复':'⚠ 账号需要核对');
    if(level==='readonly')text('healthDetail',guard?.readerDegraded===true?
      'Teams 缓存本次读取不完整，插件会自动重试，连续失败时重建内部读取器；原成员名单不会被覆盖。':
      '账号处于只读保护：请核对当前 Teams 身份；不会覆盖原成员基线。');
    else if(level==='review'){text('healthTitle','⚠ 群名单需要核查');text('healthDetail',`有 ${safeCount(status.ambiguous)} 个群需要核对成员名单；这不是已确认的入群或退群。`);}
    else if(level==='stale'){
      text('healthTitle','⚠ 最近巡检未完成');
      const health=status.scanHealth||{};
      const detail=typeof health.lastError==='string'?health.lastError.slice(0,140):'';
      text('healthDetail',`最近约 3 分钟没有成功读取 Teams 群成员缓存。${detail?'上次失败：'+detail+'。':'请确认 Teams 页面已打开并登录。'}插件会自动重试，也可以点击「立即巡检」。`);
    }
    else if(level==='uninitialized'){text('healthTitle','⚠ 尚未开始监控');text('healthDetail','还没有建立群组记录，请打开 Teams 并巡检一次。');}
    const act=by('identityAction');act.hidden=!(readOnly&&guard.canBind&&guard.account);
    const picker=by('setupSelfPicker');
    picker.hidden=!(readOnly&&guard.canBind&&guard.firstSetup);
    if(!picker.hidden){
      const select=by('setupSelfSelect'),key=guard.account+'|'+(guard.setupHash||'');
      if(bindingOfferKey!==key){bindingOfferKey=key;lastSuggestedId='';select.value='';by('setupSelfManual').value='';by('setupSelfSuffix').value='';}
      const suggestion=guard.selfSuggestion||{status:'NOT_FOUND',reason:'未找到明确的本人线索，请勿猜选。'};
      const recommended=suggestion.status==='CANDIDATE'?suggestion.personId:'';
      if(recommended!==lastSuggestedId&&select.value===lastSuggestedId&&!by('setupSelfManual').value.trim()){
        select.value='';by('setupSelfSuffix').value='';
      }
      lastSuggestedId=recommended;
      const chosen=select.value||(!by('setupSelfManual').value.trim()?recommended:'');
      select.replaceChildren();
      const empty=document.createElement('option');empty.value='';empty.textContent='— 请核对并选择本人 ID —';select.append(empty);
      for(const person of Array.isArray(guard.selfCandidates)?guard.selfCandidates:[]){
        if(typeof person.id!=='string')continue;
        const option=document.createElement('option');option.value=person.id;
        const label=(person.nameConflict?'姓名冲突，待核实':typeof person.name==='string'&&person.name?person.name:'姓名尚未取得')+' · ';
        option.textContent=label+String(person.count||0)+'/'+String(guard.eligibleGroups||0)+' 群 · '+person.id.slice(-22);
        select.append(option);
      }
      select.value=[...select.children].some(c=>c.value===chosen)?chosen:'';
      text('selfSuggestionTitle',recommended?'找到一个本人候选，请你确认':'尚未自动定位本人 ID');
      text('selfSuggestionReason',(recommended?(suggestion.name||'姓名尚未确认')+' · '+recommended+'。':'')+suggestion.reason);
      by('smallSetupFields').hidden=!guard.smallSetup&&!recommended;
      updateChosenSelfId();
    }
    if(readOnly&&guard.canBind&&guard.firstSetup){
      text('identityActionTitle','新账号首次安全建档（只需确认一次）');
      text('bindCurrent','确认当前 Teams 账号并建立基线');
    }else{
      text('identityActionTitle','账号保护：需要确认绑定');
      text('bindCurrent','确认当前账号并建立 / 沿用基线');
    }
    if(readOnly){
      const current=safeCount(guard.inspected),compared=safeCount(guard.compared);
      text('status',`⚠ ${guard.readerDegraded===true?'缓存读取待恢复':'账号只读守护'}：已读取 ${current} 群缓存，与既有基线比对 ${compared} 群。${guard.reason||'身份待确认'}。本次未覆盖群成员基线。${!compared?'当前没有可用于安全比较的已绑定群组基线，因此不能认为正在提供完整新增预警。':''}`);
      text('identityExplanation',guard.readerDegraded===true?
        `正在等待 Teams 缓存恢复完整；无需重新绑定账号、无需刷新页面。本次观察 ${current} 群，未修改原有数据。`:
        guard.firstSetup===true?
          `此 Chrome 用户资料尚无旧人员基线，已读取 ${current} 群。请确认当前登录的是需要监控的 Teams 账号；确认一次后建立初始名单，以后浏览器重启无需重复确认。`:
          `请先确认你正在使用正确的 Teams 账号。只读观察 ${current} 群；确认绑定后再巡检，才会写入当前账号的正式索引。不会把旧账号的数据自动迁入其他账号。`);
    }else if(m.active?.at){
      text('status',`最近巡检：${new Date(m.active.at).toLocaleString()} · 已记录 ${safeCount(n.groups)} 群（含历史）`);
    }else text('status','还没有群组记录。请打开 Teams，再点击「立即巡检」。');
  }catch(e){if(revision!==summaryRevision)return;updateAlertAppearance(0,0,false);by('infoEvents').hidden=true;by('rosterReviewBanner').hidden=true;by('healthBanner').hidden=false;
    document.body.classList.add('has-warning');text('healthDetail','状态暂时无法读取，不能视为正常。');
    text('status','本地索引读取失败：'+e.message);}
}
const CARD_ROUTES=Object.freeze({
  groups:{page:'groups',filter:'all'},
  people:{page:'people',filter:'all'},
  review:{page:'review',filter:'NEW'},
  events:{page:'events',filter:'urgent'},
  rosterReview:{page:'groups',filter:'uncertain'}
});
function dashboard(open='',destination=''){
  const params=new URLSearchParams();
  if(open){params.set('page','groups');params.set('open',open);}
  else if(CARD_ROUTES[destination]){
    const {page,filter}=CARD_ROUTES[destination];params.set('page',page);params.set('filter',filter);
  }
  chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html')+(params.size?'?'+params.toString():'')});
}
for(const card of document.querySelectorAll('.stat-link')){
  card.addEventListener('click',()=>dashboard('',card.dataset.destination));
}
by('rosterReviewLink').onclick=()=>dashboard('', 'rosterReview');
by('dashboard').onclick=()=>dashboard();
by('infoEvents').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html?page=events&filter=info')});
by('upgradeSafety').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html?page=settings')});
function updateChosenSelfId(){text('setupSelfChosen',by('setupSelfManual').value.trim()||by('setupSelfSelect').value||'尚未选择本人 ID');}
by('setupSelfSelect').onchange=updateChosenSelfId;
by('setupSelfManual').oninput=updateChosenSelfId;
by('findSelfId').onclick=async()=>{const b=by('findSelfId');b.disabled=true;b.textContent='正在读取本地线索…';
  try{const r=await chrome.runtime.sendMessage({action:'SCAN_NOW'});if(!r?.ok)feedback(r?.error||'本次查找未完成，请稍后重试');await summary();}
  catch{feedback('本地查找暂未完成，请稍后重试');}finally{b.disabled=false;b.textContent='查找 / 刷新本人 ID';}};
by('bindCurrent').onclick=async()=>{
  const b=by('bindCurrent');b.disabled=true;
  try{
    // Do not accept a stale binding offer cached in the popup.
    let s=await chrome.runtime.sendMessage({action:'SUMMARY'});
    let guard=s?.guard;
    if(guard?.mode!=='READ_ONLY'||!guard.canBind||!guard.account||Date.now()-guard.at>100000){
      const fresh=await chrome.runtime.sendMessage({action:'SCAN_NOW'});
      if(!fresh?.ok)throw new Error(fresh?.error||'无法更新账号扫描状态');
      s=await chrome.runtime.sendMessage({action:'SUMMARY'});guard=s?.guard;
    }
    if(guard?.mode!=='READ_ONLY'||!guard.canBind||!guard.account)
      throw new Error('当前没有可安全绑定的账号，请检查 Teams 是否正在登录你的原账号');
    const selfId=guard.firstSetup?(by('setupSelfManual').value.trim()||by('setupSelfSelect').value):'';
    if(guard.firstSetup&&!selfId)throw new Error('请先从候选名单中选出本人 ID，或填写完整的 Teams 成员 ID');
    if(guard.firstSetup&&!(guard.selfEvidenceIds||(guard.selfCandidates||[]).map(c=>c.id)).includes(selfId))
      throw new Error('该 ID 没有出现在本次有效群名单中，请核对后再试');
    const needsSelfCheck=guard.smallSetup||guard.selfSuggestion?.status==='CANDIDATE';
    const last6=needsSelfCheck?by('setupSelfSuffix').value.trim():'';
    if(needsSelfCheck&&last6!==selfId.slice(-6))throw new Error('请核对完整本人 ID，并填写正确的最后 6 位');
    const question=guard.firstSetup?
      `这是当前 Chrome 用户资料的首次建档。\n\n你确认本人 Teams 成员 ID 是：\n${selfId}\n\n${guard.smallSetup?'群数量较少，插件无法自动识别哪位成员是你。请确认已通过本人资料核对完整 ID，而不是仅凭姓名选择。\n\n':''}确认后将只为这个 Chrome 资料建立本地基线，不会读取其他 Chrome 用户资料，也不会把初次观察的成员误报为新加入。此操作不是微软服务器认证。`:
      '请确认：当前 Teams 页面登录的是你要监控的账号。\n\n绑定后下一次巡检将为该账号创建或更新群组基线；若这是新装的扩展，不会自动找回另一个扩展 ID 的历史数据。';
    if(!confirm(question))return;
    const bind=await chrome.runtime.sendMessage({action:'BIND_CURRENT',account:guard.account,
      ...(guard.firstSetup?{selfId}:{}),...(needsSelfCheck?{last6,selfConfirmed:true}:{}),...(guard.smallSetup?{smallConfirmed:true}:{})});
    if(!bind?.ok)throw new Error(bind?.error||'绑定失败');
    const scan=await chrome.runtime.sendMessage({action:'SCAN_NOW'});
    feedback(scan?.ok?(scan.readOnly?`已确认身份，但本次仍处于只读：${scan.guardReason||'身份校验暂不可用'}。未改写基线。`:`绑定成功，已建立 / 更新 ${safeCount(scan.scanned)} 群索引。`):'绑定已保存；重扫未完成：'+(scan?.error||'请稍后再试'));
    await summary();
  }catch(e){feedback('绑定未完成：'+e.message);await summary();}
  finally{b.disabled=false;}
};
by('scan').onclick=async()=>{
  const b=by('scan');b.disabled=true;b.textContent='正在巡检…';
  try{
    const r=await chrome.runtime.sendMessage({action:'SCAN_NOW'});
    if(!r?.ok)feedback(r?.error||'巡检未完成，请稍后重试');
    else if(r.readOnly)feedback(`已观察 ${safeCount(r.scanned)} 群（只读），与基线比对 ${safeCount(r.compared)} 群；当前不会修改历史索引。`);
    else feedback(`${r.reconnected?'巡检连接已恢复。':'巡检完成。'}本次读取 ${safeCount(r.scanned)} 群，发现 ${safeCount(r.observedAdded)} 条新成员关系。注意：仅为缓存观察。`);
    await summary();
  }catch(e){feedback('巡检未完成：'+e.message);}
  finally{b.disabled=false;b.textContent='立即巡检';}
};
summary();
loadRequestNotice();
(async()=>{const sel=by('overlayMode');try{const r=await chrome.runtime.sendMessage({action:'OVERLAY_STATUS'});if(r?.ok)sel.value=r.prefs.mode;}catch{}
  sel.onchange=async()=>{try{const current=await chrome.runtime.sendMessage({action:'OVERLAY_STATUS'});
    const r=await chrome.runtime.sendMessage({action:'OVERLAY_PREFS_SET',prefs:{...current.prefs,mode:sel.value}});
    by('overlayNote').textContent=r?.ok?'已应用到 Teams 网页':(r?.error||'保存失败');
  }catch(e){by('overlayNote').textContent='保存失败：'+e.message;}};
})();

// Popup is short-lived. While it stays open, reflect changes without another click.
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')summary();});
if(typeof setInterval==='function')setInterval(()=>{if(document.visibilityState!=='hidden'){summary();loadRequestNotice();}},8000);

by('contactRequests').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html?page=requests')});

// A completed scan or local review refreshes an open popup immediately.
chrome.runtime.onMessage.addListener(msg=>{if(msg?.action==='SECURITY_STATE_CHANGED'){loadRequestNotice();summary();}});
