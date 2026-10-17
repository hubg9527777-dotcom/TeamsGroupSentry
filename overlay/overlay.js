/* Local Teams overlay: bounded request text, no raw IDs or active message HTML. */
(()=>{
  if(window!==window.top||location.origin!=='https://teams.live.com')return;
  const HOST_ID='tgs-v31-status-host';
  if(globalThis.__TGS_OVERLAY_ACTIVE_V4__)return;
  globalThis.__TGS_OVERLAY_ACTIVE_V4__=true;
  // An old Chrome extension context can leave a dead DOM host after an update.
  document.getElementById?.(HOST_ID)?.remove();
  let host=null,refs={},current=null,expanded=false,settingsOpen=false,pollInFlight=false;
  let noticeGeneration=0,refreshPending=false;
  const safeCount=n=>Number.isInteger(n)&&n>0?n:0;
  const CSS=`
    :host{all:initial;color-scheme:light!important;font-family:system-ui,-apple-system,'Segoe UI',sans-serif!important}
    *{box-sizing:border-box}
    .shell{max-width:min(340px,calc(100vw - 24px));min-width:202px;background:#fff;color:#24344a;
      border:1px solid #cbd8e8;border-radius:13px;box-shadow:0 6px 22px rgba(31,52,83,.18);
      font-size:12px;overflow:hidden;pointer-events:auto}
    .line{display:flex;align-items:center;gap:7px;padding:6px 8px;min-height:38px}
    button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:7px;padding:5px}
    button:focus-visible,select:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
    .primary{display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-align:left;padding:5px 3px}
    .dot{width:8px;height:8px;border-radius:50%;background:#2e946e;flex-shrink:0}
    .primary-label{min-width:0;display:block}
    .title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:215px}
    .info-count{background:#eaf3ff;border:1px solid #a6caed;color:#245e9c;font-size:11px;font-weight:700;
      padding:4px 6px;white-space:nowrap;flex-shrink:0}
    .info-count:hover{background:#d7eafd}
    .request-count{color:#a11c2c;background:#fff0f0;border-color:#d64b52}
    .request-count:hover{background:#ffe3e4}
    .toggle{font-size:15px;color:#64748b;padding:4px 6px;flex-shrink:0}
    .toggle[aria-expanded="true"]{color:#1c63a5;background:#edf4fb}
    .shell.alert{border-color:#d64b52;background:#fff7f7}
    .shell.alert .dot{background:#d22f36;animation:pulse 1.4s 3}
    .shell.alert .title{color:#a11c2c}
    .shell.request-alert{width:340px;max-width:calc(100vw - 24px);border:2px solid #bf2634;background:#fff0f1}
    .shell.request-alert .line{align-items:center}
    .shell.request-alert .primary-label{flex:1}
    .shell.request-alert .title{white-space:normal;overflow:visible;text-overflow:clip;max-width:none;line-height:1.45}
    .shell.notice-alert{width:340px;max-width:calc(100vw - 24px);border:2px solid #c52a32;background:#fff0f1}
    .shell.notice-alert .dot{background:#c52a32}.shell.notice-alert .title{color:#861c29;white-space:normal;max-width:none}
    .shell.notice-alert .request-reason{color:#861c29}.shell.notice-alert .request-count{color:#861c29;background:#ffe1e5;border-color:#c52a32}
    .notice-excerpts{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow-y:auto;font-weight:600}
    .notice-warning{border:2px solid #c52a32;border-left-width:5px;border-radius:9px;background:#fff0f1;padding:10px;display:grid;gap:7px;color:#861c29}
    .details .notice-warning p{font-size:12px;color:#861c29}.notice-warning button{background:#b42332;color:white;padding:9px}
    .request-reason{color:#a11c2c;font-size:11px;font-weight:650;line-height:1.5;margin-top:3px;white-space:normal}
    .request-warning{border:2px solid #bf2634;border-left-width:5px;border-radius:9px;background:#fff0f1;padding:10px;display:grid;gap:7px;color:#9d1f2e}
    .request-warning strong{font-size:13px}
    .details .request-warning p{color:#8f1d2a;font-size:12px;font-weight:650}
    .request-warning button{width:100%;background:#b42332;color:#fff;font-weight:700;padding:9px;border-radius:7px}
    .request-warning button:hover{background:#971b29}
    .info-detail-link{text-align:left;color:#205a9f;background:#eaf3ff;padding:6px 8px;font-size:11px}
    .shell.stale{border-color:#d8a23d;background:#fffbf1}
    /* The JS uses the stale class for ALL yellow attention states.  The old
       .shell.warning selector never matched, leaving a misleading green dot. */
    .shell.stale .dot{background:#bc8d1e}
    .shell.stale .title{color:#805819}
    .shell.informative{border-color:#9cc9f4;background:#f6faff}
    .shell.informative .dot{background:#2a72c6}
    .shell.informative .title{color:#205a9f}
    .details{border-top:1px solid #e5ebf2;padding:10px 11px;display:grid;gap:9px;color:#37485b;line-height:1.5}
    .details p{margin:0;color:#4e6075;font-size:11px}
    .details .info-line{color:#205a9f;font-weight:650}
    .actions{display:flex;gap:7px;flex-wrap:wrap}
    .actions button{background:#edf3fa;padding:6px 9px;border:1px solid #cad9e9;font-size:11px}
    .actions button:hover{background:#e2eefb}
    .actions .alert-primary{flex:1 1 44%;font-weight:700;color:#a0222d;background:#fff0f0;border-color:#e3a6aa}
    .actions .alert-primary:hover{background:#ffe3e4}
    .actions .review-primary{flex:0 0 100%;text-align:center;padding:9px 11px;
      font-weight:700;font-size:12px;color:#805314;background:#fff0cd;border:1px solid #d6a13c}
    .actions .review-primary:hover{background:#ffe6af}
    .settings-panel{padding-top:8px;border-top:1px solid #e4e9f1;display:grid;gap:8px}
    .setting-row{display:flex;gap:8px;justify-content:space-between;align-items:center;font-size:11px}
    select{max-width:176px;font:inherit;border:1px solid #b8c6d6;border-radius:6px;padding:5px;background:#fff;color:#243449}
    .muted{font-size:10px;color:#6a7890}
    [hidden]{display:none!important}

.request-item{display:grid;gap:5px;padding:12px 0;border-bottom:1px solid #59434e;overflow-wrap:anywhere}
.request-item:first-child{padding-top:0}.request-item:last-child{border-bottom:0;padding-bottom:0}
.request-kind{font-size:11px;color:#c9bdc6;font-weight:500;letter-spacing:.3px}
.request-item .request-item-name{display:block;font-size:14px;color:#fff;font-weight:700;line-height:1.5}
.request-inviter{font-size:11px;color:#d6cbd3}
.request-item .request-message{font-size:13px;line-height:1.65;margin:2px 0 0;color:#fff;font-weight:400;white-space:pre-wrap}
.request-item .message-author{font-size:12px;color:#f1e8ee;font-weight:600}
.request-no-body,.request-empty{color:#e5c3a0;font-size:12px;font-weight:400;line-height:1.6;margin:0}

.shell.notice-alert,.shell.request-alert{background:#291e27;color:#fff;border-color:#c52a32}
.shell.notice-alert .title,.shell.request-alert .title{color:#ff9aa3}
.shell.notice-alert .request-reason,.shell.request-alert .request-reason{color:#f5eaf1;font-weight:400;white-space:pre-line;overflow-wrap:anywhere;font-size:11px;line-height:1.7}
.shell.notice-alert .request-count,.shell.request-alert .request-count{color:#fff;background:#49313e;border:1px solid #8c5d70}
.shell.notice-alert .toggle,.shell.request-alert .toggle{color:#c9bdc6}
.shell.notice-alert .details,.shell.request-alert .details{color:#d6cbd3;border-color:#59434e;max-height:65vh;overflow-y:auto}
.notice-warning{background:transparent;border:0;border-radius:0;padding:2px 0 0;color:#fff;gap:10px}
.notice-warning>strong,.notice-warning>b{display:none}
.details .notice-warning>p{color:#c9bdc6;font-size:10px}
.details .notice-warning>.safety-advice{color:#ffadb4;font-size:12px;line-height:1.7;border-top:1px solid #59434e;padding-top:10px}
.notice-warning small{color:#bdb0bb;font-size:10px}
.notice-warning button{background:#49313e;border:1px solid #8c5d70;color:#fff;font-weight:500;padding:8px}
.notice-excerpts{white-space:normal;max-height:none;overflow:visible;font-weight:400}
.details .notice-warning .request-message{color:#fff;font-size:13px}
.details .notice-warning .request-no-body,.details .notice-warning .request-empty{color:#e5c3a0;font-size:12px}
.shell.notice-alert .details>p,.shell.request-alert .details>p{color:#c9bdc6}
.shell.notice-alert .line,.shell.request-alert .line{padding:9px 10px}
.shell.notice-alert .primary,.shell.request-alert .primary{align-items:flex-start}
.shell.notice-alert .dot,.shell.request-alert .dot{margin-top:5px}


/* Functional palette: neutral content, red request perimeter, isolated caution. */
.request-item{border-color:#435166}.request-kind,.request-inviter,.message-coverage{color:#ccd6e3}
.message-coverage{display:block;font-size:11px;line-height:1.6;margin-top:5px;font-weight:400}
.request-item .request-item-name,.request-item .request-message,.request-item .message-author{color:#f8fafc}

.shell.notice-alert,.shell.request-alert{background:#182230;color:#f8fafc}
.shell.notice-alert .title,.shell.request-alert .title{color:#ffb4b4}
.shell.notice-alert .request-reason,.shell.request-alert .request-reason{color:#f8fafc}
.shell.notice-alert .details,.shell.request-alert .details{border-color:#435166;color:#ccd6e3}
.shell.notice-alert .details>p,.shell.request-alert .details>p,.notice-warning small,.details .notice-warning>p{color:#ccd6e3}
.details .notice-warning>.safety-advice,.request-warning>p:last-of-type{background:#ffdf78;color:#241c08;
 border:1px solid #ffdf78;border-left:4px solid #d49500;border-radius:7px;padding:11px 12px;font-size:13px;font-weight:700;line-height:1.8}
.details .notice-warning>.safety-advice::before{content:'⚠ 安全提醒';display:block;margin-bottom:4px;font-size:12px;font-weight:800}
.shell.notice-alert .request-count,.shell.request-alert .request-count,.notice-warning button{background:#314158;border-color:#7d92ad;color:#f8fafc}
.shell.notice-alert .actions button,.shell.request-alert .actions button{background:#f8fafc;color:#24364f;border:1px solid #b5c4d8;font-weight:650;opacity:1}
.shell.notice-alert .actions button:hover,.shell.request-alert .actions button:hover{background:#dce8f7;color:#152943;border-color:#89a4c6}
.shell.notice-alert .actions button:disabled,.shell.request-alert .actions button:disabled{color:#526279;background:#dce2e9;cursor:default}
.shell.notice-alert .muted,.shell.request-alert .muted{color:#ccd6e3}
.details .notice-warning .request-message{color:#f8fafc}.details .notice-warning .request-no-body,.details .notice-warning .request-empty{color:#ffdf78}
.request-warning{background:#182230;color:#f8fafc}.request-warning strong{color:#ffb4b4}.details .request-warning p{color:#f8fafc}


.detail-scroll{display:grid;gap:9px;min-width:0}
.shell.notice-alert .details,.shell.request-alert .details{display:flex;flex-direction:column;max-height:min(78vh,calc(100vh - 150px));overflow:hidden;padding:0;gap:0}
.shell.notice-alert .detail-scroll,.shell.request-alert .detail-scroll{overflow-y:auto;min-height:0;padding:10px 11px;flex:1 1 auto}
.shell.notice-alert .details>.actions,.shell.request-alert .details>.actions{flex:0 0 auto;padding:10px 11px;border-top:1px solid #435166;background:#182230}
.details .notice-warning>.safety-advice,.details .request-warning>p:last-of-type{color:#241c08;white-space:pre-line}

    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
    @media(prefers-reduced-motion:reduce){.shell.alert .dot{animation:none}}
  `;
  function el(tag,cls,text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;}
  function openInfo(){chrome.runtime.sendMessage({action:'OPEN_DASHBOARD',page:'events',filter:'info'}).catch(()=>{});}
  function openPage(page,filter){chrome.runtime.sendMessage({action:'OPEN_DASHBOARD',page,filter}).catch(()=>{});}
  function build(){if(host||!document.documentElement)return;
    host=document.createElement('div');host.id=HOST_ID;
    host.style.cssText='all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;pointer-events:none;direction:ltr;';
    const shadow=host.attachShadow({mode:'closed'});
    const style=el('style');style.textContent=CSS;shadow.append(style);
    const shell=el('div','shell');refs.shell=shell;
    const line=el('div','line');
    const primary=el('button','primary');primary.type='button';primary.title='展开 / 收起巡检详情';
    primary.setAttribute('aria-expanded','false');refs.primary=primary;
    const dot=el('span','dot');
    const title=el('div','title','Teams 守护中');refs.title=title;
    const reason=el('div','request-reason');reason.hidden=true;refs.requestReason=reason;
    const text=el('span','primary-label');text.append(title,reason);primary.append(dot,text);
    primary.onclick=()=>{expanded=!expanded;settingsOpen=false;render();};
    const info=el('button','info-count');refs.infoCount=info;info.type='button';info.hidden=true;
    info.title='查看普通成员变动';info.onclick=openInfo;
    const settings=el('button','toggle','⚙');refs.settingsButton=settings;settings.type='button';
    settings.title='状态栏显示设置';settings.setAttribute('aria-label','打开状态栏设置');
    settings.onclick=()=>{expanded=true;settingsOpen=!settingsOpen;render();};
    const requests=el('button','info-count request-count','查看陌生好友');requests.type='button';requests.hidden=true;
    requests.onclick=()=>{if(current?.requests?.pending)openPage('requests');else{expanded=true;render();}};refs.requests=requests;
    line.append(primary,requests,info,settings);shell.append(line);
    const details=el('div','details');refs.details=details;details.hidden=true;
    const detailBody=el('div','detail-scroll');details.append(detailBody);
    const warning=el('section','request-warning');warning.hidden=true;refs.requestWarning=warning;
    refs.requestWarningTitle=el('strong');refs.requestWarningReason=el('p');refs.requestWarningAdvice=el('p');
    const requestDetails=el('button','','查看陌生好友');requestDetails.type='button';refs.requestDetails=requestDetails;
    requestDetails.onclick=()=>openPage('requests');
    warning.append(refs.requestWarningTitle,refs.requestWarningReason,refs.requestWarningAdvice,requestDetails);detailBody.append(warning);
    const notice=el('section','notice-warning');notice.hidden=true;refs.noticeWarning=notice;
    refs.noticeTitle=el('strong');refs.noticeReason=el('p');
    refs.noticeExcerpts=el('div','notice-excerpts');
    const missing=el('b','','人员 ID：待核实 · 消息内容：尚未读取');refs.noticeIdentity=missing;
    const advice=el('p','safety-advice','未知联系请求，务必核实身份。切勿共享账号信息或授权登录。');refs.noticeAdvice=advice;
    const ack=el('button','','收起本次提醒');ack.type='button';refs.noticeAck=ack;
    ack.onclick=async()=>{if(!current?.requestNotice?.pending)return;ack.disabled=true;
      try{const r=await chrome.runtime.sendMessage({action:'ACK_REQUEST_UI_NOTICE',revision:current.requestNotice.revision});
        if(!r?.ok)refs.noticeReason.textContent=r?.error||'提醒已变化，请刷新后再查看';
        else await refresh();
      }catch{refs.noticeReason.textContent='暂时无法收起提醒，请稍后重试';}finally{ack.disabled=false;}};
    notice.append(refs.noticeTitle,advice,refs.noticeExcerpts,refs.noticeReason,missing,ack,el('small','','仅收起提醒，不接受请求、不批准身份。'));detailBody.append(notice);
    refs.detailsText=el('p','','正在读取本地缓存巡检结果');detailBody.append(refs.detailsText);
    refs.infoLine=el('p','info-line');refs.infoLine.hidden=true;detailBody.append(refs.infoLine);
    refs.infoDetailLink=el('button','info-detail-link');refs.infoDetailLink.type='button';refs.infoDetailLink.hidden=true;refs.infoDetailLink.onclick=openInfo;detailBody.append(refs.infoDetailLink);
    const actions=el('div','actions');
    // Yellow roster review has one direct, prominent destination; do not send
    // users through the complete list of hundreds of unrelated groups.
    const reviewGroups=el('button','review-primary','查看待核查群');reviewGroups.type='button';
    reviewGroups.onclick=()=>openPage('groups','uncertain');reviewGroups.hidden=true;refs.reviewGroups=reviewGroups;
    const urgentEvents=el('button','alert-primary','查看重要事件');urgentEvents.type='button';urgentEvents.onclick=()=>openPage('events','urgent');urgentEvents.hidden=true;refs.urgentEvents=urgentEvents;
    const newPeople=el('button','alert-primary','审核新人员');newPeople.type='button';newPeople.onclick=()=>openPage('review','NEW');newPeople.hidden=true;refs.newPeople=newPeople;
    const events=el('button','','全部事件');events.type='button';events.onclick=()=>openPage('events','all');
    const review=el('button','','人员管理');review.type='button';review.onclick=()=>openPage('review');refs.reviewButton=review;
    const groups=el('button','','群组管理');groups.type='button';groups.onclick=()=>openPage('groups');refs.groups=groups;
    actions.append(reviewGroups,urgentEvents,newPeople,events,review,groups);details.append(actions);
    const options=el('div','settings-panel');refs.settingsPanel=options;options.hidden=true;
    const row=el('label','setting-row','状态栏显示');const select=el('select');refs.mode=select;
    for(const [v,label] of [['always','始终显示'],['alerts','有待办或变动时显示'],['hidden','隐藏（在插件里恢复）']]){
      const o=el('option','',label);o.value=v;select.append(o);}
    select.onchange=()=>updatePrefs({mode:select.value});row.append(select);options.append(row);
    const position=el('label','setting-row','显示位置');const offset=el('select');refs.offset=offset;
    for(const [v,label] of [['top','右上角'],['below','右侧靠下']]){const o=el('option','',label);o.value=v;offset.append(o);}
    offset.onchange=()=>updatePrefs({offset:offset.value});position.append(offset);options.append(position);
    options.append(el('div','muted','红色需处理，黄色需核查，蓝色是普通变动。点击标题展开详情。'));
    detailBody.append(options);
    shell.append(details);shadow.append(shell);document.documentElement.append(host);
  }
  async function updatePrefs(delta){if(!current)return;
    try{const r=await chrome.runtime.sendMessage({action:'OVERLAY_PREFS_SET',prefs:{...current.prefs,...delta}});
      if(r?.ok){current.prefs=r.prefs;render();}else{refs.detailsText.textContent='保存失败，请稍后重试';}
    }catch{refs.detailsText.textContent='扩展后台暂时无响应';}
  }
  function render(){if(!current)return;build();if(!host)return;
    const {prefs={},groups=0,newUnknown=0,openUrgent=0,openInfo=0,
      ambiguous=0,savedAmbiguous=0,lastRead=0,guard}=current;
    const ordinary=Number.isInteger(openInfo)&&openInfo>0?openInfo:0;
    const requestState=current.requests||{pending:0},requestCount=safeCount(requestState.pending);
    const hasRequests=requestCount>0;
    const notice=current.requestNotice||{pending:false},hasNotice=notice.pending===true;
    const degraded=current.readOnly===true||guard?.mode==='READ_ONLY';
    const level=current.level||((openUrgent||newUnknown)?'alert':degraded?'readonly':ordinary?'info':'ok');
    const urgent=hasRequests||level==='alert',attention=hasNotice||['readonly','review','stale','uninitialized'].includes(level);
    const informative=level==='info'||ordinary>0;
    const shouldHide=prefs.mode==='hidden'||(prefs.mode==='alerts'&&!urgent&&!attention&&!informative);
    host.style.display=shouldHide?'none':'block';host.style.top=prefs.offset==='below'?'76px':'12px';
    refs.shell.classList.toggle('alert',urgent);
    refs.shell.classList.toggle('request-alert',hasRequests);
    refs.shell.classList.toggle('notice-alert',hasNotice&&!urgent);
    refs.shell.classList.toggle('stale',!urgent&&attention&&!hasNotice);
    refs.shell.classList.toggle('informative',!urgent&&!attention&&informative);
    refs.infoCount.hidden=ordinary===0||hasRequests||hasNotice;refs.infoCount.textContent=`变动 ${ordinary>99?'99+':ordinary}`;
    // Don't offer an empty filtered list for volatile read-only-only warnings.
    const verifiedReviewCount=level==='review'?ambiguous:Math.max(0,savedAmbiguous);
    const showReviewCta=(attention||urgent)&&verifiedReviewCount>0;
    refs.reviewGroups.hidden=!showReviewCta;
    refs.urgentEvents.hidden=!(urgent&&openUrgent>0);
    refs.newPeople.hidden=!(urgent&&newUnknown>0);
    refs.reviewButton.hidden=urgent&&newUnknown>0;
    refs.groups.hidden=showReviewCta;
    // The related action goes first; generic links stay secondary.
    // Keep the compact headline readable in every state, even if INFO is also
    // pending.  Avoid "待核查 0" when a red state is caused only by new identities.
    refs.requests.hidden=!hasRequests&&!hasNotice;
    refs.requests.textContent=hasRequests?'查看陌生好友':'查看提醒';
    refs.requestReason.hidden=(!hasRequests&&!hasNotice)||(hasNotice&&!hasRequests&&expanded);
    refs.requestReason.textContent=hasRequests?(requestState.compactReason||'身份尚未核实')+' · 先核实':hasNotice?notice.compactReason:'';
    refs.noticeWarning.hidden=!hasNotice;
    if(hasNotice){TGSRequestView.render(refs.noticeExcerpts,notice,{latestOnly:true});
      refs.noticeIdentity.textContent=notice.identityNote||'人员 ID：待核实 · 消息内容：尚未读取';
      refs.noticeAdvice.textContent=notice.advice||'未知联系请求，务必核实身份。切勿共享账号信息或授权登录。';
      refs.noticeTitle.textContent='🔴 '+notice.headline;
      refs.noticeReason.textContent=notice.reason+(notice.visible===false?' 请求当前未显示，官方处理状态未知。':'');}
    refs.requestWarning.hidden=!hasRequests;
    if(hasRequests){
      refs.requestWarningTitle.textContent='🔴 '+(requestState.headline||`联系请求 · ${requestCount} 条待核实`);
      refs.requestWarningReason.textContent=requestState.reason||'对方身份尚未核实，请先确认完整 Teams ID。';
      refs.requestWarningAdvice.textContent=requestState.advice||'核实前请勿通过请求。';
      refs.requestDetails.textContent=`查看陌生好友 · ${requestCount} 条待核实 →`;
    }
    const redHeading=hasRequests?(requestState.headline||`联系请求 · ${requestCount} 条待核实`):[openUrgent>0?`重要事件 ${openUrgent}`:'',newUnknown>0?`新人员待审核 ${newUnknown}`:''].filter(Boolean).join(' · ')||'重要事项待处理';
    const heading=urgent?redHeading:hasNotice?notice.headline:
      level==='readonly'?(guard?.readerDegraded===true?'缓存正在恢复':`账号待确认 · 本次读取 ${groups} 群`):
      level==='review'?`${ambiguous} 群名单待核查`:
      level==='stale'?'巡检暂未完成':
      level==='uninitialized'?'尚未开始巡检':
      informative?`有普通变动 · 已记录 ${groups} 群`:`已记录 ${groups} 群 · 暂无待办`;
    refs.title.textContent=heading;
    refs.primary.title=hasRequests?(requestState.reason||'身份尚未核实')+'。点击展开提醒，或查看陌生好友。':hasNotice?notice.reason+' '+notice.compactReason:'展开 / 收起巡检详情';
    // A narrow Teams window may ellipsize the headline; the complete text
    // remains accessible by hover and to assistive technologies.
    refs.title.title=heading;
    refs.primary.setAttribute('aria-label',`${heading}${hasRequests?'。'+(requestState.reason||'身份尚未核实'):hasNotice?'。'+notice.compactReason:''}，点击${expanded?'收起':'展开'}巡检详情`);
    refs.infoCount.title=ordinary?`有 ${ordinary} 条普通变动待查看。点击查看相关群组和人员`:'暂无普通变动';
    refs.infoCount.setAttribute('aria-label',refs.infoCount.title);
    const scanAgo=lastRead?Date.now()-lastRead:0;
    const staleInfo=level==='stale'||(scanAgo>180000&&lastRead>0);
    const recent=lastRead?new Date(lastRead).toLocaleTimeString():'暂无';
    if(showReviewCta){
      // A concise action-first explanation replaces the old dense row of zero counts.
      const parts=[`要核对的群 ${verifiedReviewCount}`];
      if(newUnknown>0)parts.push(`新人员待审核 ${newUnknown}`);
      if(openUrgent>0)parts.push(`重要事件 ${openUrgent}`);
      parts.push(`已记录 ${groups} 群（含历史）`,`最近巡检 ${recent}`);
      refs.detailsText.textContent=parts.join(' · ')+'。请到 Teams 核对成员；缓存差异不能直接当作入群或退群。'+
        (degraded?' 当前处于只读保护，不会覆盖原名单。':'')+
        (staleInfo?' 缓存巡检正在自动重试。':'');
    }else{
      const parts=[`已记录 ${groups} 群（含历史）`];
      if(newUnknown>0)parts.push(`新人员待审核 ${newUnknown}`);
      if(openUrgent>0)parts.push(`重要事件 ${openUrgent}`);
      if(ambiguous>0)parts.push(`待核查群 ${ambiguous}`);
      if(degraded)parts.push(guard?.readerDegraded===true?'本地缓存读取不完整，正在自动重试；原名单已保护':
        `账号只读：${guard?.reason||'身份待确认'}；未修改原名单`);
      if(staleInfo)parts.push('最近约 3 分钟没有成功巡检，正在自动重试');
      parts.push(`最近巡检 ${recent}`);
      refs.detailsText.textContent=parts.join(' · ')+'。';
    }
        refs.infoLine.hidden=ordinary===0;
    if(ordinary)refs.infoLine.textContent=`另有 ${ordinary} 条普通变动待查看。`;
    refs.infoDetailLink.hidden=!hasRequests||ordinary===0;
    refs.infoDetailLink.textContent=`查看普通变动 ${ordinary} →`;
    refs.details.hidden=!expanded;
    refs.settingsPanel.hidden=!settingsOpen;
    refs.primary.setAttribute('aria-expanded',String(expanded));
    refs.settingsButton.setAttribute('aria-expanded',String(settingsOpen));
    refs.mode.value=prefs.mode||'always';refs.offset.value=prefs.offset==='below'?'below':'top';
  }
  async function refresh(){if(pollInFlight){refreshPending=true;return;}pollInFlight=true;const generation=noticeGeneration;
    try{const r=await chrome.runtime.sendMessage({action:'OVERLAY_STATUS'});if(r?.ok){
      current=generation===noticeGeneration?r:{...r,requestNotice:current?.requestNotice};render();
    }}catch{}finally{pollInFlight=false;if(refreshPending){refreshPending=false;refresh();}}
  }
  chrome.runtime.onMessage.addListener(msg=>{
    if(msg?.action==='REQUEST_NOTICE_CHANGED'){
      noticeGeneration++;current={...(current||{level:'uninitialized'}),requestNotice:msg.notice};render();
    }
    if(msg?.action==='OVERLAY_REFRESH')refresh().catch(()=>{});
  });
  if(document.documentElement){build();refresh();}else document.addEventListener('DOMContentLoaded',()=>{build();refresh();},{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('focus',()=>refresh());
  setInterval(()=>{if(document.visibilityState==='visible')refresh();},20000);
})();
