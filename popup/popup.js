const by=id=>document.getElementById(id);
let lastGuard=null;
const safeCount=n=>Number.isInteger(n)&&n>=0?n:0;
const text=(id,value)=>{by(id).textContent=String(value);};
// An open identity-review item is not proof of a malicious join. Emphasize action required.
// Counts are intentionally hidden if the current read-only identity cannot be linked
// to the persisted account. Never display the previous account's urgent counters.
function updateAlertAppearance(unknown, urgent, safe){
  const newCount=safe?safeCount(unknown):0,urgentCount=safe?safeCount(urgent):0;
  const hasAlert=newCount>0||urgentCount>0;
  document.body.classList.toggle('has-alert',hasAlert);
  by('statUnknown').classList.toggle('needs-attention',newCount>0);
  by('statEvents').classList.toggle('needs-attention',urgentCount>0);
  by('alertBanner').hidden=!hasAlert;
  if(hasAlert){
    text('alertTitle','⚠ 存在待核查事项');
    text('alertDetail',`新身份待审 ${newCount} · 重要未处理 ${urgentCount}。点击下方红色卡片查看。`);
  }
}

function feedback(message){const el=by('scanFeedback');el.hidden=false;el.textContent=message;}
async function summary(){
  try{
    const m=await chrome.runtime.sendMessage({action:'SUMMARY'});
    if(!m?.ok)throw new Error(m?.error||'暂无状态');
    const guard=m.guard||null, n=m.counts||{},status=m.status||{};
    const readOnly=guard?.mode==='READ_ONLY';lastGuard=readOnly?guard:null;
    // Active may point to ANOTHER account. Never display its cached counts as current-user facts.
    const sameAccount=!!m.active?.account && !!guard?.account && m.active.account===guard.account;
    const safeIndexed=typeof status.indexed==='boolean'?status.indexed:(!readOnly||sameAccount);
    text('groups',typeof status.groups==='number'?safeCount(status.groups):(readOnly?safeCount(guard.inspected):safeCount(n.groups)));
    text('groupsLabel',readOnly?'本次缓存观察群（只读）':'已索引群组');
    text('persons',safeIndexed?safeCount(n.people):'—');
    text('unknown',safeIndexed?safeCount(n.newUnknown):'—');
    text('events',safeIndexed?safeCount(n.openUrgent):'—');
    text('personsLabel',safeIndexed?'唯一人员':'人员数待绑定');
    text('unknownLabel',safeIndexed?'新身份待审':'待审核数未建立');
    text('eventsLabel',safeIndexed?'重要未处理':'历史事件未加载');
    updateAlertAppearance(n.newUnknown,n.openUrgent,safeIndexed);
    const level=status.level||((safeIndexed&&(n.newUnknown>0||n.openUrgent>0))?'alert':readOnly?'readonly':'ok');
    const notice=by('healthBanner');
    notice.hidden=!['readonly','review','stale','uninitialized'].includes(level);
    document.body.classList.toggle('has-warning',!notice.hidden);
    if(level==='readonly')text('healthDetail',guard?.readerDegraded===true?
      'Teams 缓存本次读取不完整，插件会自动重试，连续失败时重建内部读取器；原成员名单不会被覆盖。':
      '账号处于只读保护：请核对当前 Teams 身份；不会覆盖原成员基线。');
    else if(level==='review')text('healthDetail',`有 ${safeCount(status.ambiguous)} 个群名单待核查。缓存变化尚未证明有人真实进出群。`);
    else if(level==='stale'){
      const health=status.scanHealth||{};
      const detail=typeof health.lastError==='string'?health.lastError.slice(0,140):'';
      text('healthDetail',`最近约 3 分钟没有成功读取 Teams 群成员缓存。${detail?'上次失败：'+detail+'。':'请确认 Teams 页面已打开并登录。'}插件会自动重试，也可以点击「立即巡检」。`);
    }
    else if(level==='uninitialized')text('healthDetail','尚未建立正式巡检索引，当前不能判断是否安全。');
    const act=by('identityAction');act.hidden=!(readOnly&&guard.canBind&&guard.account);
    if(readOnly){
      const current=safeCount(guard.inspected),compared=safeCount(guard.compared);
      text('status',`⚠ ${guard.readerDegraded===true?'缓存读取待恢复':'账号只读守护'}：已读取 ${current} 群缓存，与既有基线比对 ${compared} 群。${guard.reason||'身份待确认'}。本次未覆盖群成员基线。${!compared?'当前没有可用于安全比较的已绑定群组基线，因此不能认为正在提供完整新增预警。':''}`);
      text('identityExplanation',guard.readerDegraded===true?
        `正在等待 Teams 缓存恢复完整；无需重新绑定账号、无需刷新页面。本次观察 ${current} 群，未修改原有数据。`:
        `请先确认你正在使用正确的 Teams 账号。只读观察 ${current} 群；确认绑定后再巡检，才会写入当前账号的正式索引。不会把旧账号的数据自动迁入其他账号。`);
    }else if(m.active?.at){
      text('status',`上次缓存观察：${new Date(m.active.at).toLocaleString()} · 已索引 ${safeCount(n.groups)} 群 · Teams 缓存并非实时服务端名单`);
    }else text('status','没有已建立的群组索引。请保持 Teams 标签页打开并进行一次巡检。');
  }catch(e){updateAlertAppearance(0,0,false);by('healthBanner').hidden=false;
    document.body.classList.add('has-warning');text('healthDetail','状态暂时无法读取，不能视为正常。');
    text('status','本地索引读取失败：'+e.message);}
}
const CARD_ROUTES=Object.freeze({
  groups:{page:'groups',filter:'all'},
  people:{page:'people',filter:'all'},
  review:{page:'review',filter:'NEW'},
  events:{page:'events',filter:'urgent'}
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
by('dashboard').onclick=()=>dashboard();
by('upgradeSafety').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html?page=settings')});
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
    if(!confirm('请确认：当前 Teams 页面登录的是你要监控的账号。\n\n绑定后下一次巡检将为该账号创建或更新群组基线；若这是新装的扩展，不会自动找回另一个扩展 ID 的历史数据。'))return;
    const bind=await chrome.runtime.sendMessage({action:'BIND_CURRENT',account:guard.account});
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
    if(!r?.ok)feedback(r?.error||'巡检未完成');
    else if(r.readOnly)feedback(`已观察 ${safeCount(r.scanned)} 群（只读），与基线比对 ${safeCount(r.compared)} 群；当前不会修改历史索引。`);
    else feedback(`已更新 ${safeCount(r.scanned)} 群索引，本次观察到 ${safeCount(r.observedAdded)} 条新成员关系。`);
    await summary();
  }catch(e){feedback('巡检未完成：'+e.message);}
  finally{b.disabled=false;b.textContent='立即巡检';}
};
by('nameCurrent').onclick=async()=>{
  try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.url?.startsWith('https://teams.live.com/')){feedback('先切换到 Teams 群聊标签页，再点击此按钮');return;}
    const r=await chrome.tabs.sendMessage(tab.id,{action:'GET_ACTIVE_THREAD'});
    if(r?.ok){dashboard(r.threadId);window.close();}
    else feedback('当前 Teams 页面 URL 没有可识别的群 ID。请到群组中心通过成员搜索并设置别名。');
  }catch{feedback('无法自动识别当前群；请到群组中心按成员 ID 或姓名搜索。');}
};
summary();
(async()=>{const sel=by('overlayMode');try{const r=await chrome.runtime.sendMessage({action:'OVERLAY_STATUS'});if(r?.ok)sel.value=r.prefs.mode;}catch{}
  sel.onchange=async()=>{try{const current=await chrome.runtime.sendMessage({action:'OVERLAY_STATUS'});
    const r=await chrome.runtime.sendMessage({action:'OVERLAY_PREFS_SET',prefs:{...current.prefs,mode:sel.value}});
    by('overlayNote').textContent=r?.ok?'已应用到 Teams 网页':(r?.error||'保存失败');
  }catch(e){by('overlayNote').textContent='保存失败：'+e.message;}};
})();

// Popup is short-lived. While it stays open, reflect changes without another click.
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')summary();});
if(typeof setInterval==='function')setInterval(()=>{if(document.visibilityState!=='hidden')summary();},8000);
