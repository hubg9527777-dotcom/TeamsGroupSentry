/* Isolated-world, minimal in-page status. Never exposes IDs or names in the Teams DOM. */
(()=>{
  if(window!==window.top || location.origin!=='https://teams.live.com')return;
  const HOST_ID='tgs-v31-status-host';
  let host=null,shadow,refs={},current=null,expanded=false,pollInFlight=false;
  const CSS=`
    :host{all:initial;color-scheme:light!important;font-family:system-ui,-apple-system,'Segoe UI',sans-serif!important}
    *{box-sizing:border-box}
    .shell{min-width:60px;max-width:260px;background:#fff;color:#233047;border:1px solid #ccd6e4;border-radius:12px;
      box-shadow:0 5px 22px rgba(20,39,60,.22);font-size:12px;overflow:hidden;pointer-events:auto}
    .line{display:flex;align-items:center;gap:7px;padding:8px;min-height:38px}
    button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:6px;padding:5px}
    button:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
    .primary{display:flex;align-items:center;gap:7px;flex:1;min-width:0;text-align:left}
    .dot{width:8px;height:8px;border-radius:50%;background:#3479b9;flex-shrink:0}
    .title{font-size:12px;font-weight:750;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
    .sub{font-size:10px;line-height:1.3;white-space:nowrap;color:#637084}
    .toggle{color:#64748b;font-size:15px;padding:4px}
    .shell.alert{background:#fff5f5;border-color:#d73c3c;color:#a32222}
    .shell.alert .dot{background:#d22f36;animation:pulse 1.4s 3}
    .shell.alert .sub{color:#963939}
    .shell.stale{background:#fff9e9;border-color:#d8a23d}
    .shell.stale .sub{color:#82601e}
    .shell.stale .dot{background:#bc8d1e}
    .details{border-top:1px solid #e2e7ef;padding:8px 10px;display:grid;gap:7px;color:#344155;line-height:1.5}
    .actions{display:flex;gap:5px;flex-wrap:wrap}
    .actions button{background:#edf2f8;padding:5px 8px;border:1px solid #d6dfeb}
    select{max-width:100%;font:inherit;border:1px solid #b8c6d6;border-radius:5px;padding:5px;background:#fff;color:#243449}
    .muted{font-size:10px;color:#5e7083}
    [hidden]{display:none!important}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
    @media(prefers-reduced-motion:reduce){.shell.alert .dot{animation:none}}
  `;
  function el(tag,cls,text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;}
  function build(){if(host||!document.documentElement)return;
    host=document.createElement('div');host.id=HOST_ID;host.style.cssText='all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;pointer-events:none;direction:ltr;';
    shadow=host.attachShadow({mode:'closed'});
    const style=el('style');style.textContent=CSS;shadow.append(style);
    const shell=el('div','shell');refs.shell=shell;
    const line=el('div','line');const primary=el('button','primary');primary.type='button';primary.title='查看 TeamsGroupSentry 状态与设置';
    const dot=el('span','dot');refs.dot=dot;const txt=el('span');refs.title=el('div','title','Teams 守护中');refs.subtitle=el('div','sub','读取本地缓存');txt.append(refs.title,refs.subtitle);primary.append(dot,txt);
    primary.onclick=()=>{expanded=!expanded;refs.details.hidden=!expanded;};
    const settings=el('button','toggle','⚙');settings.type='button';settings.title='展开显示/隐藏选项';settings.setAttribute('aria-label','打开守护状态栏设置');settings.onclick=()=>{expanded=!expanded;refs.details.hidden=!expanded;};
    line.append(primary,settings);shell.append(line);
    const details=el('div','details');refs.details=details;details.hidden=true;
    refs.detailsText=el('div','','尚无完整检查结果');details.append(refs.detailsText);
    const actions=el('div','actions');const open=el('button','','查看异常');open.onclick=()=>chrome.runtime.sendMessage({action:'OPEN_DASHBOARD',page:'events'}).catch(()=>{});
    const review=el('button','','待审人员');review.onclick=()=>chrome.runtime.sendMessage({action:'OPEN_DASHBOARD',page:'review'}).catch(()=>{});
    actions.append(open,review);details.append(actions);
    const modeRow=el('label','','状态栏显示：');const select=el('select');refs.mode=select;
    for(const [value,text]of [['always','始终显示'],['alerts','只在异常时显示'],['hidden','隐藏（可从插件恢复）']]){
      const o=el('option','',text);o.value=value;select.append(o);}
    select.onchange=()=>updatePrefs({mode:select.value});modeRow.append(select);details.append(modeRow);
    const smallLabel=el('label','','紧凑模式：');const cb=el('input');refs.compact=cb;cb.type='checkbox';cb.checked=true;
    cb.onchange=()=>updatePrefs({compact:cb.checked});smallLabel.append(cb);details.append(smallLabel);
    const offsetLabel=el('label','','位置：');const offset=el('select');refs.offset=offset;
    for(const [value,name] of [['top','右上'],['below','右侧靠下']]){const o=el('option','',name);o.value=value;offset.append(o);}
    offset.onchange=()=>updatePrefs({offset:offset.value});offsetLabel.append(offset);details.append(offsetLabel);
    details.append(el('div','muted','仅显示本地缓存观察状态；不是服务器实时在线保证。'));
    shell.append(details);shadow.append(shell);document.documentElement.append(host);
  }
  async function updatePrefs(delta){if(!current)return;
    try{const res=await chrome.runtime.sendMessage({action:'OVERLAY_PREFS_SET',prefs:{...current.prefs,...delta}});
      if(res?.ok){current.prefs=res.prefs;render();}else{refs.detailsText.textContent='设置失败，稍后重试';}
    }catch{refs.detailsText.textContent='扩展后台暂时无响应';}
  }
  function render(){if(!current)return;build();if(!host)return;
    const {prefs={},openUrgent=0,newUnknown=0,groups=0,ambiguous=0,lastRead=0,guard}=current;
    const degraded=current.readOnly===true||guard?.mode==='READ_ONLY';
    const level=current.level||((openUrgent||newUnknown)?'alert':degraded?'readonly':'ok');
    const warning=level==='alert',attention=['readonly','review','stale','uninitialized'].includes(level);
    const shouldHide=prefs.mode==='hidden'||(prefs.mode==='alerts'&&!warning&&!attention);
    host.style.display=shouldHide?'none':'block';host.style.top=prefs.offset==='below'?'76px':'12px';
    refs.shell.classList.toggle('alert',warning);refs.shell.classList.toggle('stale',!warning&&attention);
    refs.title.textContent=warning?`⚠ 待核查 ${openUrgent} · 新身份 ${newUnknown}`:
      level==='readonly'?(guard?.readerDegraded===true?'◌ 缓存读取待恢复':`◉ 已读 ${groups} 群 · 只读守护`):
      level==='review'?`⚠ ${ambiguous} 群名单待核查`:
      level==='stale'?'◌ 巡检待恢复':
      level==='uninitialized'?'◌ 尚未建立巡检':`${groups} 群缓存观察`;
    refs.subtitle.textContent=warning?(degraded?'账号只读 · 历史待审事项':'存在未处理事项'):
      level==='readonly'?(guard?.readerDegraded===true?'插件正在自动重试，原名单已保护':'账号身份待确认，基线已保护'):
      level==='review'?'缓存名单变化，需人工核对':
      level==='stale'?'最近约 3 分钟未成功巡检（正在自动重试）':
      level==='uninitialized'?'请先打开 Teams 执行巡检':'未发现待处理异常';
    refs.detailsText.textContent=degraded?
      `只读保护：${guard?.reason||'未确认账号'}。当前观察 ${groups} 群，已对照旧基线 ${guard?.compared||0} 群；本轮新观察 ${guard?.observedAdded||0} 条变化（未存为正式事件）；未向持久基线写入。历史待审身份 ${newUnknown}，重要未处理 ${openUrgent}。`:
      `缓存群 ${groups} · 未处理高优先 ${openUrgent} · 未批准新身份 ${newUnknown} · 名单待核查 ${ambiguous}。最近巡检 ${lastRead?new Date(lastRead).toLocaleTimeString():'无记录'}。`;
    refs.mode.value=prefs.mode||'always';refs.compact.checked=prefs.compact!==false;refs.offset.value=prefs.offset==='below'?'below':'top';
    if(prefs.compact!==false&&!expanded){refs.subtitle.hidden=true;}else refs.subtitle.hidden=false;
    if(expanded)refs.details.hidden=false;
  }
  async function refresh(){if(pollInFlight)return;pollInFlight=true;
    try{const r=await chrome.runtime.sendMessage({action:'OVERLAY_STATUS'});if(r?.ok){current=r;render();}}
    catch{}finally{pollInFlight=false;}
  }
  chrome.runtime.onMessage.addListener(msg=>{if(msg?.action==='OVERLAY_REFRESH')refresh().catch(()=>{});});
  if(document.documentElement){build();refresh();}else document.addEventListener('DOMContentLoaded',()=>{build();refresh();},{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('focus',()=>refresh());
  setInterval(()=>{if(document.visibilityState==='visible')refresh();},20000);
})();
