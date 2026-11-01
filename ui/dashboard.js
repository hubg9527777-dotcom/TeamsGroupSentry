/* First-party dashboard: all member data stays in this local extension origin. */
(()=>{
  const D=globalThis.TGSDB,L=globalThis.TGSLogic,N=globalThis.TGSNames,GR=globalThis.TGSGroupReview,GH=globalThis.TGSGroupHistory,GD=globalThis.TGSGroupDirectory;
  const by=id=>document.getElementById(id);
  const route=new URLSearchParams(location.search);
  const initialPage=['overview','groups','people','relations','review','events','settings','requests'].includes(route.get('page'))?route.get('page'):'overview';
  const initialFilter=route.get('filter');
  const state={page:initialPage,
    account:'',meta:null,policy:null,groups:[],people:[],edges:[],events:[],groupQuery:'',personQuery:'',
    groupFilter:initialPage==='groups'&&['all','unmarked','left','critical','unnamed','uncertain','changed','recent','candidate_add','candidate_missing','quality','quiet','cache','cache_self','cache_absent_self','index_only'].includes(initialFilter)?initialFilter:'all',
    personFilter:(initialPage==='people'||initialPage==='review')&&['all','NEW','LEGACY','APPROVED','IGNORED','REVOKED'].includes(initialFilter)?initialFilter:'all',
    eventFilter:initialPage==='events'&&['urgent','info','open','all','ack'].includes(initialFilter)?initialFilter:'open',
    requestFilter:'pending',requestQuery:'',relationQuery:'',shown:90,historyDays:60,groupBulkMode:false,selected:new Set(),selectedEvents:new Set(),selectedGroups:new Set()};
  const node=(tag,cls='',txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined&&txt!==null)e.textContent=String(txt);return e;};
  const click=(txt,fn,cls='btn small')=>{const b=node('button',cls,txt);b.type='button';b.addEventListener('click',fn);return b;};
  const append=(parent,...children)=>{for(const c of children)if(c)parent.append(c);return parent;};
  const status=(m)=>['APPROVED','LEGACY','IGNORED','REVOKED','NEW'].includes(m?.status)?m.status:'LEGACY';
  const requestStatusLabel=value=>({UNOBSERVED:'首次观察，尚未核实',NEW:'新发现待审核',LEGACY:'历史待审核',APPROVED:'已审核可信',IGNORED:'已忽略，未核实',REVOKED:'已撤销信任',VERIFIED_ID:'已核实此 ID',CLOSED_WITHOUT_TRUST:'本地提醒已结束，未批准身份',KEEP_PENDING:'保持待核实'}[value]||'状态待核对');
  const stamp=ts=>ts?new Date(ts).toLocaleString():'无';
  const labelGroup=g=>L.groupLabel(g,state.peopleMap);
  const labelPerson=p=>p?.manualName||p?.name||(p?.id?'姓名尚未找到':'未知身份');
  const hasName=g=>!!(g.alias||g.title); // longTitle may only list people, not a real group topic
  // A yellow review marker covers two very different cases. Derive its cause
  // from the saved baseline and the latest candidate (when present), never from
  // an unverified Teams real-time membership claim. Legacy flags are supported.
  function rosterIssue(g){
    if(!g?.ambiguous)return null;
    const oldIds=Array.isArray(g.memberIds)?g.memberIds:[];
    const pending=Array.isArray(g.pendingRosterIds)&&g.pendingRosterIds.length?g.pendingRosterIds:null;
    if(pending){
      const previous=new Set(oldIds),candidate=new Set(pending);
      if(oldIds.some(id=>!candidate.has(id))||pending.some(id=>!previous.has(id)))return 'change';
    }
    const reason=String(g.ambiguousReason||'');
    if(!pending&&reason.includes('减少或替换'))return 'change';
    if(reason.includes('可信等级')||reason.includes('计数口径'))return 'quality';
    return 'unknown';
  }
  const rosterPriority=g=>({change:0,unknown:1,quality:2}[rosterIssue(g)]??3);
  const rosterLabel=g=>({change:'人员可能变化',quality:'名单读取有问题',unknown:'名单要核对'}[rosterIssue(g)]||'');
  const action=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok){const error=r?.error||'后台处理失败';
    if(error==='未知操作')throw new Error('浏览器仍在运行旧后台：请打开 chrome://extensions → 点本插件「重新加载」，然后刷新安全中心页面');
    throw new Error(error);}return r;};
  function toast(message){const el=by('toast');el.textContent=String(message);el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4000);}
  async function refresh(){
    state.meta=await D.getMeta('active');state.account=state.meta?.account||'';
    try{const summary=await chrome.runtime.sendMessage({action:'SUMMARY'});
      state.requestCoverage=summary?.requestCoverage||null;state.guard=summary?.guard||null;state.summaryLevel=summary?.status?.level||'';
      state.workerReady=summary?.featureBuild==='group-history-2026-11-01-r9';
    }catch{state.guard=null;state.summaryLevel='';state.workerReady=false;}
    // Do not expose a different account's old index as the presently observed user's data.
    if(state.guard?.mode==='READ_ONLY' && (!state.guard.account || state.guard.account!==state.account)){
      state.meta=null;state.account='';
    }
    if(state.account){const data=await Promise.all(['groups','people','edges','events'].map(s=>D.getAllFor(s,state.account)));
      [state.groups,state.people,state.edges,state.events]=data;state.policy=await D.getPolicy(state.account);
    }else{state.groups=[];state.people=[];state.edges=[];state.events=[];state.policy=L.validatePolicy({});}
    state.peopleMap=new Map(state.people.map(p=>[p.id,p]));state.groupsMap=new Map(state.groups.map(g=>[g.id,g]));
    state.groupEventsMap=new Map();for(const event of state.events){if(!event.groupId)continue;
      if(!state.groupEventsMap.has(event.groupId))state.groupEventsMap.set(event.groupId,[]);
      state.groupEventsMap.get(event.groupId).push(event);}
    for(const id of state.selectedGroups)if(!state.groupsMap.has(id))state.selectedGroups.delete(id);
    state.nameSuggestions=N.inferTitleSuggestions(state.groups,state.peopleMap);
    // A snapshot is updated only after a successfully completed scan. The
    // browser may still retain departed group chats in its IndexedDB cache.
    const snapshot=state.meta?.cacheSnapshot;
    state.cacheSnapshot=snapshot?.complete===true&&snapshot.account===state.account&&
      Array.isArray(snapshot.groupIds)&&Array.isArray(snapshot.rosterGroupIds)&&Array.isArray(snapshot.selfIncludedGroupIds)?snapshot:null;
    state.cacheIds=new Set(state.cacheSnapshot?.groupIds||[]);
    state.cacheRosterIds=new Set(state.cacheSnapshot?.rosterGroupIds||[]);
    state.cacheSelfIds=new Set(state.cacheSnapshot?.selfIncludedGroupIds||[]);
    const a=state.meta?.at;
    by('syncState').textContent=state.guard?.mode==='READ_ONLY'?`只读观察 ${state.guard.inspected||0} 群 · 已比对 ${state.guard.compared||0} 群`:a?`上次读取：${stamp(a)}`:'尚未建立人员索引';
    state.requests=state.events.filter(e=>e.type==='CONTACT_REQUEST');
    state.requestSummary=globalThis.TGSContactRisk.summary(state.events);
    by('requestCount').textContent=state.requestSummary.pending||'';
    const bad=state.events.filter(e=>e.type!=='CONTACT_REQUEST'&&e.status==='OPEN'&&['CRITICAL','HIGH','REVIEW'].includes(e.severity)).length;
    by('reviewCount').textContent=state.people.filter(p=>p.status==='NEW').length||'';
    const warning=by('systemWarning');
    if(state.guard?.mode==='READ_ONLY'){
      warning.textContent=`⚠ 当前仅能查看，不能更新记录：${state.guard.reason}。本次读取 ${state.guard.inspected||0} 群，与已有记录比对 ${state.guard.compared||0} 群。${state.guard.noBaseline?'尚未建立可用的群组记录，暂时不能可靠报警。':''}原有数据已保护。`; 
      if(state.guard.canBind){
        warning.append(' ');
        if(state.guard.firstSetup){
          const wrap=node('div','field');
          const suggestion=state.guard.selfSuggestion||{status:'NOT_FOUND',reason:'未找到明确的本人线索，请勿猜选。'};
          const recommended=suggestion.status==='CANDIDATE'?suggestion.personId:'';
          const needsSelfCheck=state.guard.smallSetup||!!recommended;
          const suggestionBox=node('div','notice warning-note');
          suggestionBox.append(node('strong','',recommended?'找到一个本人候选，请你确认':'尚未自动定位本人 ID'),
            node('p','',(recommended?(suggestion.name||'姓名尚未确认')+' · '+recommended+'。':'')+suggestion.reason));
          const retry=click('查找 / 刷新本人 ID',async()=>{retry.disabled=true;try{await action({action:'SCAN_NOW'});await refresh();}
            catch(e){toast(e.message);}finally{retry.disabled=false;}},'btn small');
          wrap.append(suggestionBox,retry);
          wrap.append(node('label','','首次建档：请先选择您本人的 Teams 成员 ID（不会自动猜测）'));
          const select=node('select','input');const placeholder=node('option','','— 请选择本人 ID —');placeholder.value='';select.append(placeholder);
          for(const candidate of state.guard.selfCandidates||[]){
            if(typeof candidate.id!=='string')continue;
            const opt=node('option','',`${candidate.nameConflict?'姓名冲突，待核实':candidate.name||'姓名尚未取得'} · ${candidate.count||0}/${state.guard.eligibleGroups||0} 群 · ${candidate.id.slice(-22)}`);
            opt.value=candidate.id;select.append(opt);
          }
          select.value=recommended||'';
          const typed=node('input','input');typed.type='text';typed.maxLength=480;
          typed.placeholder='或填写完整的 Teams 成员 ID（可选）';typed.autocomplete='off';
          const chosen=node('p','subtle',recommended||'尚未选择本人 ID');chosen.style.wordBreak='break-all';
          const updateChoice=()=>chosen.textContent=typed.value.trim()||select.value||'尚未选择本人 ID';
          typed.oninput=updateChoice;select.onchange=updateChoice;
          const suffix=node('input','input');suffix.maxLength=6;suffix.autocomplete='off';
          suffix.placeholder='核对完整本人 ID 后填写最后 6 位';suffix.setAttribute('aria-label','本人 ID 最后 6 位');
          if(state.guard.smallSetup)wrap.append(node('p','','少量群无法自动识别本人。姓名仅供参考，请核对完整 ID，勿选择其他群成员。'));
          const confirmBind=click('确认本人 ID，建立本地上次保存的名单',async()=>{
            try{const selfId=typed.value.trim()||select.value;
              if(!(state.guard.selfEvidenceIds||(state.guard.selfCandidates||[]).map(c=>c.id)).includes(selfId))throw new Error('请选择或填写本次已观察的完整本人 ID');
              if(needsSelfCheck&&suffix.value.trim()!==selfId.slice(-6))throw new Error('请核对完整本人 ID 并填写正确的最后 6 位');
              if(!confirm(`请确认您本人的 Teams 成员 ID：\n${selfId}\n\n确认后仅在当前 Chrome 用户资料建立初始上次保存的名单。这不等于微软服务器的身份认证。`))return;
              await action({action:'BIND_CURRENT',account:state.guard.account,selfId,
                ...(needsSelfCheck?{last6:suffix.value.trim(),selfConfirmed:true}:{}),...(state.guard.smallSetup?{smallConfirmed:true}:{})});
              await action({action:'SCAN_NOW'});await refresh();toast('本人 ID 已确认，初始上次保存的名单已建立');
            }catch(e){toast(e.message);}
          },'btn small primary');
          const manual=node('details','');manual.append(node('summary','','手动核对候选（可选，请勿猜选）'),select,typed);
          append(wrap,manual,chosen);if(needsSelfCheck)wrap.append(suffix);
          wrap.append(confirmBind);warning.append(wrap);
        }else warning.append(click('确认绑定当前账号，并再次检查',async()=>{
          try{if(!confirm('请确认您正在使用正确的 Teams 账号。此操作不自动合并其他账号的人员数据。'))return;
            await action({action:'BIND_CURRENT',account:state.guard.account});
            await action({action:'SCAN_NOW'});await refresh();toast('账号已绑定，正在重新检查');}
          catch(e){toast(e.message);}
        },'btn small primary'));
      }
    }
    else if(!a)warning.textContent='请保持 Teams 个人版网页打开，点击「立即检查」以建立本地观察上次保存的名单。';
    else if(state.summaryLevel==='stale'||(!state.summaryLevel&&Date.now()-a>3*60*1000))
      warning.textContent='最近约3分钟未完成检查，可能是 Teams 页面休眠或缓存暂时不可用。插件会自动重试。';
    else if(state.groups.some(g=>g.ambiguous))warning.textContent=`⚠ 有 ${state.groups.filter(g=>g.ambiguous).length} 个群名单待核查：请到群组中心核实缓存变化，不要将其直接当作有人退群。`;
    else if(!state.meta.verified)warning.textContent='当前 Teams 账号尚未确认。为保护原有记录，暂时不会更新成员名单。';
    else warning.textContent='本页只依据 Teams 本地缓存观察变动。群组缓存数不等于服务器实时名单；无法保证未打开群的更新速度。';
    warning.classList.add('show');
    render();
  }
  function switchPage(page){state.page=page;state.shown=90;state.selected.clear();state.selectedGroups.clear();
    document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.page===page));
    history.replaceState({},'',`dashboard.html?page=${encodeURIComponent(page)}`);render();}
  function heading(title,description){const h=node('div','sectionhead'),left=node('div');append(left,node('h2','',title),node('p','',description));h.append(left);return h;}
  function boxStat(name,value,cls='',navigate){const e=node('button','stat '+cls);e.type='button';e.setAttribute('aria-label',`${name} ${value}，点击查看对应明细`);
    append(e,node('span','',name),node('strong','',value),node('span','statgo','查看明细 →'));
    if(navigate)e.addEventListener('click',navigate);return e;}
  function navigate(page,filter='all'){
    state.shown=90;
    if(page==='groups'){state.groupFilter=filter;state.groupQuery='';state.selectedGroups.clear();}
    if(page==='people'){state.personFilter=filter;state.personQuery='';}
    if(page==='review'){state.personFilter=filter==='LEGACY'?'LEGACY':'NEW';}
    if(page==='events')state.eventFilter=['urgent','info','open','all','ack'].includes(filter)?filter:'open';
    if(page==='relations')state.relationQuery='';
    switchPage(page);
  }
  function counts(){const left=state.groups.filter(g=>g.membershipStatus==='LEFT').length;
    return {groups:state.groups.length,tracked:state.groups.length-left,left,
      autoLeft:state.groups.filter(g=>g.membershipStatus==='LEFT'&&g.membershipMethod==='TEAMS_UI_OBSERVED').length,
      people:state.people.length,edges:state.edges.length,
    urgent:state.events.filter(e=>e.type!=='CONTACT_REQUEST'&&e.status==='OPEN'&&['CRITICAL','HIGH','REVIEW'].includes(e.severity)).length,
    info:state.events.filter(e=>e.status==='OPEN'&&e.severity==='INFO').length,
    legacy:state.people.filter(p=>p.status==='LEGACY').length,new:state.people.filter(p=>p.status==='NEW').length,named:state.people.filter(p=>p.name||p.manualName).length,
    reviewed:state.people.filter(p=>p.status==='APPROVED').length,
    critical:state.groups.filter(g=>g.level==='CRITICAL').length,
    unnamed:state.groups.filter(g=>!hasName(g)).length,
    open:state.events.filter(e=>e.type!=='CONTACT_REQUEST'&&e.status==='OPEN').length,
    uncertain:state.groups.filter(g=>g.ambiguous).length};}
  function render(){const main=by('main');main.replaceChildren();
    ({overview:showOverview,groups:showGroups,people:showPeople,relations:showRelations,review:showReview,events:showEvents,requests:showRequests,settings:showSettings}[state.page]||showOverview)(main);
  }
  function showOverview(main){const n=counts();
    if(state.guard?.mode==='READ_ONLY'){
      const note=node('section','panel');
      note.append(node('h3','','当前为只读观察，未必具有正式索引'));
      note.append(node('p','',`本次从 Teams 缓存读取 ${state.guard.inspected||0} 群；其中 ${state.guard.compared||0} 群与已有上次保存的名单比较。下面统计卡片只计已经存入此账号上次保存的名单的数据，没有绑定时显示 0 并非群组读取失败。`));
      if(state.guard.canBind){note.append(node('p','',state.guard.firstSetup?'请在上方选定本人 Teams 成员 ID，并确认一次后建立初始上次保存的名单。':'请使用上方的“确认绑定当前账号”后重新检查。'));}
      main.append(note);
    }
    main.append(heading('安全首页','先处理提醒，再查看群组和人员。所有数据仅来自本地缓存，不是 Teams 服务器的实时名单。'));
    // Put tasks first; historic diagnostics must not bury actionable reviews.
    const pending=node('section','panel work-first');pending.append(node('h3','','需要处理'));
    const todo=node('div','statgrid');
    if(state.requestSummary.pending)todo.append(boxStat(state.requestSummary.headline,state.requestSummary.pending,'red',()=>switchPage('requests')));
    append(todo,
      boxStat('新人员待审核',n.new,'red',()=>navigate('review','NEW')),
      boxStat('需要核对的群',n.uncertain,'yellow',()=>navigate('groups','uncertain')),
      boxStat('重要事件',n.urgent,'red',()=>navigate('events','urgent')),
      boxStat('普通变动',n.info,'blue',()=>navigate('events','info')));
    pending.append(todo);
    pending.append(node('p','subtle',n.new||n.uncertain||n.urgent||n.info?
      '点击数字可直接处理。普通变动不代表危险；名单变化需要在 Teams 中核实。':
      '目前没有待处理的本地提醒。仍应以 Teams 实际成员为准。'));
    main.append(pending);
    main.append(node('h3','overview-subhead','群组统计（保留完整历史）'));
    main.append(node('p','subtle','未标记退群是本地历史群减去人工确认和 Teams 操作观察到的退出数量，并不是 Microsoft Teams 服务器核实的实时在群数。'));
    const stats=node('div','statgrid');append(stats,
      boxStat('未标记退群',n.tracked,'blue',()=>navigate('groups','unmarked')),
      boxStat('已记录退出（含自动）',n.left,'',()=>navigate('groups','left')),
      boxStat('全部历史群组',n.groups,'',()=>navigate('groups')),
      boxStat('已记录人员',n.people,'blue',()=>navigate('people')),
      boxStat('群与人员关系',n.edges,'',()=>navigate('relations')),
      boxStat('待命名群组',n.unnamed,'',()=>navigate('groups','unnamed')));
    main.append(stats);
    const snapshot=state.cacheSnapshot;
    const cacheCount=state.groups.filter(g=>['cache','cache_unreadable','cache_self','cache_absent_self'].includes(sourceStatus(g))).length;
    const historyOnly=state.groups.filter(g=>sourceStatus(g)==='index_only').length;
    const includesSelf=state.groups.filter(g=>sourceStatus(g)==='cache_self').length;
    const excludesSelf=state.groups.filter(g=>sourceStatus(g)==='cache_absent_self').length;
    const groupSource=node('section','panel');
    append(groupSource,node('h3','','这些群还在 Teams 缓存里吗？'),
      node('p','',snapshot?
        `最近检查：${stamp(snapshot.at)}。共记录 ${n.groups} 群，其中 Teams 缓存还能找到 ${cacheCount} 群，只剩历史记录 ${historyOnly} 群。`:
        '还没有完整的缓存检查结果。请先点击右上角「立即检查」。'));
    if(snapshot){
      const sourceCards=node('div','cardgrid');
      append(sourceCards,
        boxStat('Teams 缓存中有记录',cacheCount,'blue',()=>navigate('groups','cache')),
        boxStat('只剩历史记录',historyOnly,'',()=>navigate('groups','index_only')));
      if(snapshot.selfConfirmed){
        append(sourceCards,boxStat('名单包含本人 ID',includesSelf,'',()=>navigate('groups','cache_self')),
          boxStat('名单未见本人 ID',excludesSelf,'',()=>navigate('groups','cache_absent_self')));
      }else append(groupSource,node('p','',
        '尚未确认您的 Teams 成员 ID，暂时不能判断名单中有没有您本人。'));
      groupSource.append(sourceCards);
    }
    groupSource.append(node('p','subtle',
      '仍在 Teams 缓存 ≠ 仍在群中；仅插件历史索引 ≠ 已真实退群。这里仅用于核对来源，不会自动删除记录。'));
    main.append(groupSource);
    const coverage=node('section','panel');coverage.append(node('h3','','姓名和群名完善情况'));
    coverage.append(node('p','',`已保存姓名或备注 ${n.named}/${n.people} 人；还有 ${n.unnamed} 个群需要命名。姓名线索需核对后才能确认。`));main.append(coverage);
    const duo=node('div','cardgrid');
    const g=node('section','panel');append(g,node('h3','','给群组起个容易认的名字'),node('p','',`有 ${n.unnamed} 个群还没有清楚的名称。可用人员姓名或群 ID 搜索，再保存备注名。`),
      click('查看未命名群 →',()=>{state.groupFilter='unnamed';switchPage('groups');},'btn primary'));
    const p=node('section','panel');append(p,node('h3','','审核新人员'),node('p','',`有 ${n.new} 位新人员待审核，另有 ${n.legacy} 位历史人员尚未审核。`),
      click('打开审核中心 →',()=>switchPage('review'),'btn primary'));
    duo.append(g,p);main.append(duo);
    const expl=node('section','panel');append(expl,node('h3','','检查说明'),node('p','',
      `插件会自动检查 Teams 缓存。最近检查：${stamp(state.meta?.at)}；上次处理 ${state.meta?.stats?.groupsProcessed||0} 群。`));
    expl.append(node('div','notice warning-note',
      '提醒只代表本地缓存发生变化，不能证明谁加入、退出或何时操作。'));
    main.append(expl);
  }
  function sourceStatus(g){
    if(!state.cacheSnapshot)return 'unverified';
    if(!state.cacheIds.has(g.id))return 'index_only';
    if(!state.cacheRosterIds.has(g.id))return 'cache_unreadable';
    if(!state.cacheSnapshot.selfConfirmed)return 'cache';
    return state.cacheSelfIds.has(g.id)?'cache_self':'cache_absent_self';
  }
  function sourceLabel(g){return ({unverified:'来源未核对 · 请先完整检查',index_only:'只剩插件历史记录 · 最新 Teams 缓存未找到',
    cache:'Teams 缓存有此群 · 本人 ID 尚未确认',
    cache_unreadable:'Teams 缓存有此群 · 暂时读不到成员名单',
    cache_self:'缓存名单含本人 ID · 不代表目前仍在群中',
    cache_absent_self:'缓存名单未见本人 ID · 请核对是否已退出'})[sourceStatus(g)];}
  function groupMatched(g,q){if(!q)return true;const text=[g.alias,g.title,g.longTitle,g.id,
    ...[...(g.memberIds||[]),...(g.pendingRosterIds||[])].flatMap(id=>{const p=state.peopleMap.get(id);return [id,p?.name,p?.manualName,state.nameSuggestions?.get(id)?.name];})].join(' ').toLowerCase();return text.includes(q);}
  const groupDiff=g=>GR.fromGroup(g,state.groupEventsMap?.get(g.id)||[]);
  const historyFor=g=>GH.entries(g.id,state.groupEventsMap?.get(g.id)||[]);

  function groupListFiltered(){let list=state.groups.filter(g=>{
    if(state.groupFilter==='unmarked'&&g.membershipStatus==='LEFT')return false;
    if(state.groupFilter==='left'&&g.membershipStatus!=='LEFT')return false;
    if(state.groupFilter==='critical'&&g.level!=='CRITICAL')return false;
    if(state.groupFilter==='unnamed'&&hasName(g))return false;
    if(state.groupFilter==='uncertain'&&!g.ambiguous)return false;
    if(state.groupFilter==='changed'&&rosterIssue(g)!=='change')return false;
    if(state.groupFilter==='recent'&&!GH.summary(historyFor(g),60).changes)return false;
    if(state.groupFilter==='candidate_add'&&(!g.ambiguous||g.membershipStatus==='LEFT'||!groupDiff(g).added.length))return false;
    if(state.groupFilter==='candidate_missing'&&(!g.ambiguous||g.membershipStatus==='LEFT'||!groupDiff(g).missing.length))return false;
    if(state.groupFilter==='quality'&&rosterIssue(g)!=='quality')return false;
    if(state.groupFilter==='quiet'&&g.level!=='QUIET')return false;
    const src=sourceStatus(g);
    if(state.groupFilter==='cache'&&!['cache','cache_unreadable','cache_self','cache_absent_self'].includes(src))return false;
    if(['cache_self','cache_absent_self','index_only'].includes(state.groupFilter)&&src!==state.groupFilter)return false;
    return groupMatched(g,state.groupQuery.trim().toLowerCase());
  });return list.sort((a,b)=>{
    // Group names, not alert severity, determine the default directory order.
    // With a search query, exact/prefix group-name matches appear before IDs or
    // member-name matches (which remain searchable as a fallback).
    const q=state.groupQuery.trim().toLocaleLowerCase();
    if(q){
      const rank=g=>{const name=labelGroup(g).toLocaleLowerCase();
        return name===q?0:name.startsWith(q)?1:name.includes(q)?2:3;};
      const score=rank(a)-rank(b);if(score)return score;
    }
    if(state.groupFilter==='recent'){
      const difference=(historyFor(b)[0]?.at||0)-(historyFor(a)[0]?.at||0);
      if(difference)return difference;
    }
    return labelGroup(a).localeCompare(labelGroup(b),'zh')||a.id.localeCompare(b.id);
  });}
  function showGroups(main){
    main.append(heading('群组管理', `搜索群名，直接查看近60天人员变化 · 共 ${state.groups.length} 群`));
    const finder=node('section','group-finder');
    const prompt=node('label','group-search-label','查找哪个群？');
    const bar=node('div','toolbar group-finder-bar');const input=node('input','input search group-name-search');
    input.type='search';input.id='groupNameSearch';prompt.htmlFor=input.id;
    input.placeholder='搜索群名、姓名或 ID';input.value=state.groupQuery;
    input.setAttribute('aria-label','按群名搜索');
    const reset=click('清空搜索',()=>{input.value='';state.groupQuery='';state.shown=90;state.selectedGroups.clear();renderGroupList(list);input.focus();},'btn small');
    const select=node('select','input group-finder-filter');
    for(const [v,t] of [['all','全部群聊'],['recent','近60天有变化'],['unmarked','未标记退群'],['left','已标记退群'],
      ['uncertain','需要核对名单'],['candidate_add','新名单多出人员'],['candidate_missing','新名单少了人员'],
      ['changed','人员可能有变化'],['quality','名单读取有问题'],['critical','重要提醒'],
      ['unnamed','待命名'],['quiet','减少提醒'],['cache','Teams 缓存还有记录'],
      ['cache_self','名单包含本人 ID'],['cache_absent_self','名单未见本人 ID'],['index_only','只剩历史记录']]){
      const opt=node('option','',t);opt.value=v;select.append(opt);
    }
    select.value=state.groupFilter;select.setAttribute('aria-label','筛选群聊');
    const list=node('div');
    input.addEventListener('input',()=>{state.groupQuery=input.value;state.shown=90;state.selectedGroups.clear();renderGroupList(list);});
    select.addEventListener('change',()=>{state.groupFilter=select.value;state.shown=90;state.selectedGroups.clear();renderGroupList(list);});
    append(bar,input,reset,select);finder.append(prompt,bar);
    main.append(finder);
    const controls=node('div','group-directory-controls');
    const period=node('span','group-directory-count','近60天 · 按群名排列');
    const batchToggle=click('批量处理群聊',()=>{
      state.groupBulkMode=!state.groupBulkMode;
      state.selectedGroups.clear();batchToggle.textContent=state.groupBulkMode?'完成批量处理':'批量处理群聊';
      renderGroupList(list);
    },'btn small');
    controls.append(period,batchToggle);main.append(controls);
    const details=node('details','group-extra-filters'),summary=node('summary','','ⓘ 数据说明');
    details.append(summary,node('p','subtle',
      '此处的「新增」和「减少」是 Teams 本地名单的变化。日期为插件发现时间，不代表人员实际进群或退群时间。请在 Teams 中核实；原始记录和完整 ID 可在群详情查看。'));
    main.append(details);
    if(!state.workerReady)main.append(node('div','notice warning-note','插件页面和后台没有同步。请打开 chrome://extensions，点击本插件「重新加载」，再刷新此页。否则新按钮可能无法保存。'));
    main.append(list);renderGroupList(list);
  }
  // A user who already left a Teams group cannot reopen its actual member
  // list. Give the expired-list case an EXPLICIT route, with only one dialog.
  // This declaration is not inferred from cache: the user must confirm it.
  async function finishExitedAlerts(ids,button,holder){
    const groups=[...new Set(ids)].map(id=>state.groupsMap.get(id)).filter(g=>g?.ambiguous);
    if(!groups.length)return toast('请先选择还有黄色提醒的群');
    if(groups.length>100)return toast('一次最多处理 100 群，请减少选择');
    if(state.guard?.mode==='READ_ONLY')return toast('账号正在保护中，请先确认当前 Teams 账号');
    if(!state.workerReady)return toast('请在 chrome://extensions 重新加载插件，再刷新安全中心');
    const newlyLeft=groups.filter(g=>g.membershipStatus!=='LEFT').length;
    const names=groups.slice(0,8).map(g=>`• ${labelGroup(g)}（群 ID 尾号 ${g.id.slice(-12)}）`).join('\n');
    if(!confirm(`请确认：你本人已经在 Teams 退出以下 ${groups.length} 个群。\n\n${names}${groups.length>8?'\n……其余已选群也会一起处理':''}\n\n确定后：${newlyLeft} 群将记为你已退出，并关闭这些群的旧黄色名单提醒。\n不会更新旧成员名单、批准陌生人或删除历史。\n如果你并未退出其中某个群，请点取消。`))return;
    button.disabled=true;
    try{
      const result=await action({action:'BULK_GROUP',ids:groups.map(g=>g.id),kind:'membership',value:'LEFT',confirmed:true});
      state.selectedGroups.clear();await refresh();
      if(holder)renderGroupList(holder);
      else if(groups.length===1)openGroup(groups[0].id);
      toast(`已完成：记录退出 ${result.changed||0} 群，关闭旧黄色提醒 ${result.alertsClosed||0} 群。旧名单和历史保留。`);
    }catch(e){button.disabled=false;toast('未完成：'+e.message);}
  }
  // Two actions only: tick group rows, then click this button and confirm once.
  // Differences are visible on the rows; no drawer, extra checkbox or third OK.
  async function confirmSelectedRoster(holder,button){
    const chosen=[...state.selectedGroups].map(id=>state.groupsMap.get(id)).filter(g=>g?.ambiguous);
    if(!chosen.length)return toast('请先勾选有黄色提醒的群');
    if(chosen.length>100)return toast('一次最多确认 100 群，请缩小选择范围');
    if(state.guard?.mode!=='WRITE')return toast('当前账号处于只读状态，请先确认 Teams 登录账号');
    if(!state.workerReady)return toast('插件后台文件未同步。请在 chrome://extensions 点击「重新加载」，再刷新此页面');
    const now=Date.now(),left=chosen.filter(g=>g.membershipStatus==='LEFT');
    const current=chosen.filter(g=>g.membershipStatus!=='LEFT');
    const fresh=g=>Array.isArray(g.pendingRosterIds)&&g.pendingRosterIds.length>0&&
      typeof g.pendingRevision==='string'&&g.pendingRevision.length>0&&
      Number.isFinite(g.pendingSnapshotAt)&&now-g.pendingSnapshotAt<=180000&&g.pendingSnapshotAt<=now+30000;
    const stale=current.filter(g=>!fresh(g));
    if(stale.length)return toast(`有 ${stale.length} 群没有可确认的新名单。仍在群内请先点「立即检查」；你若已退群，请点「我已退群，关闭提醒」，无需重读。`);
    const details=chosen.slice(0,12).map(g=>{
      if(g.membershipStatus==='LEFT')return '• '+labelGroup(g)+'：本人已退群，只清除黄色提醒（不更新成员）';
      const old=new Set(g.memberIds||[]),next=new Set(g.pendingRosterIds||[]);
      const plus=g.pendingRosterIds.filter(id=>!old.has(id)).length;
      const minus=(g.memberIds||[]).filter(id=>!next.has(id)).length;
      return '• '+labelGroup(g)+`：多 ${plus} 人，少 ${minus} 人`;
    }).join('\n');
    const promptText=`确认处理这 ${chosen.length} 个群吗？\n\n${details}${chosen.length>12?`\n……还有 ${chosen.length-12} 群`:''}\n\n仍在群内的 ${current.length} 群：请先在 Teams 对照过实际成员，确认后保存名单。\n已退出的 ${left.length} 群：只清除旧黄色提醒，保留成员和历史。\n不会自动把陌生人设为可信。`;
    if(!confirm(promptText))return;
    button.disabled=true;
    try{
      const r=await action({action:'BULK_CONFIRM_ROSTER',confirmed:true,
        items:chosen.map(g=>({id:g.id,revision:g.membershipStatus==='LEFT'?'':g.pendingRevision}))});
      state.selectedGroups.clear();await refresh();renderGroupList(holder);
      toast(`已处理 ${r.changed} 群：保存名单 ${r.changed-(r.archived||0)} 群，清除已退群提醒 ${r.archived||0} 群`);
    }catch(e){button.disabled=false;toast('未完成：'+e.message);}
  }
  function renderGroupList(holder){
    holder.replaceChildren();const all=groupListFiltered(),visible=all.slice(0,state.shown);
    const selected=state.selectedGroups;
    const eligible=new Set(all.map(g=>g.id));for(const id of selected)if(!eligible.has(id))selected.delete(id);
    if(state.groupBulkMode){
    const toolbar=node('section','panel group-bulk');
    const header=node('div','group-bulk-heading');
    const total=node('strong','',`找到 ${all.length} 群 · 显示 ${visible.length} 群 · 已勾选 ${selected.size} 群`);
    const label=node('label','checks');const master=node('input');master.type='checkbox';
    master.disabled=!all.length||all.length>500;master.checked=all.length>0&&all.every(g=>selected.has(g.id));
    master.indeterminate=selected.size>0&&!master.checked;
    master.setAttribute('aria-label','全选当前筛选结果');
    master.addEventListener('change',()=>{selected.clear();if(master.checked)for(const g of all)selected.add(g.id);renderGroupList(holder);});
    label.append(master,node('span','','全选筛选出的群（包含下方尚未显示的群）'));
    header.append(total,label);toolbar.append(header);
    if(all.length>500)toolbar.append(node('small','subtle','一次最多操作 500 群，请进一步搜索或筛选。'));
    const actions=node('div','group-bulk-actions');
    const makeAction=(text,kind,value,cls='btn small')=>{const button=click(text,async()=>{
      const ids=[...selected];if(!ids.length)return toast('请先勾选要处理的群');
      const rows=ids.map(id=>state.groupsMap.get(id)).filter(Boolean);
      const changes=kind==='level'?rows.filter(g=>g.level!==value):rows.filter(g=>(g.membershipStatus==='LEFT'?'LEFT':'UNMARKED')!==value);
      if(!changes.length)return toast('所选群已经处于该状态，无需重复操作');
      const target=kind==='level'?{CRITICAL:'重要提醒',STANDARD:'正常提醒',QUIET:'减少提醒'}[value]:value==='LEFT'?'标记本人已退出':'撤销退群标记';
      let confirmed=false;
      if(kind==='membership'){
        if(!confirm(`你必须在 Teams 中逐一核对这 ${changes.length} 个群。\n\n${value==='LEFT'?'仅对你确实已经退出的群使用，不能仅凭缓存没有本人 ID 判断退群。':'仅对你已重新加入或确实需要撤销历史标记的群使用。'}\n\n此操作保留历史。标记退出会关闭该群旧的黄色名单提醒，不会自动批准陌生人。继续吗？`))return;
        const typed=prompt(`为防止把 ${changes.length} 个群误操作，请输入「${value==='LEFT'?'确认已退群':'确认撤销'}」：`);
        if(typed!==(value==='LEFT'?'确认已退群':'确认撤销'))return toast('未完成二次确认，未修改任何群');
        confirmed=true;
      }else{if(!confirm(`将当前勾选的 ${changes.length} 个群批量设为「${target}」？\n仅更改监控级别，不影响成员身份信任、群组历史和名单核查。`))return;
        if(value==='QUIET'&&changes.some(g=>g.level==='CRITICAL')&&!confirm('注意：所选群中包含重点守护群。改为安静记录会降低通知优先级。你仍确定要更改吗？'))return;}
      button.disabled=true;
      try{const result=await action({action:'BULK_GROUP',ids,kind,value,confirmed});
        selected.clear();await refresh();renderGroupList(holder);
        toast(`批量操作完成：更新 ${result.changed} 群，状态未变化 ${result.unchanged} 群`);
      }catch(e){button.disabled=false;toast('批量处理失败：'+e.message);}
    },cls);button.disabled=selected.size===0;actions.append(button);};
    const reviewSelected=selected.size>0?[...selected].map(id=>state.groupsMap.get(id)).filter(g=>g?.ambiguous):[];
    const bulkReview=click(`确认所选名单（${reviewSelected.length} 群）`,()=>confirmSelectedRoster(holder,bulkReview),'btn small primary');
    bulkReview.disabled=!reviewSelected.length;actions.append(bulkReview);
    const exitYellow=click(`我已退群，关闭提醒（${reviewSelected.length} 群）`,()=>finishExitedAlerts(reviewSelected.map(g=>g.id),exitYellow,holder),'btn small danger');
    exitYellow.disabled=!reviewSelected.length;actions.append(exitYellow);
    makeAction('设为重要提醒','level','CRITICAL');
    makeAction('设为正常提醒','level','STANDARD');
    makeAction('改为减少提醒','level','QUIET');
    makeAction('标记我已退群','membership','LEFT','btn small danger');
    makeAction('撤销退群记录','membership','UNMARKED');
    actions.append(click('清除勾选',()=>{selected.clear();renderGroupList(holder);},'btn small'));
    toolbar.append(actions);
    toolbar.append(node('small','subtle','还在群里：核对实际成员后点「确认所选名单」。已经退群：点「我已退群，关闭提醒」，只需一次确认；不必重新读取无法访问的群。'));
    holder.append(toolbar);
    }
    if(!state.groupBulkMode)holder.append(node('div','group-results-heading',`找到 ${all.length} 群 · 显示 ${visible.length} 群`));
    if(!all.length){holder.append(node('div','empty','没有找到符合条件的群。可以清空搜索或更换筛选条件。'));return;}
    const rows=node('div','list group-list');
    const briefTime=at=>new Date(at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
    for(const g of visible){
      const history=historyFor(g),recent=GH.summary(history,60),pending=groupDiff(g);
      const changes=GD.preview(history,60,Date.now(),g.membershipStatus==='LEFT'?null:pending);
      const item=node('article','listitem group-item'+(selected.has(g.id)?' selected':''));
      const check=node('input','group-checkbox');check.type='checkbox';check.checked=selected.has(g.id);
      check.setAttribute('aria-label',`选择群组 ${labelGroup(g)}`);
      check.addEventListener('change',()=>{if(check.checked)selected.add(g.id);else selected.delete(g.id);renderGroupList(holder);});
      const info=node('div','grow group-info');const top=node('div','group-titleline');
      top.append(click(labelGroup(g),()=>openGroup(g.id,true),'itemtitle group-title group-title-link'));
      if(g.membershipStatus==='LEFT')top.append(node('span','badge quiet','我已退出'));
      if(g.ambiguous)top.append(node('span','badge '+(rosterIssue(g)==='quality'?'quality':'warn'),g.membershipStatus==='LEFT'?'旧提醒':rosterLabel(g)));
      else if(g.level==='CRITICAL')top.append(node('span','badge critical','重点关注'));
      info.append(top);
      const counts=node('div','group-change-totals');
      counts.append(node('span','group-total added',`＋ ${changes.added.length} 新增`),node('span','group-total missing',`− ${changes.missing.length} 减少`));
      const hasChanges=changes.added.length>0||changes.missing.length>0;
      if(hasChanges)info.append(counts);
      const columns=node('div','group-snapshot-grid');
      for(const [kind,title,items] of [['added','新增人员',changes.added],['missing','减少人员',changes.missing]]){
        const section=node('section','group-snapshot '+kind);
        section.append(node('h4','group-snapshot-heading',title));
        if(!items.length)section.append(node('div','group-snapshot-empty','暂无记录'));
        else {
          const list=node('div','group-snapshot-people');
          for(const personEvent of items.slice(0,3)){
            const person=state.peopleMap.get(personEvent.id);
            const name=person?.manualName||person?.name||personEvent.nameSnapshot||'姓名未匹配';
            const line=node('div','group-snapshot-person');
            const span=node('span','group-snapshot-name',name);span.title=personEvent.id;
            const when=node('time','group-snapshot-time',briefTime(personEvent.at));
            when.dateTime=new Date(personEvent.at).toISOString();when.title=`插件发现：${stamp(personEvent.at)}`;
            line.append(span,when);if(personEvent.kind==='pending')line.append(node('span','group-pending-label','待核对'));list.append(line);
          }
          section.append(list);
          if(items.length>3)section.append(click(`另有 ${items.length-3} 条 · 查看全部`,()=>openGroup(g.id,true),'group-inline-more'));
        }
        columns.append(section);
      }
      if(hasChanges)info.append(columns);
      else info.append(node('div','group-snapshot-quiet','近60天没有新增或减少记录'));
      // Secondary information is available in one place, not repeated on every card.
      const extra=node('details','group-technical');extra.append(node('summary','','更多信息与操作'));
      extra.append(node('div','group-meta',`群 ID：${g.id}`),
        node('div','group-meta',`保存名单：${g.memberIds?.length||0} 人 · 最近检查：${stamp(g.lastObservedAt)}`),
        node('div','group-meta',sourceLabel(g)));
      if(!recent.changes)extra.append(node('div','group-meta','近60天没有保存的增减记录。'));
      const secondary=node('div','group-secondary-actions');
      secondary.append(click('查看/改群名',()=>openGroup(g.id),'btn small'));
      if(g.ambiguous)secondary.append(click('核对名单',()=>openGroup(g.id),'btn small'));
      extra.append(secondary);info.append(extra);
      const tools=node('div','group-row-actions');
      tools.append(click('查看完整记录',()=>openGroup(g.id,true),'btn small primary'));
      tools.append(click('打开聊天',()=>openTeamsChat('group',g.id),'btn small'));
      if(g.ambiguous){
        const leaveButton=click(g.membershipStatus==='LEFT'?'关闭旧提醒':'我已退群，关提醒',
          ()=>finishExitedAlerts([g.id],leaveButton,holder),'btn small danger');
        tools.append(leaveButton);
      }
      if(state.groupBulkMode)item.append(check);
      item.append(info,tools);rows.append(item);
    }
    holder.append(rows);
    if(all.length>state.shown){const wrap=node('div','more');wrap.append(click(`继续显示 ${Math.min(100,all.length-state.shown)} 群`,()=>{state.shown+=100;renderGroupList(holder);},'btn'));holder.append(wrap);}
  }
  async function edit(payload,after){
    try{await action({action:'EDIT',...payload});await refresh();if(after)after();toast('本地设置已保存');}
    catch(e){
      // Never leave an optimistic dropdown/checkbox checked after a failed write.
      try{await refresh();if(after)after();}catch{}
      toast('保存失败：'+e.message);
    }
  }
  function closeDetail(){by('detail').classList.add('hidden');by('detailBody').replaceChildren();}
  function openDetail(title){by('detailTitle').textContent=title;by('detailBody').replaceChildren();by('detail').classList.remove('hidden');return by('detailBody');}
  async function openTeamsChat(kind,id,chatId='',searchQuery=''){
    try{
      // A verified person can have more than one historical 1:1 session.
      // Present choices instead of selecting a different chat silently.
      const r=await chrome.runtime.sendMessage({action:'NAVIGATE_CHAT',kind,id,
        ...(chatId?{chatId}:{}),...(searchQuery?{searchQuery}:{})});
      if(r?.ok){toast(r.assisted?'已在 Teams 打开搜索，请核对结果后选择聊天；没有自动进入或新建聊天':'已在 Teams 打开聊天');return;}
      if(kind==='person'&&r?.code==='AMBIGUOUS_CHAT'&&Array.isArray(r.chatIds)&&
         r.chatIds.length>1){
        const choices=[...new Set(r.chatIds)].filter(L.threadId).slice(0,12);
        if(choices.length>1){
          const panel=openDetail('选择这个人的聊天');
          panel.append(node('div','notice',`找到 ${choices.length} 条已有个人聊天记录。请选择要打开的一条；不会新建聊天或发送消息。`));
          choices.forEach((candidate,index)=>{
            const row=node('div','detailrecord');
            append(row,node('div','','聊天记录 '+(index+1)),
              node('small','subtle','会话 ID：'+L.shortId(candidate)),
              click('打开这条聊天',()=>openTeamsChat(kind,id,candidate),'btn small'));
            panel.append(row);
          });
          return;
        }
      }
      if(kind==='person'&&r?.code==='NO_SEARCH_NAME'&&!searchQuery){
        const panel=openDetail('搜索这个人的聊天');
        panel.append(node('div','notice','当前缓存没有可靠的姓名。请填写 Teams 里显示的姓名，只用于搜索；请自行核对搜索结果，插件不会按姓名自动打开陌生会话。'));
        const field=node('div','field'),input=node('input','input');
        input.placeholder='输入 Teams 中显示的人员姓名';input.maxLength=100;
        field.append(input,click('在 Teams 搜索',()=>{
          const name=input.value.trim();
          if(name.length<2){toast('请输入至少两个字的姓名');return;}
          openTeamsChat(kind,id,'',name);
        },'btn primary small'));panel.append(field);return;
      }
      toast(r?.error||'聊天暂时无法打开');
    }catch(e){toast(e?.message||'聊天跳转失败');}
  }
  function renderGroupHistory(g){
    const history=historyFor(g),panel=node('section','group-history-panel detailrecord');
    panel.append(node('h3','','这个群的人员变化记录'));
    const timeHelp=node('details','group-extra-filters');timeHelp.append(node('summary','','ⓘ 日期说明'),node('p','subtle','这里显示插件发现名单变化的时间，不能作为实际进退群时间或邀请人的证明。'));panel.append(timeHelp);
    if(g.firstSeen)panel.append(node('div','group-history-firstseen',`首次在插件中记录此群：${stamp(g.firstSeen)}（不是建群日期）`));
    const toolbar=node('div','group-history-filters');
    const select=node('select','input');select.setAttribute('aria-label','查看多长时间的人员变化');
    for(const [days,label] of [[7,'最近7天'],[30,'最近30天'],[60,'最近60天'],[90,'最近90天'],[0,'全部保存记录']]){
      const option=node('option','',label);option.value=days;select.append(option);
    }
    select.value=String(state.historyDays);toolbar.append(select);
    const list=node('div','group-history-list');
    const render=()=>{
      list.replaceChildren();const selected=GH.filter(history,Number(select.value)),totals=GH.summary(selected,0);
      const counts=node('div','group-history-counts',`发现 ${selected.length} 次变化 · 新出现 ${totals.added} 人次 · 少了 ${totals.missing} 人次`);
      list.append(counts);
      if(!selected.length){list.append(node('div','group-history-empty','这个时间段暂无记录。'));return;}
      for(const h of selected){
        const item=node('article','group-history-entry');
        const label=h.kind==='reviewed'?'已核对并保存的名单':h.kind==='archived'?'退群前保留的名单差异':
          h.kind==='firstSeen'?'首次发现这个人员 ID':'发现缓存名单有变化';
        item.append(node('div','group-history-when',`${stamp(h.at)} · ${label}`));
        if(h.reviewedAt)item.append(node('div','group-history-reviewed',`已在 ${stamp(h.reviewedAt)} 保存核对结果`));
        const renderIds=(ids,kind)=>{
          if(!ids.length)return;
          const block=node('div','group-history-members '+kind);
          block.append(node('div','group-history-kind',kind==='added'?`新出现 ${ids.length} 人`:`名单少了 ${ids.length} 人`));
          for(const id of ids){
            const person=state.peopleMap.get(id);
            const name=person?.manualName||person?.name||((h.added.length===1&&h.nameSnapshot)?h.nameSnapshot:'')||'姓名暂未匹配';
            const line=node('div','group-history-person');
            line.append(node('strong','',name),node('code','group-person-id',id));
            block.append(line);
          }
          item.append(block);
        };
        renderIds(h.added,'added');renderIds(h.missing,'missing');
        if(h.truncated)item.append(node('small','subtle','较大的变动仅保存了前100个 ID，实际变化可能更多。'));
        if(h.kind==='firstSeen')item.append(node('small','subtle','首次出现在插件记录中，可能原本就在该群；不是已确认的入群。'));
        list.append(item);
      }
      if(history.length>=300)list.append(node('small','subtle','仅显示最近300条已保存记录。'));
    };
    select.addEventListener('change',()=>{state.historyDays=Number(select.value);render();});
    panel.append(toolbar,list);render();return panel;
  }
  function openGroup(id,focusHistory=false){const g=state.groupsMap.get(id);if(!g)return;
    const body=openDetail(labelGroup(g));
    const timeline=renderGroupHistory(g);
    if(focusHistory)body.append(timeline);
    body.append(click('打开 Teams 群聊 →',()=>openTeamsChat('group',id),'btn primary'));
    const origin=node('details','group-extra-filters');origin.append(node('summary','','ⓘ 群资料'),node('p','subtle',`${sourceLabel(g)} · 保存 ${g.memberIds?.length||0} 个成员 ID。历史记录不能证明目前仍在群中，离群聊天也可能无法打开。`));body.append(origin);
    if(!focusHistory)body.append(timeline);
    // Membership flags are explicit user assertions, not cache inference.
    // Keep this control visible even if a departed chat is still in Teams cache.
    const membership=node('div','detailrecord');
    const left=g.membershipStatus==='LEFT';
    membership.append(node('h3','', '本地记录的退群状态（自动识别可撤销）'));
    membership.append(node('p','',left?
      `已${g.membershipMethod==='TEAMS_UI_OBSERVED'?'根据 Teams 退群确认界面自动记录（非服务器验证）':'手动标记'}本人退出 · ${stamp(g.membershipReviewedAt)}。此群的名单、事件和历史仍保留；缓存仍可能出现本群。`:
      '尚未标记退出。此状态不证明你目前仍在群中；黄色名单差异也不等于已退群。'));
    membership.append(click(left?'撤销退群标记（我已重新加入）':'我已退出此群 · 从日常数量扣除',async()=>{
      const next=left?'UNMARKED':'LEFT';
      const prompt=left?'请确认：你已重新加入这个 Teams 群，或要撤销原来的人工退群记录。':
        '请先在 Teams 中确认：你本人确实已经退出这个群。缓存名单差异不能单独证明退群。';
      if(!confirm(`${prompt}\n\n退出后自动清除本群旧的黄色提醒，并保留完整历史；不会把缓存里的陌生人设为可信。`))return;
      try{
        await action({action:'SET_GROUP_MEMBERSHIP',id:g.id,value:next,
          expectedStatus:left?'LEFT':'UNMARKED',confirmed:true});
        await refresh();openGroup(g.id);
        toast(next==='LEFT'?'已手动记为退出：日常群数减 1，历史保留':'已撤销退群标记：日常群数加 1');
      }catch(e){await refresh();openGroup(g.id);toast('退群状态保存失败：'+e.message);}
    },'btn small'+(left?'':' primary')));
    membership.append(node('small','subtle','本人退出后会结束本群未处理的黄色名单提醒，但保留当时的成员变化与历史；不改变陌生人的可信状态。'));
    body.append(membership);
    const label=node('div','field');label.append(node('label','','给这个群改个容易认的名字'));
    const input=node('input','input');input.value=g.alias||'';input.placeholder='例如：财务部门群、A 项目群';
    append(label,input,click('保存名称',()=>edit({kind:'group',id,field:'alias',value:input.value},()=>openGroup(id)),'btn primary small'));body.append(label);
    const level=node('div','field');level.append(node('label','','提醒多少'));const sel=node('select','input');
    for(const [v,t] of [['CRITICAL','重点守护：新 ID 必须提醒'],['STANDARD','正常提醒'],['QUIET','减少提醒']]){
      const o=node('option','',t);o.value=v;sel.append(o);}sel.value=g.level;sel.addEventListener('change',()=>edit({kind:'group',id,field:'level',value:sel.value},()=>openGroup(id)));
    level.append(sel);body.append(level);
    const keys=node('div','detailrecord');append(keys,node('div','subtle','群组原始 ID（可用于检索和人工对应）'),
      node('small','',g.id),click('复制群 ID',()=>navigator.clipboard.writeText(g.id).then(()=>toast('群 ID 已复制'))));body.append(keys);
    if(g.title||g.longTitle)body.append(node('div','detailrecord',`Teams 原始标题：${g.title||g.longTitle}`));
    const titleHints=g.titleNameHints?.length?g.titleNameHints:L.titleNameHints(g.longTitle);
    if(titleHints.length){
      const namePanel=node('div','notice');namePanel.append(node('h3','','已找到 Teams 群标题中的姓名线索'));
      namePanel.append(node('p','',titleHints.join('、')));
      namePanel.append(node('small','','这些文本来自 Value.longTitle，是真实可显示的群标题线索；但仅凭这个字段无法证明哪一个姓名属于哪一个 8:live:cid ID。请在下方为成员确认绑定。'));
      body.append(namePanel);
    }
    body.append(node('small','',`上次读取缓存：${stamp(g.lastObservedAt)} · 上次观察到缓存成员变化：${stamp(g.lastCacheChangeAt)}（非实际入群时间）`));
    if(g.ambiguous){
      const issue=rosterIssue(g);
      const message=issue==='change'?'【名单可能变化】以前保存的名单和这次看到的不一样。请在 Teams 核对人员是否真的增加或减少。':
        issue==='quality'?'【缓存读取异常】未发现明确的成员 ID 差异，但本次缓存不完整或人数统计方式发生变化，建议重新检查。':
        '【名单待核查】暂时无法确认哪里发生变化，请先重新检查。';
      body.append(node('div','notice warning-note',message+' 已保留旧上次保存的名单，不会自动判定退群或覆盖成员名单。'+(g.ambiguousReason?'（记录原因：'+g.ambiguousReason+'）':'')));
      // The uncertain flag may predate pendingRosterIds (legacy upgrade). Always
      // expose an actionable refresh inside the drawer; never offer acceptance
      // until a reviewable candidate has actually been persisted.
      const control=node('div','detailrecord roster-review');
      control.append(node('h3','','核对这个群的人员'));
      const latest=Array.isArray(g.pendingRosterIds)?g.pendingRosterIds:null;
      const hasCandidate=!!(latest&&latest.length);
      control.append(node('p','',hasCandidate?
        `已保存 ${latest.length} 个最新候选成员 ID。确认前请核对 Teams 实际群成员；候选观察时间：${stamp(g.pendingSnapshotAt)}。`:
        '本群存在待核查标记，但尚未保存可供人工核查的新成员名单，因此不能直接解除黄色标记。'));
      if(state.guard?.mode==='READ_ONLY'){
        control.append(node('div','notice warning-note','当前账号处于只读保护状态，检查不会写入新候选名单。请先核实 Teams 登录账号，并通过页面顶部的账号绑定流程解除只读保护。'));
      }
      if(g.membershipStatus!=='LEFT')control.append(click('重新读取群名单',async()=>{
        try{
          const result=await action({action:'SCAN_NOW'});
          await refresh();
          const current=state.groupsMap.get(id);
          const ready=!!(current?.ambiguous&&Array.isArray(current.pendingRosterIds)&&current.pendingRosterIds.length);
          openGroup(id);
          if(ready)toast('已取得候选名单：请核对下方的旧/新成员差异后再确认');
          else if(state.guard?.mode==='READ_ONLY')toast('检查完成，但当前账号只读保护，无法保存候选名单');
          else if(current?.ambiguous)toast(`本轮已观察 ${result.scanned||0} 群，仍未取得此群的候选名单；请在 Teams 打开该群及其成员列表后重试`);
          else toast('该群现已不显示名单待核查，可能是新缓存与旧上次保存的名单一致，请核实实际群成员');
        }catch(e){toast('重新检查失败：'+e.message);}
      },'btn primary'));
      body.append(control);
      if(g.membershipStatus==='LEFT'){
        control.append(node('div','notice','本群已记录本人退出。无需重读已无法访问的群成员，旧名单和事件仍保留。'));
        const closeButton=click('清除退群前旧提醒',()=>finishExitedAlerts([g.id],closeButton,null),'btn small primary');
        control.append(closeButton);
      } else {
        control.append(node('div','notice', '如果你本人已退出这个群，直接点下面的按钮；不要求读取三分钟内的新名单。'));
        const closeButton=click('我已退群，关闭提醒',()=>finishExitedAlerts([g.id],closeButton,null),'btn small danger');
        control.append(closeButton);
      }
      if(g.membershipStatus!=='LEFT'&&hasCandidate){
        if(!Number.isFinite(g.pendingSnapshotAt)||Date.now()-g.pendingSnapshotAt>180000){
          body.append(node('div','notice warning-note','这份候选名单已超过 3 分钟。请先点击上方“重新检查此群名单”，再尝试确认。'));
        }
        const oldSet=new Set(g.memberIds||[]),newSet=new Set(latest);
        const missing=(g.memberIds||[]).filter(mid=>!newSet.has(mid));
        const added=latest.filter(mid=>!oldSet.has(mid));
        const shown=latest.filter(mid=>oldSet.has(mid));
        const box=node('div','detailrecord roster-review');
        box.append(node('h3','','核对新旧人员名单'));
        box.append(node('p','',`原上次保存的名单 ${(g.memberIds||[]).length} 人 · 新缓存 ${latest.length} 人 · 本次缺少 ${missing.length} 人 · 本次多出 ${added.length} 人 · 保留 ${shown.length} 人`));
        box.append(node('small','',`最新观察：${stamp(g.pendingSnapshotAt)}。这些只是缓存差异，不等于已确认的实际入群或退出。`));
        const showDiff=(title,list,cl)=>{
          if(!list.length)return;
          box.append(node('h4',cl,title));
          for(const mid of list.slice(0,100)){
            const person=state.peopleMap.get(mid);
            box.append(node('div','itemmeta roster-id',`${labelPerson(person||{id:mid})} · ${mid}`));
          }
          if(list.length>100)box.append(node('small','',`其余 ${list.length-100} 人请通过群成员 ID 搜索核对`));
        };
        showDiff('旧上次保存的名单有、最新缓存没有的 ID',missing,'warningtext');
        showDiff('新名单多出来的人',added,'warningtext');
        if(!missing.length&&!added.length)box.append(node('p','','成员 ID 未变化；请检查缓存可信等级或人数计数口径变化。'));
        const notice=node('div','notice warning-note','请先在 Teams 群成员列表中核实。采用后旧上次保存的名单将保存在审计事件中，当前群的成员关系按已确认名单更新，但并不证明谁在什么时间入群或退群。');
        box.append(notice);
        const actionRow=node('div','roster-actions');
        actionRow.append(click('暂不保存（稍后再核对）',()=>toast('已保留旧上次保存的名单，待核查提示仍会保留')));
        const accept=click('确认名单，清除黄色提醒',async()=>{
          if(!confirm(`确认更新这个群的成员观察上次保存的名单？\n原上次保存的名单 ${(g.memberIds||[]).length} 人 → 最新缓存 ${latest.length} 人。\n此操作不等于官方进退群证明，也不会自动批准任何新人。`))return;
          accept.disabled=true;
          try{const result=await action({action:'CONFIRM_ROSTER',id:g.id,revision:g.pendingRevision,confirmed:true});
            await refresh();openGroup(id);
            toast(`已确认当前名单：增加 ${result.added} 个 ID，旧名单缺少 ${result.removed} 个 ID，原上次保存的名单已写入审计事件`);
          }catch(e){toast('确认失败：'+e.message);accept.disabled=false;}
        },'btn primary');
        actionRow.append(accept);box.append(actionRow);body.append(box);
      }else{
        body.append(node('div','notice', '尚未取得可供核查的候选名单。请先在 Teams 打开本群及其成员列表，再点击上方「重新检查此群名单」。如仍无候选，请确认账号没有处于只读保护；不要直接重置群上次保存的名单。'));
      }
    }
    body.append(node('h3','',`当前保存的成员关系（${g.memberIds?.length||0}）`));
    for(const mid of (g.memberIds||[]).slice(0,350)){
      const p=state.peopleMap.get(mid);const suggestion=state.nameSuggestions?.get(mid);const item=node('div','detailrecord space');
      const inf=node('div','grow');append(inf,node('div','itemtitle',labelPerson(p||{id:mid})),node('div','itemmeta roster-id',mid));
      if(suggestion && !p?.manualName&&!p?.name){
        inf.append(node('div','itemmeta',`候选姓名：${suggestion.name}（来自 ${suggestion.evidence} 群的标题关联，未经核实）`));
        item.append(click('确认候选姓名',async()=>{
          if(!confirm(`是否已经人工核实「${suggestion.name}」属于成员 ${L.shortId(mid)}？\n仅凭多个群标题重合仍不能证明身份。`))return;
          await edit({kind:'person',id:mid,field:'manualName',value:suggestion.name},()=>openGroup(id));
        }));
      }
      append(item,inf,click('人员资料',()=>openPerson(mid,id)));
      if(titleHints.length && !p?.manualName){
        const wrap=node('div','namebind');const selector=node('select','input');
        const empty=node('option','','选姓名线索…');empty.value='';selector.append(empty);
        for(const name of titleHints){const op=node('option','',name);op.value=name;selector.append(op);}
        const bind=click('绑定',async()=>{
          if(!selector.value)return toast('先选择姓名');
          if(!confirm(`确认已核实「${selector.value}」属于成员 ID ${L.shortId(mid)}？\n此操作会保存为人工备注，不表示 Teams 官方完成 ID—姓名验证。`))return;
          await edit({kind:'person',id:mid,field:'manualName',value:selector.value},()=>openGroup(id));
        },'btn small');wrap.append(selector,bind);item.append(wrap);
      }
      body.append(item);
    }
    if(g.memberIds?.length>350)body.append(node('small','','只预览前 350 人，可在人名搜索中定位其余人员。'));
  }
  function showRelations(main){
    main.append(heading('群成员关系明细',`当前记录 ${state.edges.length} 条群组—人员关联。一个人在多个群组中分别计数；本页可以按群名、成员姓名或 ID 查找。`));
    const bar=node('div','toolbar'),search=node('input','input search');search.type='search';
    search.placeholder='搜索群组名称、人员姓名、人员 ID 或群 ID';search.value=state.relationQuery;
    bar.append(search);main.append(bar);const holder=node('div');main.append(holder);
    const draw=()=>{
      holder.replaceChildren();const q=state.relationQuery.trim().toLowerCase();
      const all=state.edges.filter(e=>{
        if(!q)return true;const g=state.groupsMap.get(e.groupId),p=state.peopleMap.get(e.personId);
        return [e.groupId,e.personId,g?.alias,g?.title,g?.longTitle,p?.name,p?.manualName].join(' ').toLowerCase().includes(q);
      });
      holder.append(node('p','subtle',`找到 ${all.length} 条关系，显示前 ${Math.min(all.length,state.shown)} 条。`));
      const rows=node('div','list');for(const e of all.slice(0,state.shown)){
        const g=state.groupsMap.get(e.groupId),p=state.peopleMap.get(e.personId),item=node('div','listitem'),info=node('div','grow');
        append(info,node('div','itemtitle',g?labelGroup(g):L.shortId(e.groupId)),
          node('div','itemmeta roster-id',`${labelPerson(p||{id:e.personId})} · ${e.personId} · 上次观察 ${stamp(e.lastSeen)}`));
        append(item,info,click('查看群',()=>openGroup(e.groupId)),click('查看人员',()=>openPerson(e.personId,e.groupId)));rows.append(item);
      }
      if(!all.length)rows.append(node('div','empty','没有符合搜索条件的群成员关系。'));
      holder.append(rows);
      if(all.length>state.shown)holder.append(click('继续显示 100 条',()=>{state.shown+=100;draw();},'btn'));
    };
    search.addEventListener('input',()=>{state.relationQuery=search.value;state.shown=90;draw();});draw();
  }
  function personMatched(p,q){if(!q)return true;
    const relation=state.edges.filter(e=>e.personId===p.id).map(e=>labelGroup(state.groupsMap.get(e.groupId)||{id:e.groupId})).join(' ');
    return [p.id,p.name,p.manualName,state.nameSuggestions?.get(p.id)?.name,...(p.aliases||[]),relation].join(' ').toLowerCase().includes(q);}
  function personListFiltered(){const q=state.personQuery.trim().toLowerCase();return state.people.filter(p=>{
    if(state.personFilter!=='all'&&state.personFilter!==p.status)return false;return personMatched(p,q);
  }).sort((a,b)=>{const d=(a.status==='NEW'?0:a.status==='REVOKED'?1:a.status==='LEGACY'?2:3)-(b.status==='NEW'?0:b.status==='REVOKED'?1:b.status==='LEGACY'?2:3);
    return d||labelPerson(a).localeCompare(labelPerson(b),'zh');});}
  function showPeople(main){main.append(heading('人员管理',`跨群按成员 ID 去重：${state.people.length} 个已观察身份，${state.edges.length} 条群组成员关系。名称只来自明确的 ID 对应资料或你的手动备注。`));
    const bar=node('div','toolbar'),input=node('input','input search');input.placeholder='搜索姓名、备注、ID、所属群…';input.type='search';input.value=state.personQuery;
    const sel=node('select','input');for(const [v,t] of [['all','所有人员'],['NEW','新发现待审核'],['LEGACY','初始历史待分类'],['APPROVED','已批准'],['IGNORED','暂时忽略'],['REVOKED','撤销/不信任']]){
      const o=node('option','',t);o.value=v;sel.append(o);}sel.value=state.personFilter;
    input.oninput=()=>{state.personQuery=input.value;state.shown=90;renderPeopleList(list);};sel.onchange=()=>{state.personFilter=sel.value;renderPeopleList(list);};
    append(bar,input,sel);main.append(bar);const list=node('div');main.append(list);renderPeopleList(list);
  }
  const personStatusLabel=p=>({NEW:'新发现',LEGACY:'历史待审核',APPROVED:'已批准',IGNORED:'已忽略',REVOKED:'已撤销'}[status(p)]||'待审核');
  function renderPeopleList(holder){holder.replaceChildren();const all=personListFiltered();holder.append(node('p','subtle',`匹配 ${all.length} 人`));
    if(!all.length){holder.append(node('div','empty','没有匹配的人员。'));return;}
    const rows=node('div','list');for(const p of all.slice(0,state.shown)){
      const e=node('div','listitem'),inf=node('div','grow');const n=state.edges.filter(x=>x.personId===p.id).length;const suggested=state.nameSuggestions?.get(p.id);
      append(inf,node('div','itemtitle',labelPerson(p)),node('div','itemmeta roster-id',`${p.id} · 见于 ${n} 群 · ${p.nameSource||'姓名待关联'}${suggested?' · 待确认候选：'+suggested.name:''}`));
      append(e,inf,node('span','badge '+(p.status==='NEW'?'unknown':p.status==='APPROVED'?'normal':'quiet'),personStatusLabel(p)));
      if(p.companyCandidate)e.append(node('span','badge','AA 候选'));
      e.append(click('打开聊天',()=>openTeamsChat('person',p.id)));
      e.append(click('查看 / 审核',()=>openPerson(p.id)));rows.append(e);
    }holder.append(rows);
    if(all.length>state.shown){const w=node('div','more');w.append(click('加载更多',()=>{state.shown+=100;renderPeopleList(holder);}));holder.append(w);}
  }
  function openPerson(id,groupId=null){const p=state.peopleMap.get(id);if(!p)return;
    const body=openDetail(labelPerson(p));
    body.append(click('打开 Teams 个人聊天 →',()=>openTeamsChat('person',id),'btn primary'));
    body.append(node('small','','只打开已有的单人聊天，不会自动向对方发送消息或新建会话。'));
    // When opened from a group or a group-person relation, retain that group
    // context so another member can be inspected without returning to the list.
    const group=groupId?state.groupsMap.get(groupId):null;
    if(group){
      const ids=[...new Set([...(group.memberIds||[]),...state.edges.filter(e=>e.groupId===groupId).map(e=>e.personId)])]
        .filter(mid=>state.peopleMap.has(mid));
      if(!ids.includes(id))ids.push(id);
      ids.sort((a,b)=>labelPerson(state.peopleMap.get(a)).localeCompare(labelPerson(state.peopleMap.get(b)),'zh')||a.localeCompare(b));
      const switcher=node('div','detailrecord member-switcher');
      switcher.append(node('div','subtle',`当前群组：${labelGroup(group)}`));
      const field=node('div','field'),fieldLabel=node('label','','切换查看此群人员（'+ids.length+' 人）');
      const memberSelect=node('select','input');memberSelect.setAttribute('aria-label','切换查看此群人员');
      for(const memberId of ids){
        const member=state.peopleMap.get(memberId);
        const option=node('option','',`${labelPerson(member)} · ${L.shortId(memberId)}`);
        option.value=memberId;memberSelect.append(option);
      }
      memberSelect.value=id;
      memberSelect.addEventListener('change',()=>openPerson(memberSelect.value,groupId));
      append(field,fieldLabel,memberSelect);switcher.append(field);
      switcher.append(node('small','','此处是本地已记录的成员关联，不能代替 Teams 实时成员名单。'));
      body.append(switcher);
    }
    body.append(node('div','notice','人员以 ID 唯一识别，修改姓名不会重置审核状态；AA 命中特征只是候选，不自动视为受信任。'));
    body.append(node('div','detailrecord',`成员 ID：${p.id}`));
    const suggestion=state.nameSuggestions?.get(p.id);
    if(suggestion&&!p.manualName&&!p.name){
      const box=node('div','notice warning-note');box.append(node('div','',`跨群标题候选姓名：${suggestion.name}，来自 ${suggestion.evidence} 群共同出现模式。这个结果未经身份确认。`));
      box.append(click('已核实，使用此姓名',async()=>{
        if(!confirm(`你是否已独立核实 ${suggestion.name} 与 ${L.shortId(p.id)} 是同一人？`))return;
        await edit({kind:'person',id:p.id,field:'manualName',value:suggestion.name},()=>openPerson(p.id,groupId));
      }));body.append(box);
    }
    const alias=node('div','field');alias.append(node('label','','本地备注姓名'));const input=node('input','input');input.value=p.manualName||'';input.placeholder='给这个人设置容易识别的名字';
    append(alias,input,click('保存人员备注',()=>edit({kind:'person',id,field:'manualName',value:input.value},()=>openPerson(id,groupId)),'btn primary small'));body.append(alias);
    body.append(node('div','detailrecord',`Teams 元数据姓名：${p.name||'尚未识别'} / 来源：${p.nameSource||'无'} / 首次观察：${stamp(p.firstSeen)}`));
    const choice=node('div','field');choice.append(node('label','','身份审核状态'));const sel=node('select','input');
    for(const [v,t] of [['LEGACY','历史待审核'],['NEW','新发现待审核'],['APPROVED','批准：已知身份'],['IGNORED','暂时忽略'],['REVOKED','撤销：需要关注']]){
      const opt=node('option','',t);opt.value=v;sel.append(opt);}sel.value=p.status;
    sel.onchange=()=>edit({kind:'person',id,field:'status',value:sel.value},()=>openPerson(id,groupId));choice.append(sel);body.append(choice);
    const company=node('label','checks');const cb=node('input');cb.type='checkbox';cb.checked=!!p.companyApproved;
    cb.onchange=()=>edit({kind:'person',id,field:'companyApproved',value:cb.checked},()=>openPerson(id,groupId));
    append(company,cb,node('span','','人工确认：此人为公司成员（不是仅凭 AA 名称）'));body.append(company);
    const relatedRequests=state.requests.filter(r=>r.personId===id);
    if(relatedRequests.length)body.append(click('查看该 ID 的联系请求',()=>openRequest(relatedRequests[0].id),'btn primary'));
    body.append(node('h3','','身份确认记录'));
    const audits=state.events.filter(e=>e.personId===id&&['CONTACT_REQUEST_REVIEWED','IDENTITY_REVIEWED'].includes(e.type)).sort((a,b)=>b.at-a.at);
    for(const audit of audits.slice(0,50))body.append(node('div','detailrecord',`${stamp(audit.at)} · ${audit.decision||audit.nextStatus||''} · ${audit.message||''}`));
    if(!audits.length)body.append(node('small','',p.reviewedAt?`历史最近审核：${stamp(p.reviewedAt)}；早期版本未保存逐次审核详情`:'尚无人工确认记录'));
    body.append(node('h3','','出现在哪些群组'));
    const es=state.edges.filter(e=>e.personId===id).sort((a,b)=>b.lastSeen-a.lastSeen);
    for(const edge of es.slice(0,350)){const g=state.groupsMap.get(edge.groupId);const r=node('div','detailrecord space');
      append(r,node('span','grow',g?labelGroup(g):L.shortId(edge.groupId)),click('查看群组',()=>openGroup(edge.groupId)));body.append(r);}
    if(es.length>350)body.append(node('small','','此处最多展示前 350 个群组关系。'));
  }
  // A raw member MRI is not searchable in the Teams left rail. Always let the
  // reviewer navigate via actual saved GROUP records, even if the person has no
  // confirmed edge yet (an uncertain roster deliberately creates no edge).
  function groupsForPerson(personId){
    const ids=new Set();
    for(const edge of state.edges)if(edge.personId===personId)ids.add(edge.groupId);
    for(const group of state.groups)if((group.memberIds||[]).includes(personId)||
      (group.pendingRosterIds||[]).includes(personId))ids.add(group.id);
    for(const event of state.events)if(event.personId===personId&&event.groupId)ids.add(event.groupId);
    return [...ids].map(id=>state.groupsMap.get(id)).filter(Boolean)
      .sort((a,b)=>(b.lastSeen||0)-(a.lastSeen||0)||a.id.localeCompare(b.id));
  }
  function openReviewGroups(person){
    const related=groupsForPerson(person.id),body=openDetail('在这些群聊中查看人员');
    body.append(node('p','',`此人出现在 ${related.length} 条群聊记录中。请在 Teams 打开相关群的成员名单，核对真正的姓名；ID 不能直接用于 Teams 搜索。`));
    for(const g of related.slice(0,100)){
      const row=node('div','detailrecord'),caption=node('div','grow');
      append(caption,node('strong','',labelGroup(g)),node('small','roster-id',g.id));
      append(row,caption,click('打开此群',()=>openTeamsChat('group',g.id),'btn small primary'));
      body.append(row);
    }
    if(related.length>100)body.append(node('small','',`还有 ${related.length-100} 个历史群未展开，可在群组管理中搜索。`));
    if(!related.length)body.append(node('div','notice','这个 ID 暂未关联到可定位的群聊。请先在 Teams 打开对应群并重新检查。'));
  }
  function showReview(main){const newPeople=state.people.filter(p=>p.status==='NEW');const legacy=state.people.filter(p=>p.status==='LEGACY');
    main.append(heading('新人员审核',`新出现待核查 ${newPeople.length} 人；首次初始化时已有的历史人员 ${legacy.length} 人。历史人员不会在初次导入时全部报警。`));
    const missingNames=newPeople.filter(p=>!p.manualName&&!p.name).length;
    if(missingNames)main.append(node('p','subtle',`${missingNames} 人暂未成功关联姓名。每个人下方可直接查看关联群记录、打开群聊核实，再点击「重新查找姓名」。不需要复制 ID 去 Teams 搜索，也不会乱猜姓名。`));
    const bar=node('div','toolbar');append(bar,
      click('重新查找姓名',async()=>{try{const result=await action({action:'SCAN_NOW'});await refresh();
        toast(result?.ok?'已重新读取 Teams 姓名资料；仍未显示的可打开 Teams 成员名单后再检查':'未能读取：'+(result?.error||'请确认 Teams 页面已打开'));}
        catch(e){toast(e.message);}},'btn'),
      click('查看新发现',()=>{state.personFilter='NEW';state.selected.clear();renderReviewList(holder);}),
      click('查看历史待审核',()=>{state.personFilter='LEGACY';state.selected.clear();renderReviewList(holder);}),
      click('批量批准所选',()=>bulkApprove('APPROVED'),'btn primary'),
      click('批量确认公司员工',()=>bulkApprove('APPROVED_COMPANY')), 
      click('批量标记忽略',()=>bulkApprove('IGNORED')));
    main.append(bar);const holder=node('div');main.append(holder);
    if(!['NEW','LEGACY'].includes(state.personFilter))state.personFilter='NEW';renderReviewList(holder);
  }
  function renderReviewList(holder){holder.replaceChildren();const all=state.people.filter(p=>p.status===state.personFilter),list=node('div','list');
    holder.append(node('p','subtle',`当前显示 ${all.length} 个 ${state.personFilter==='NEW'?'新发现身份':'历史待审核身份'} · 本次可勾选前 150 人。`));
    const visible=all.slice(0,150),checks=node('label','checks'),allBox=node('input');allBox.type='checkbox';
    allBox.checked=visible.length>0&&visible.every(p=>state.selected.has(p.id));
    allBox.indeterminate=visible.some(p=>state.selected.has(p.id))&&!allBox.checked;
    allBox.disabled=!visible.length;
    allBox.addEventListener('change',()=>{for(const p of visible){if(allBox.checked)state.selected.add(p.id);else state.selected.delete(p.id);}renderReviewList(holder);});
    checks.append(allBox,node('span','',`全选当前显示的 ${visible.length} 人 · 已选择 ${state.selected.size} 人`));
    holder.append(checks);
    for(const p of visible){
      const item=node('div','listitem'),cb=node('input');cb.type='checkbox';cb.checked=state.selected.has(p.id);cb.title='选择此人员';
      cb.onchange=()=>{if(cb.checked)state.selected.add(p.id);else state.selected.delete(p.id);renderReviewList(holder);};
      const related=groupsForPerson(p.id),detail=node('div','grow');
      append(detail,node('div','itemtitle',p.manualName||p.name||'需要核对姓名'),
        node('div','itemmeta roster-id',`${p.id} · ${related.length} 群 · ${stamp(p.firstSeen)}`));
      if(related.length)detail.append(node('div','itemmeta',`关联群记录：${related.slice(0,2).map(labelGroup).join('、')}${related.length>2?' 等 '+related.length+' 群':''}`));
      append(item,cb,detail);
      if(related.length===1)item.append(click('打开相关群',()=>openTeamsChat('group',related[0].id),'btn small primary'));
      else if(related.length>1)item.append(click(`查看相关群（${related.length}）`,()=>openReviewGroups(p),'btn small primary'));
      item.append(click('详情',()=>openPerson(p.id)));
      list.append(item);
    }
    if(!all.length)list.append(node('div','empty','当前没有待审核人员。'));
    holder.append(list);
  }
  async function bulkApprove(value){if(!state.selected.size)return toast('请先勾选人员');
    if(!confirm(`确定将所选 ${state.selected.size} 个身份设置为「${value==='APPROVED'?'已批准':value==='APPROVED_COMPANY'?'已批准公司员工':'忽略'}」？`))return;
    try{await action({action:'BULK_PERSON',ids:[...state.selected],value});state.selected.clear();await refresh();toast('批量审核已保存');}catch(e){toast(e.message);}}
  function showRequests(main){
    main.append(heading('陌生好友 / 联系请求','同名不等于同一个人。不同 Teams ID 必须分别核实；历史出现过也不代表可信。'));
    const coverage=node('div','notice warning-note');
    coverage.append(node('strong','','请求检测范围有限，暂不能保证第一时间发现所有请求。'));
    coverage.append(node('p','','只被动观察当前可见、带明确请求标题及接受/拒绝控件的界面。现有群缓存不能证明好友请求；未看到请求不代表没有请求。Teams 界面不匹配或未打开时可能漏检。'));
    coverage.append(node('p','','“待处理”仅表示观察时的请求界面；界面消失不会被当作已接受或已拒绝。插件没有拦截、接受、拒绝或发送消息。'));
    if(state.requestCoverage?.coverage==='UNAVAILABLE')coverage.append(node('p','','最近暂无法判断：'+state.requestCoverage.reason));
    main.append(coverage);
    const bar=node('div','toolbar'),search=node('input','input search');search.type='search';search.value=state.requestQuery;
    search.placeholder='搜索请求姓名、完整 ID 或同名原联系人';search.setAttribute('aria-label','搜索联系请求');
    const select=node('select','input');for(const [v,t] of [['pending','待核实'],['high','同名 / 撤销信任'],['handled','已处理 / 正常记录'],['all','全部历史']]){
      const opt=node('option','',t);opt.value=v;select.append(opt);}select.value=state.requestFilter;
    append(bar,search,select);main.append(bar);const holder=node('div');main.append(holder);
    const draw=()=>{holder.replaceChildren();const q=state.requestQuery.trim().toLowerCase();
      const list=state.requests.filter(r=>(state.requestFilter==='all'||state.requestFilter==='pending'&&r.status==='OPEN'||
        state.requestFilter==='handled'&&r.status!=='OPEN'||state.requestFilter==='high'&&r.status==='OPEN'&&['HIGH','CRITICAL'].includes(r.severity))&&
        (!q||[r.personId,r.nameSnapshot,...(r.matches||[]).flatMap(m=>[m.id,m.name])].join(' ').toLowerCase().includes(q)))
        .sort((a,b)=>({CRITICAL:0,HIGH:1,REVIEW:2,SILENT:3}[a.severity]??4)-({CRITICAL:0,HIGH:1,REVIEW:2,SILENT:3}[b.severity]??4)||b.at-a.at);
      holder.append(node('p','subtle',`${list.length} 条记录 · 按请求者 ID 去重；不会自动批准任何人`));
      for(const r of list.slice(0,state.shown)){
        const card=node('section','panel request-card '+(['CRITICAL','HIGH'].includes(r.severity)&&r.status==='OPEN'?'request-danger':''));
        append(card,node('h3','',r.title),node('p','request-identity',`${r.nameSnapshot||'姓名未识别'} · ${r.personId||'请求者 ID 无法识别，暂不能判断身份'}`));
        if(r.matches?.length)card.append(node('p','',`请求姓名「${r.collisionNameSnapshot||r.nameSnapshot}」与 ${r.matchCount} 条历史身份同名，但 ID 不同：${r.matches.slice(0,3).map(m=>m.name+' · '+m.id).join('；')}`));
        if(r.status==='OPEN')card.append(node('p','warningtext','请先通过原有聊天或其他可信渠道核实，勿直接通过请求。'));
        append(card,node('p','subtle',`发现 ${stamp(r.at)} · ${r.status==='OPEN'?'本地待核实':r.reviewDecision==='VERIFIED_ID'?'已人工核实 ID':r.status==='LOGGED'?'原 ID 已审核，仅记录':'本地提醒已结束，未批准身份'} · 官方当前状态未知`),
          click('查看详情',()=>openRequest(r.id),'btn primary small'));
        if(r.personId)card.append(click('复制 ID',()=>copyRequestId(r.personId)));
        holder.append(card);
      }
      if(!list.length)holder.append(node('div','empty','没有符合条件的本地请求观察。覆盖有限，不能据此判断没有陌生请求。'));
      if(list.length>state.shown)holder.append(click('继续显示 100 条',()=>{state.shown+=100;draw();}));
    };
    search.oninput=()=>{state.requestQuery=search.value;state.shown=90;draw();};
    select.onchange=()=>{state.requestFilter=select.value;state.shown=90;draw();};draw();
  }
  function copyRequestId(id){navigator.clipboard.writeText(id).then(()=>toast('完整 ID 已复制')).catch(()=>toast('复制失败，请从详情中选择完整 ID'));}
  function openRequest(id){const r=state.requests.find(e=>e.id===id);if(!r)return;
    const body=openDetail('联系请求 · 身份核实');
    append(body,node('div','notice '+(['CRITICAL','HIGH'].includes(r.severity)?'request-danger':'warning-note'),r.title),
      node('strong','',r.message),node('div','detailrecord request-identity',`请求者姓名：${r.nameSnapshot||'未识别'}\n完整 Teams ID：${r.personId||'无法识别'}`));
    if(r.personId)body.append(click('复制请求者 ID',()=>copyRequestId(r.personId)));
    append(body,node('p','',!r.personId?'请求者 ID 或请求类型证据不足，暂不能判断；不会批准任何身份。':r.firstSeenUnknown?'首次发现该 ID 时，本地人员库没有记录。后续重复观察不会变成已知可信身份。':'首次观察请求时已有该 ID 的本地记录；记录存在不等于可信。'),
      node('p','',`观察时身份状态：${requestStatusLabel(r.personStatus)} · ${r.historicalMember?'有历史群成员关系':'无已记录群关系'}`),
      node('p','',`发现：${stamp(r.at)}；最近观察：${stamp(r.lastObservedAt)}。证据来源：Teams 可见请求界面（保守识别，未验证所有版本）。`),
      node('p','',`证据：${r.evidence}。请求类型：聊天／联系邀请；不等于已成为好友。官方状态：仅在观察时见待处理，当前状态未知。`));
    if(r.nameHistory?.length)body.append(node('p','',`请求曾用姓名：${r.nameHistory.join('、')}（资料变化不代表新的 ID）`));
    if(r.matches?.length){body.append(node('h3','',`姓名「${r.collisionNameSnapshot||r.nameSnapshot}」的同名账号对照（ID 不同）`));
      for(const m of r.matches){const entry=node('div','detailrecord request-identity');
        append(entry,node('strong','',`${m.name} · ${m.trusted?'已审核联系人':m.relation==='GROUP'?'历史群成员':'历史观察身份'}`),
          node('p','',`请求账号：${r.personId||'未识别'}\n原有账号：${m.id}`),
          click('复制原 ID',()=>copyRequestId(m.id)),click('查看原联系人',()=>openPerson(m.id)));body.append(entry);}
      if(r.matchCount>r.matches.length)body.append(node('p','',`还有 ${r.matchCount-r.matches.length} 条同名历史记录，请到人员管理搜索。`));
    }
    if(state.peopleMap.has(r.personId))body.append(click('查看人员群关系与确认记录',()=>openPerson(r.personId)));
    const related=state.events.filter(e=>e.requestEventId===r.id).sort((a,b)=>b.at-a.at);
    if(related.length){body.append(node('h3','','本地提醒处理历史'));
      for(const audit of related.slice(0,50))body.append(node('div','detailrecord',`${stamp(audit.at)} · ${requestStatusLabel(audit.decision)}`));}
    const decide=async(decision,extra={})=>{try{
      await action({action:'REVIEW_CONTACT_REQUEST',account:state.account,id:r.id,revision:r.reviewRevision,decision,...extra});
      await refresh();openRequest(id);toast(decision==='VERIFY'?'该完整 ID 已人工核实；没有接受 Teams 请求':decision==='KEEP'?'保持待核实':'本地提醒已结束；没有批准身份或操作 Teams');
    }catch(e){toast(e.message);}};
    if(r.status==='OPEN'){
      const verify=node('section','detailrecord column');verify.append(node('h3','','逐项核实身份'));
      const line=node('label','checks'),checked=node('input');checked.type='checkbox';
      append(line,checked,node('span','','我已通过原有聊天或其他可信渠道核实，此完整 Teams ID 属于本人'));
      const suffix=node('input','input');suffix.maxLength=6;suffix.placeholder='填写请求者 ID 最后 6 位';suffix.autocomplete='off';suffix.setAttribute('aria-label','请求者 ID 最后 6 位');
      const approve=click('已核实身份（仅信任此 ID）',()=>{
        if(!checked.checked||suffix.value!==r.personId?.slice(-6))return toast('请先独立核实并勾选确认，再填写正确尾号');
        if(!confirm(`确认信任的是这个完整 ID？\n${r.personId}\n姓名相同不能代替 ID 核实。此操作不会接受 Teams 请求。`))return;
        decide('VERIFY',{confirmed:true,personId:r.personId,last6:suffix.value});
      },'btn primary');approve.disabled=!r.personId;
      append(verify,line,suffix,approve);body.append(verify);
      body.append(click('保持待核实',()=>decide('KEEP')));
      body.append(click('结束这条本地提醒（不批准身份）',()=>{
        if(confirm('仅结束这条本地提醒，风险尚未证明消除，也不会把对方设为可信或拒绝 Teams 请求。确定结束吗？'))decide('CLOSE',{confirmed:true});
      }));
    }else body.append(click('重新保持待核实',()=>decide('KEEP')));
  }

  function showEvents(main){main.append(heading('事件记录',`本地事件 ${state.events.length} 条。不同于真实入群日志，本页记录的是可观察的缓存差异。`));
    const bar=node('div','toolbar');const sel=node('select','input');
    for(const [v,t] of [['urgent','重要事件待处理'],['info','普通变动待查看'],['open','全部未处理'],['all','全部历史'],['ack','已处理 / 已查看']]){const op=node('option','',t);op.value=v;sel.append(op);}sel.value=state.eventFilter;
    sel.onchange=()=>{state.eventFilter=sel.value;state.selectedEvents.clear();renderEventList(holder);};bar.append(sel);main.append(bar);
    const holder=node('div');main.append(holder);renderEventList(holder);
  }
  function renderEventList(holder){holder.replaceChildren();
    const matched=e=>state.eventFilter==='all'||
      (state.eventFilter==='urgent'?e.status==='OPEN'&&['CRITICAL','HIGH','REVIEW'].includes(e.severity):
       state.eventFilter==='info'?e.status==='OPEN'&&e.severity==='INFO':
       state.eventFilter==='open'?e.status==='OPEN':e.status!=='OPEN');
    const all=state.events.filter(e=>e.type!=='CONTACT_REQUEST'&&matched(e)).sort((a,b)=>b.at-a.at).slice(0,250);
    const canBatch=e=>e.status==='OPEN'&&(e.severity==='INFO'||(e.type==='ROSTER_UNCERTAIN'&&e.severity==='REVIEW'));
    const batchable=all.filter(canBatch);
    const allowedIds=new Set(batchable.map(e=>e.id));
    for(const id of state.selectedEvents)if(!allowedIds.has(id))state.selectedEvents.delete(id);
    const summary=node('section','panel event-summary');
    summary.append(node('h3','','事件处理清单'));
    summary.append(node('p','',`显示 ${all.length} 条记录（最多250条）。点「查看群组」核对变化，再决定是否标记已查看。`));
    const uncertain=state.groups.filter(g=>g.ambiguous).length;
    if(uncertain)summary.append(click(`查看 ${uncertain} 个待核查群 →`,()=>navigate('groups','uncertain'),'btn primary small'));
    const toolbar=node('div','toolbar event-bulk');
    const choose=node('label','checks');const chooseBox=node('input');chooseBox.type='checkbox';
    const chooseLabel=node('span','',`选择可批量处理的记录（${batchable.length}）`);
    chooseBox.disabled=batchable.length===0;
    chooseBox.checked=!!batchable.length&&batchable.every(e=>state.selectedEvents.has(e.id));
    chooseBox.addEventListener('change',()=>{state.selectedEvents.clear();if(chooseBox.checked)for(const e of batchable)state.selectedEvents.add(e.id);renderEventList(holder);});
    append(choose,chooseBox,chooseLabel);toolbar.append(choose);
    const bulkButton=click('批量标记已查看',async()=>{
      const ids=[...state.selectedEvents].filter(id=>allowedIds.has(id));
      if(!ids.length)return toast('请先勾选普通变动或名单待核查的记录');
      if(!confirm(`确定将 ${ids.length} 条事件标记为已查看？\n这不会批准任何人员，也不会更新黄色群组的成员上次保存的名单。\n名单待核查的群仍需人工核对。`))return;
      bulkButton.disabled=true;
      try{const result=await action({action:'ACK_ROUTINE_EVENTS',ids});
        state.selectedEvents.clear();await refresh();toast(`已标记 ${result.changed||0} 条事件；群名单仍需独立核实`);
      }catch(e){bulkButton.disabled=false;toast('批量操作失败：'+e.message);}
    },'btn small primary');
    bulkButton.disabled=state.selectedEvents.size===0;
    toolbar.append(bulkButton);
    summary.append(toolbar);
    summary.append(node('small','','只允许批量标记普通变动和名单核查事件。新人员及重要警报不能批量忽略；标记已查看也不会自动确认群成员名单。'));
    holder.append(summary);
    const list=node('div','list');
    const nameFor=id=>{const p=state.peopleMap.get(id);return `${labelPerson(p||{id})} · ${id}`;};
    for(const e of all){
      const g=state.groupsMap.get(e.groupId),p=state.peopleMap.get(e.personId);
      const groupId=typeof e.groupId==='string'?e.groupId:'';
      const personId=typeof e.personId==='string'?e.personId:'';
      const groupName=g?labelGroup(g):'群组记录尚未建立';
      const eventName=e.type==='ROSTER_CHANGE_OBSERVED'?'群成员缓存变化记录（可查看具体人员）':
        e.type==='ROSTER_BASELINE_REVIEWED'?'已核对并保存群成员名单':
        e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE'?'本人退群后保留的旧名单变化':
        e.type==='GROUP_MEMBERSHIP_DECLARED'||e.type==='GROUP_MEMBERSHIP_UI_OBSERVED'?'本人退群状态记录':
        ['CONTACT_REQUEST_REVIEWED','IDENTITY_REVIEWED'].includes(e.type)?'身份确认记录（本地）':e.type==='ROSTER_UNCERTAIN'?'群成员名单待核查 · 查看具体差异':
        e.type==='FIRST_SEEN_ID'?`首次发现陌生 ID（必须审核）：${labelPerson(p||{id:personId})}`:
        e.type==='HISTORICAL_NEW_PERSON'?`历史备份差异 · 新 ID：${labelPerson(p||{id:personId})}`:
        e.personWasKnown?`已知人员跨群变化：${labelPerson(p||{id:personId})}`:
        `观察到新 ID：${labelPerson(p||{id:personId})}`;
      const el=node('div','listitem eventitem'),info=node('div','grow');
      append(info,node('div','itemtitle',eventName),
        node('div','itemmeta event-wrap',['CONTACT_REQUEST_REVIEWED','IDENTITY_REVIEWED'].includes(e.type)?`${e.message} · ${e.decision||e.nextStatus||''}`:`目标群组：${groupName} · 群 ID：${groupId?L.shortId(groupId):'未记录'}`),
        node('div','itemmeta event-wrap',e.type==='HISTORICAL_NEW_PERSON'?`相对于 ${e.backupAt||'历史'} 的缓存差异 · ${stamp(e.at)} 生成提醒`:
          `${stamp(e.at)} · ${e.quality||'缓存观察'} · ${e.personWasKnown?'此前已知的 ID':'首次发现 / 名单不确定'}`));
      if(personId)info.append(node('div','itemmeta event-wrap',`人员 ID：${personId}${p?.status==='NEW'?' · 身份待审核':''}`));
      if(['ROSTER_UNCERTAIN','ROSTER_CHANGE_OBSERVED','ROSTER_BASELINE_REVIEWED'].includes(e.type)){
        const snapshot=(Number.isInteger(e.oldRosterCount)&&Number.isInteger(e.candidateRosterCount))||e.type==='ROSTER_BASELINE_REVIEWED';
        const current=!!(g?.ambiguous&&Array.isArray(g.pendingRosterIds));
        const previous=Array.isArray(g?.memberIds)?g.memberIds:[];
        const recent=current?g.pendingRosterIds:[];
        const freshSet=new Set(recent),oldSet=new Set(previous);
        const added=snapshot&&Array.isArray(e.addedIds)?e.addedIds:
          current?recent.filter(id=>!oldSet.has(id)):[];
        const missing=snapshot&&Array.isArray(e.removedIds)?e.removedIds:
          current?previous.filter(id=>!freshSet.has(id)):[];
        const details=node('div','event-diff');
        if(snapshot||current){
          const source=e.type==='ROSTER_BASELINE_REVIEWED'?'人工核对后保存的变化':snapshot?'事件生成时的缓存差异':'当前待核查名单对比（可能晚于这条事件）';
          const before=e.type==='ROSTER_BASELINE_REVIEWED'?(e.previousMemberIds?.length||0):(snapshot?e.oldRosterCount:previous.length);
          const after=e.type==='ROSTER_BASELINE_REVIEWED'?(e.acceptedMemberIds?.length||0):(snapshot?e.candidateRosterCount:recent.length);
          details.append(node('div','event-diff-head',`${source}：以前保存 ${before} 人 → 最新记录 ${after} 人；新出现 ${added.length}${e.diffTruncated?'（只列前100项）':''}、少了 ${missing.length}${e.diffTruncated?'（只列前100项）':''}`));
          const showDiff=(label,ids)=>{
            if(!ids.length)return;
            details.append(node('div','event-diff-label',label));
            for(const id of ids.slice(0,8))details.append(node('div','event-wrap',nameFor(id)));
            if(ids.length>8)details.append(node('small','',`还有 ${ids.length-8} 项，点击「查看名单差异」核对`));
          };
          showDiff('缓存中疑似新增的 ID',added);showDiff('旧上次保存的名单有、缓存候选中缺少的 ID',missing);
          if(!added.length&&!missing.length)details.append(node('small','','成员 ID 未发现差异，可能是缓存完整性或统计口径变化。'));
        }else details.append(node('div','',`这是一条旧版核查事件，未保存当时的新旧成员快照。请打开群组重新检查获取当前候选名单。`));
        details.append(node('small','','以上均为本地缓存差异，不证明是谁操作，也不等于真实入群或退群。'));
        info.append(details);
      }
      if(canBatch(e)){
        const l=node('label','checks event-select'),cb=node('input');cb.type='checkbox';cb.checked=state.selectedEvents.has(e.id);
        cb.addEventListener('change',()=>{if(cb.checked)state.selectedEvents.add(e.id);else state.selectedEvents.delete(e.id);bulkButton.disabled=state.selectedEvents.size===0;chooseBox.checked=batchable.every(x=>state.selectedEvents.has(x.id));});
        append(l,cb,node('span','','选择'));el.append(l);
      }
      const severityText={CRITICAL:'紧急',HIGH:'重要',REVIEW:'待核查',INFO:'普通',SILENT:'仅记录'};
      el.append(info,node('span','badge '+(e.severity==='CRITICAL'?'critical':e.severity==='INFO'?'info':e.severity==='SILENT'?'quiet':'warn'),severityText[e.severity]||e.severity));
      if(g)el.append(click(['ROSTER_UNCERTAIN','ROSTER_CHANGE_OBSERVED','ROSTER_BASELINE_REVIEWED'].includes(e.type)?'查看本群近期变化':'查看群组',()=>openGroup(g.id,true)));
      if(groupId)el.append(click('复制群 ID',()=>navigator.clipboard.writeText(groupId).then(()=>toast('群 ID 已复制')).catch(()=>toast('复制失败，请在群组中心查看'))));
      if(p)el.append(click('查看人员',()=>openPerson(p.id,g?.id||null)));
      if(e.status==='OPEN')el.append(click('标记已查看',()=>edit({kind:'event',id:e.id,value:'ACKNOWLEDGED'})));
      list.append(el);
    }
    if(!all.length)list.append(node('div','empty','当前没有此类事件。'));
    holder.append(list);
  }
  function showSettings(main){main.append(heading('设置与备份','姓名前缀只辅助分类；审核通过基于人员 ID。所有设置保存在扩展自己的 IndexedDB 中。'));
    const p=state.policy||L.validatePolicy({});
    const panel=node('section','panel column');panel.append(node('h3','','公司成员 AA 识别与调配提醒'));
    const enabled=node('label','checks'),cb=node('input');cb.type='checkbox';cb.checked=p.aaEnabled;append(enabled,cb,node('span','','启用公司名称特征识别（仅标记候选，不自动批准）'));panel.append(enabled);
    const row=node('div','formrow'),prefix=node('div','field'),mode=node('div','field');prefix.append(node('label','','前缀（逗号隔开）'));
    const pi=node('input','input');pi.value=p.aaPrefixes.join(',');prefix.append(pi);mode.append(node('label','','匹配方式'));
    const ms=node('select','input');[['prefix','以指定文字开头'],['contains','名称包含指定文字']].forEach(([v,t])=>{const e=node('option','',t);e.value=v;ms.append(e);});ms.value=p.aaMode;mode.append(ms);append(row,prefix,mode);panel.append(row);
    panel.append(node('p','subtle','已批准的员工进入其他普通群，也会在「普通变动」中留下记录；设为“安静记录”的群除外。'));
    const sound=node('label','checks'),si=node('input');si.type='checkbox';si.checked=p.sound;
    append(sound,si,node('span','','启用桌面报警提示音'));panel.append(sound);
    const notify=node('label','checks'),ni=node('input');ni.type='checkbox';ni.checked=p.notifyUnknown;
    append(notify,ni,node('span','','群成员未知 ID 发送系统通知（重点群始终优先）'));panel.append(notify);
    const known=node('label','checks'),ki=node('input');ki.type='checkbox';ki.checked=p.notifyKnownTransfers!==false;
    append(known,ki,node('span','','已知身份（含已批准公司员工）跨群新增时发送普通通知'));panel.append(known);
    panel.append(click('保存全局策略',()=>edit({kind:'policy',value:{aaEnabled:cb.checked,aaPrefixes:pi.value.split(/[,，\n]/),aaMode:ms.value,quietApprovedAA:p.quietApprovedAA,sound:si.checked,notifyUnknown:ni.checked,notifyKnownTransfers:ki.checked}}),'btn primary'));
    main.append(panel);
    const profile=node('section','panel column');profile.append(node('h3','','确认本人账号 · 档案管理'));
    profile.append(node('p','subtle','只需确认一次本人 Teams 成员 ID。推荐选项来自本次 Teams 本地群名单，不代表微软官方身份认证。确认后不改变日常状态栏或插件弹窗。'));
    // Identity confirmation and manual archive names serve different purposes.
    // Do not pass an arbitrary archive label to CONFIRM_SELF_ID.
    const selfPanel=node('div','field self-id-panel');
    const selfHeading=node('h4','','我的 Teams ID');
    const selfStatus=node('p','subtle','正在查看本人身份状态…');
    const selfForm=node('div','column');selfForm.hidden=true;
    const selfButton=click('核对我的 Teams ID',async()=>{
      selfButton.disabled=true;
      selfStatus.textContent='正在从最新 Teams 群缓存获取候选 ID…';
      try{
        const scan=await action({action:'SCAN_NOW'});
        if(scan.readOnly)throw new Error('账号当前只读，不能核对本人 ID');
        const offer=await action({action:'SELF_ID_STATUS'});
        showSelfOffer(offer);
      }catch(e){selfStatus.textContent='暂时无法获取推荐名单：'+e.message;selfForm.hidden=true;}
      finally{selfButton.disabled=false;}
    },'btn small');
    function showSelfOffer(offer){
      if(offer.confirmed){
        selfStatus.textContent='本人 ID 已确认：'+offer.selfId+'。正常检查无需重复确认。';
        selfForm.hidden=true;selfForm.replaceChildren();selfButton.hidden=true;return;
      }
      if(!offer.available){
        selfStatus.textContent='本人 ID 尚未确认。'+(offer.reason||'请在 Teams 完成一次检查后获取推荐选项。');
        selfForm.hidden=true;selfForm.replaceChildren();selfButton.hidden=false;return;
      }
      const candidates=Array.isArray(offer.candidates)?offer.candidates.filter(c=>typeof c?.id==='string'):[];
      selfForm.replaceChildren();selfForm.hidden=false;selfButton.hidden=false;
      selfStatus.textContent=`找到 ${candidates.length} 个候选 ID（按出现群数排序），请选择您本人；不会自动选择。`;
      const hint=node('p','subtle',`最近一次完整检查可对比 ${offer.eligibleGroups} 个群。即使某个 ID 出现在全部群中，也不一定是您。`);
      const searchLabel=node('label','','查找推荐 ID（姓名或 ID）');
      const search=node('input','input');search.type='search';search.autocomplete='off';
      search.placeholder='输入姓名、ID 中的一部分或尾号';
      const pickLabel=node('label','','推荐的本人 ID（须人工核对）');
      const pick=node('select','input self-id-picker');
      pick.setAttribute('aria-label','推荐的本人 Teams 成员 ID');
      const chosen=node('div','self-id-chosen','尚未选择任何 ID');
      const manualLabel=node('label','','列表中没有？手动粘贴完整 ID');
      const typed=node('input','input');typed.type='text';typed.maxLength=480;
      typed.autocomplete='off';typed.spellcheck=false;
      typed.placeholder='可选：从 Teams 本人资料核对后粘贴完整 ID';
      const suffixLabel=node('label','','安全确认：填写本人 ID 的最后 6 位');
      const suffix=node('input','input');suffix.type='text';suffix.maxLength=6;
      suffix.autocomplete='off';suffix.spellcheck=false;
      suffix.placeholder='最后 6 位（不会自动填写）';
      const renderOptions=()=>{
        const previous=pick.value,query=search.value.trim().toLowerCase();
        const shown=candidates.filter(c=>!query||c.id.toLowerCase().includes(query)||String(c.name||'').toLowerCase().includes(query));
        pick.replaceChildren();
        const placeholder=node('option','','— 请从推荐名单中选择 —');placeholder.value='';pick.append(placeholder);
        shown.forEach((c,i)=>{
          const label=`${i+1}. ${c.name?c.name+' · ':'姓名未记录 · '}${c.count}/${offer.eligibleGroups} 群 · ${c.id}`;
          const option=node('option','',label);option.value=c.id;pick.append(option);
        });
        pick.value=shown.some(c=>c.id===previous)?previous:'';
        chosen.textContent=pick.value?'已选 ID：'+pick.value:'尚未选择任何 ID'+(shown.length?'': '（没有符合搜索条件的候选）');
      };
      search.addEventListener('input',renderOptions);
      pick.addEventListener('change',()=>{
        if(pick.value)typed.value='';
        chosen.textContent=pick.value?'已选 ID：'+pick.value:'尚未选择任何 ID';
        suffix.value='';
      });
      typed.addEventListener('input',()=>{
        if(typed.value.trim()){pick.value='';chosen.textContent='使用手动填写的 ID（请核对 Teams 本人资料）';}
        suffix.value='';
      });
      renderOptions();
      const verify=click('确认这是我本人',async()=>{
        try{
          const id=typed.value.trim()||pick.value;
          if(!id)throw new Error('请先选择推荐 ID，或填写您的完整 Teams 成员 ID');
          if(suffix.value!==id.slice(-6))throw new Error('请准确输入所选 ID 的最后 6 位');
          if(!confirm(`请再次核对：\n${id}\n\n这是您本人在 Teams 中的成员 ID 吗？\n\n仅保存本人身份绑定，不更改已记录群组、人员或审计记录；这不是微软官方认证。`))return;
          verify.disabled=true;
          await action({action:'CONFIRM_SELF_ID',account:state.account,selfId:id,last6:suffix.value});
          selfStatus.textContent='本人 ID 已确认：'+id+'。以后正常检查不必再次确认。';
          selfForm.hidden=true;selfForm.replaceChildren();selfButton.hidden=true;
          toast('本人 ID 已确认，原有群组和确认记录没有改变');
        }catch(e){toast('身份未确认：'+e.message);}
        finally{verify.disabled=false;}
      },'btn small primary');
      selfForm.append(hint,searchLabel,search,pickLabel,pick,chosen,manualLabel,typed,
        node('p','subtle','候选仅供查找，不能只看出现次数或姓名。后台要求该 ID 最近至少出现于 3 个群，并核对尾号。'),
        suffixLabel,suffix,verify);
    }
    append(selfPanel,selfHeading,selfStatus,selfButton,selfForm);
    profile.append(selfPanel);
    // Display any fresh candidates directly on opening Settings, without an
    // extra button click or background scan. A missing/expired offer must be
    // explicitly refreshed; no implicit high-cost scanning while navigating.
    action({action:'SELF_ID_STATUS'}).then(offer=>{
      if(selfPanel.isConnected)showSelfOffer(offer);
    }).catch(()=>{if(selfPanel.isConnected)selfStatus.textContent='当前无法读取本人 ID 状态，请稍后重试。';});
    const archive=node('div','field archive-label-field');
    archive.append(node('h4','','档案备注名（可选）'));
    archive.append(node('p','subtle','这只是给本地档案起一个便于辨认的名字，例如“账号 A”。它不是 Teams ID，不能用来验证身份。'));
    const manual=node('input','input');manual.placeholder='例如：工作账号 A（无需填写账号 ID）';
    archive.append(manual);
    archive.append(click('保存档案备注名（下次检查生效）',async()=>{
      try{await action({action:'SET_MANUAL_PROFILE',name:manual.value});toast('档案备注已保存，不会修改已经确认的本人 ID');}
      catch(e){toast(e.message);}
    }));
    profile.append(archive);
    main.append(profile);
    const backup=node('section','panel column');backup.append(node('h3','','加密备份与恢复'));
    backup.append(node('p','','扩展原生 IndexedDB 不受 storage.local 10MB 单对象配额限制。备份文件由浏览器下载到你指定的电脑文件夹，不会上传外部服务器。建议定期备份。'));
    const line=node('div','toolbar');const password=node('input','input');password.type='password';password.placeholder='备份加密密码（至少 10 字符）';password.autocomplete='new-password';
    const file=node('input','input');file.type='file';file.accept='.json,application/json';
    append(line,password,click('导出加密完整备份',()=>exportEncrypted(password.value),'btn primary'),file,
      click('解密并恢复备份（仅补回缺失）',()=>importEncrypted(file,password.value)));backup.append(line);
    backup.append(node('p','', '历史备份差异检查：选择昨天的加密 JSON，查看今天相对备份新增的人员及群成员关系。比较本身只读，不会回滚当前群组或白名单。'));
    const comparePanel=node('div','notice','尚未进行历史备份对比。');
    backup.append(click('比较历史备份与当前成员',()=>compareEncrypted(file,password.value,comparePanel),'btn primary'));
    backup.append(comparePanel);main.append(backup);
    const recovery=node('section','panel column');
    recovery.append(node('h3','','数据升级保护 · 本机恢复点'));
    recovery.append(node('p','','首次运行新版时会自动保留原始数据。核对及恢复只针对当前账号，其他历史账号的记录不会被补回。本机恢复点未加密，不等于独立备份；卸载扩展可能丢失数据。'));
    const statusLine=node('p','subtle','正在读取升级保护状态…');
    const checkpointOptions=node('select','input');
    const resultLine=node('div','notice','升级后可检查群组、人员和未处理新身份是否仍然存在。');
    async function loadRecovery(){
      try{
        const r=await action({action:'RECOVERY_STATUS'});
        checkpointOptions.replaceChildren();
        const entries=r.checkpoints||[];
        for(const item of entries){
          const option=node('option','',`${new Date(item.at).toLocaleString()} · ${item.label} · 群组 ${item.counts.groups||0} · 人员 ${item.counts.people||0}`);
          option.value=item.id;checkpointOptions.append(option);
        }
        checkpointOptions.disabled=entries.length===0;
        statusLine.textContent=r.ready
          ? `升级数据保护已就绪（版本 ${r.version}），找到 ${entries.length} 个本机恢复点。`
          : `⚠ 自动恢复点未准备完成：${r.error||'未知错误'}，请先导出加密备份，暂停审核修改。`;
        if(entries.length){
          const top=entries[0];
          const v=await action({action:'VERIFY_CHECKPOINT',id:top.id});
          resultLine.textContent=`最近恢复点核对：${v.missing===0?'所记录的关键数据均仍存在':`缺少 ${v.missing} 条记录`}。当时有 ${v.priorGroups} 个群、${v.previousPending} 个待审核新身份。注意这是恢复点时的数字，不是当前实时统计。`;
        }
      }catch(e){statusLine.textContent='恢复点读取失败：'+e.message;}
    }
    recovery.append(statusLine, checkpointOptions, resultLine);
    const actions=node('div','toolbar');
    actions.append(
      click('立即创建恢复点',async()=>{
        try{const r=await action({action:'CREATE_CHECKPOINT'});
          toast(r.empty?'本地尚无记录，无需备份':`已保存本地恢复点：${r.total} 条记录`);
          await loadRecovery();
        }catch(e){toast('创建失败：'+e.message);}
      },'btn primary'),
      click('核对所选恢复点',async()=>{
        try{const r=await action({action:'VERIFY_CHECKPOINT',id:checkpointOptions.value});
          resultLine.textContent=`完整性核对完成：${r.missing} 条缺失；历史群 ${r.priorGroups}、当时待审身份 ${r.previousPending}。仅比较记录存在与否，不覆盖后来修改。`;
        }catch(e){toast('核对失败：'+e.message);}
      }),
      click('仅恢复缺失记录',async()=>{
        if(!checkpointOptions.value)return toast('请先选择恢复点');
        if(!confirm('仅补回当前数据库缺失的旧记录；不会覆盖现在的批准状态、群组别名或其他已有数据。\n\n有意删除的旧记录也可能被补回，确定继续吗？'))return;
        try{const r=await action({action:'RESTORE_MISSING',id:checkpointOptions.value});
          await refresh();toast(`恢复成功：补回 ${r.added} 条缺失记录；原有记录未覆盖`);
        }catch(e){toast('恢复失败：'+e.message);}
      })
    );
    recovery.append(actions);
    recovery.append(node('small','','保留最近 4 个恢复点。强烈建议再使用上面的“导出加密完整备份”，把备份文件单独保存到电脑。'));
    main.append(recovery);
    loadRecovery();
    const diagn=node('section','panel column');diagn.append(node('h3','','运行诊断'));diagn.append(node('p','','诊断只包含状态及数量，不会包含成员姓名、ID 或登录凭据。'));
    diagn.append(click('复制脱敏诊断',async()=>{try{const r=await action({action:'DIAGNOSTIC'});await navigator.clipboard.writeText(JSON.stringify(r.report,null,2));toast('诊断已复制');}catch(e){toast(e.message);}}));
    main.append(diagn);
    main.append(node('div','pagefooter','浏览器删除扩展或浏览器配置文件可能清除本地数据。unlimitedStorage 不是免备份承诺。'));
  }
  const bytesToB64=b=>{const u=new Uint8Array(b);let r='';for(let i=0;i<u.length;i+=0x8000)r+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(r);};
  const b64ToBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  async function keyFor(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,
      {name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
  async function exportEncrypted(password){if(password.length<10)return toast('请使用至少 10 个字符的备份密码');
    if(!state.account)return toast('还没有可备份的账户数据');
    try{const stores=['groups','people','edges','events','policies'];const tables={};
      for(const store of stores){tables[store]=store==='policies'?[await D.getPolicy(state.account)]:await D.getAllFor(store,state.account);}
      const json=JSON.stringify({format:'TGS3_BACKUP',version:1,at:new Date().toISOString(),account:state.account,tables});
      const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
      const key=await keyFor(password,salt),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(json));
      const out={format:'TGS3_ENCRYPTED',version:1,kdf:'PBKDF2-SHA256',iterations:250000,cipher:'AES-256-GCM',
        salt:bytesToB64(salt),iv:bytesToB64(iv),data:bytesToB64(cipher)};
      const blob=new Blob([JSON.stringify(out)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`TeamsGroupSentry-v1-${new Date().toISOString().slice(0,10)}.encrypted.json`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),20000);toast('加密备份已生成，请妥善保管密码');
    }catch(e){toast('备份失败：'+e.message);}}
  async function decryptEncrypted(input,password){
    const file=input.files?.[0];if(!file)throw new Error('请先选择加密备份 JSON 文件');
    if(file.size>45*1024*1024)throw new Error('备份文件超过 45MB');
    if(!password)throw new Error('请输入该备份文件的密码');
    const f=JSON.parse(await file.text());
    // Reject oversized or malformed Base64 before atob() and AES-GCM allocate buffers.
    const envelope=globalThis.TGSBackupEnvelope;
    if(!envelope)throw new Error('备份安全校验器未加载');
    envelope.validate(f);
    const salt=b64ToBytes(f.salt),iv=b64ToBytes(f.iv);
    if(salt.length!==16||iv.length!==12)throw new Error('备份加密元数据异常');
    const key=await keyFor(password,salt);
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,b64ToBytes(f.data));
    return JSON.parse(new TextDecoder().decode(raw));
  }
  async function importEncrypted(input,password){
    try{
      const data=await decryptEncrypted(input,password);
      if(!confirm('导入只补回缺失记录，不会回滚当前名单，也不会因为导入旧备份就重新报警。若要找出昨天之后的新成员，请用“比较历史备份与当前成员”。\n\n确定继续补缺导入吗？'))return;
      const response=await action({action:'RESTORE',data});
      await refresh();toast(`已补回 ${response.restored} 条缺失记录，跳过 ${response.unchanged||0} 条现有记录`);
    }catch(e){toast('恢复失败：'+e.message);}
  }
  async function compareEncrypted(input,password,panel){
    panel.replaceChildren(node('p','','正在对比历史成员快照…'));
    try{
      const data=await decryptEncrypted(input,password);
      const report=await action({action:'COMPARE_BACKUP',data});
      panel.replaceChildren();
      panel.append(node('h3','','历史备份差异结果（非实时入群证明）'));
      panel.append(node('p','',`备份时间：${report.backupAt||'未知'}；当时群组 ${report.beforeGroups}，当前 ${report.currentGroups}。`));
      const headline=node('p','',`相比备份：新增唯一人员 ID ${report.newPeopleCount}；新增群组 ${report.newGroupCount}；原有群新增成员关系 ${report.oldGroupNewRelations}；旧关系在当前缓存缺失 ${report.oldGroupMissingRelations}。`);
      headline.style.fontWeight='700';headline.style.color=report.newPeopleCount||report.oldGroupNewRelations?'#c92a2a':'';
      panel.append(headline);
      if(report.newPeopleCount){
        const list=node('div','column');list.append(node('h4','','备份之后新出现的成员 ID（按人员去重）'));
        for(const p of report.people){
          const groups=p.groups.map(g=>g.title||L.shortId(g.id)).join('、');
          list.append(node('p','',`${p.name||'姓名暂未匹配'} · ${L.shortId(p.id)} · ${p.inPreviouslyKnownGroup?'出现在备份已有群':'仅出现在新群或未记录关系'} · ${groups}`));
        }
        panel.append(list);
        panel.append(click('把这些历史新身份加入待核查事件',async()=>{
          if(!confirm(`将相对于历史备份新发现的 ${report.newPeopleCount} 个身份标记为“历史待核查”事件？不会修改当前群组上次保存的名单或人员白名单；这不是实际入群时间的证明。`))return;
          try{
            const saved=await action({action:'MARK_HISTORICAL',data});
            toast(`已新增 ${saved.created} 条历史待核查事件，重复 ${saved.unchanged} 条未再次写入`);
            await refresh();
          }catch(e){toast('保存历史待核查事件失败：'+e.message);}
        },'btn primary'));
      }
      if(report.oldGroupNewRelations){
        panel.append(node('h4','','在备份已有群组中新出现的成员关系（最多显示 30 条）'));
        for(const r of report.additions.slice(0,30)){
          const person=state.peopleMap.get(r.personId);
          panel.append(node('p','',`${r.title||L.shortId(r.groupId)} ← ${labelPerson(person||{id:r.personId})}`));
        }
      }
      if(report.newGroupCount){
        panel.append(node('h4','','备份之后新发现的群组（最多显示 20 条）'));
        for(const g of report.newGroups.slice(0,20))panel.append(node('p','',`${g.title||L.shortId(g.id)}（缓存 ${g.count} 人）`));
      }
      if(report.reportLimited)panel.append(node('p','','⚠️ 结果较多，仅展示前一部分；已阻止一键生成大量历史待审事件。'));
      panel.append(node('p','','这些数字是两个本地快照的差异，可能包括 Teams 延迟补充的历史成员；不代表这些人在备份日期后实际入群。'));
    }catch(e){panel.replaceChildren(node('p','',`对比失败：${e.message}`));}
  }
  by('closeDetail').addEventListener('click',closeDetail);
  by('scan').addEventListener('click',async()=>{const b=by('scan');b.disabled=true;b.textContent='检查中…';
    try{const r=await action({action:'SCAN_NOW'});await refresh();toast(`检查完成：本次观察 ${r.scanned} 群，新增关系 ${r.observedAdded||0}`);}
    catch(e){toast('检查失败：'+e.message);}finally{b.disabled=false;b.textContent='立即检查';}});
  by('openTeams').addEventListener('click',()=>chrome.tabs.create({url:'https://teams.live.com/v2/'}));
  document.querySelectorAll('.nav').forEach(e=>e.addEventListener('click',()=>switchPage(e.dataset.page)));
  document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.page===state.page));
  refresh().then(()=>{const target=new URLSearchParams(location.search).get('open');
    if(target&&state.groupsMap.has(target)){switchPage('groups');openGroup(target);}
  }).catch(e=>toast('加载失败：'+e.message));
})();
