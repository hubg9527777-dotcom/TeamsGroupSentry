/* Local ID-first request policy. A request observation NEVER inserts a person. */
(function(root,factory){const v=factory();if(typeof module==='object'&&module.exports)module.exports=v;root.TGSContactRisk=v;})(globalThis,()=>{
  const normalize=s=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US'):'';
  const validMRI=id=>typeof id==='string'&&/^(?:8|28|5|4|1):[^\s<>\x00-\x1f]{1,480}$/.test(id);
  const labels={IMPERSONATION_CONTACT:'🔴 警惕！陌生账号疑似冒充熟人',IMPERSONATION_MEMBER:'🔴 发现同名陌生账号，请先核实身份',
    NAME_COLLISION:'🔴 与已记录人员同名，ID 不同',STRANGER:'🟠 陌生账号请求联系',REVOKED:'🔴 已撤销信任的账号请求联系',
    UNREVIEWED:'🟠 已记录但尚未核实身份',HISTORICAL_MEMBER:'🟠 历史群成员请求联系，仍需核实',TRUSTED:'已审核 ID 的联系请求',
    MISSING_ID:'🟠 请求界面身份或类型待确认'};
  function classify(observation,people,edges,previous){
    const id=observation.personId,person=people.find(p=>p.id===id);
    const firstSeenUnknown=previous?previous.firstSeenUnknown===true:!person;
    const needle=normalize(observation.name);
    const groupIds=new Set(edges.map(e=>e.personId));
    const matches=needle?people.filter(p=>p.id!==id&&[p.name,p.manualName,...(Array.isArray(p.aliases)?p.aliases:[])]
      .some(n=>normalize(n)===needle)).map(p=>({id:p.id,name:p.manualName||p.name||'',status:p.status||'LEGACY',
        relation:groupIds.has(p.id)?'GROUP':'OBSERVED',trusted:p.status==='APPROVED'})):[];
    // An exact trusted ID remains the same identity after a rename. Names never grant trust.
    let risk=!validMRI(id)?'MISSING_ID':person?.status==='REVOKED'?'REVOKED':person?.status==='APPROVED'?'TRUSTED':
      matches.some(p=>p.trusted)?'IMPERSONATION_CONTACT':matches.some(p=>p.relation==='GROUP')?'IMPERSONATION_MEMBER':
      matches.length?'NAME_COLLISION':firstSeenUnknown?'STRANGER':groupIds.has(id)?'HISTORICAL_MEMBER':'UNREVIEWED';
    const severity=risk==='TRUSTED'?'SILENT':risk==='IMPERSONATION_CONTACT'?'CRITICAL':
      ['IMPERSONATION_MEMBER','NAME_COLLISION','REVOKED'].includes(risk)?'HIGH':'REVIEW';
    return {risk,severity,title:labels[risk],firstSeenUnknown,personStatus:person?.status||'UNOBSERVED',
      matches:matches.slice(0,100),matchCount:matches.length,historicalMember:groupIds.has(id)};
  }
  function evolve(previous,observation,assessment,now){
    const sameName=normalize(previous?.nameSnapshot)===normalize(observation.name);
    // An observation cannot resolve an outstanding review, even if an unrelated UI edit approved the ID.
    // Only a new collision or an explicit revocation reopens a verified request.
    const rank={SILENT:0,REVIEW:1,HIGH:2,CRITICAL:3};
    const escalation=previous&&(rank[assessment.severity]||0)>(rank[previous.severity]||0);
    const reopen=previous&&previous.status!=='OPEN'&&assessment.risk!=='TRUSTED'&&
      ((assessment.risk==='REVOKED'&&(previous.risk!=='REVOKED'||previous.reviewDecision==='VERIFIED_ID'))||!sameName||previous.risk==='TRUSTED'||escalation);
    const status=!previous?(assessment.risk==='TRUSTED'?'LOGGED':'OPEN'):
      reopen?'OPEN':previous.status;
    const retain=previous?.status==='OPEN'&&(assessment.risk==='TRUSTED'||(rank[previous.severity]||0)>(rank[assessment.severity]||0));
    const fields=retain?{...assessment,risk:previous.risk,severity:previous.severity,title:previous.title,matches:previous.matches,matchCount:previous.matchCount}:assessment;
    const changed=!previous||previous.status!==status||previous.risk!==fields.risk||!sameName||
      previous.matchCount!==fields.matchCount||JSON.stringify(previous.matches)!==JSON.stringify(fields.matches);
    return {...previous,...fields,type:'CONTACT_REQUEST',status,personId:observation.personId||null,
      nameSnapshot:observation.name||'',
      collisionNameSnapshot:retain?(previous.collisionNameSnapshot||previous.nameSnapshot):assessment.matches.length?observation.name:'',
      nameHistory:!sameName&&previous?.nameSnapshot?[...new Set([...(previous.nameHistory||[]),previous.nameSnapshot])].slice(-10):(previous?.nameHistory||[]),source:'TEAMS_VISIBLE_REQUEST_UI',evidence:observation.evidence,
      requestState:'PENDING_OBSERVED',requestKind:'CHAT_OR_CONTACT_INVITATION',
      at:previous?.at||now,lastObservedAt:now,reviewRevision:changed?(previous?.reviewRevision||0)+1:previous.reviewRevision||1,
      message:fields.risk==='TRUSTED'?'该 ID 已审核；姓名变化不改变身份。':
        '请勿直接通过请求！先通过原有聊天或其他可信渠道核实。此处未执行接受、拒绝或拦截。'};
  }
  function summary(events){const open=events.filter(e=>e.type==='CONTACT_REQUEST'&&e.status==='OPEN');
    const count=risk=>open.filter(e=>e.risk===risk).length;
    const contact=count('IMPERSONATION_CONTACT'),member=count('IMPERSONATION_MEMBER'),collision=count('NAME_COLLISION'),revoked=count('REVOKED');
    const impersonation=contact+member+collision;
    const risks=['IMPERSONATION_CONTACT','IMPERSONATION_MEMBER','NAME_COLLISION','REVOKED','STRANGER','HISTORICAL_MEMBER','UNREVIEWED','MISSING_ID'];
    const risk=risks.find(value=>count(value)>0);
    // Only generic reasons/counts reach the Teams page; no names or IDs.
    const reasons={
      IMPERSONATION_CONTACT:['与已审核联系人同名，但 Teams ID 不同','与熟人同名，但 ID 不同'],
      IMPERSONATION_MEMBER:['与历史群成员同名，但 Teams ID 不同','与群成员同名，但 ID 不同'],
      NAME_COLLISION:['与已有人员记录同名，但 Teams ID 不同','姓名相同，但 ID 不同'],
      REVOKED:['这个 Teams ID 已被你撤销信任','此账号已被撤销信任'],
      STRANGER:['这个 Teams ID 首次出现，尚未核实身份','首次出现的 ID，尚未核实'],
      HISTORICAL_MEMBER:['曾在群中出现，不代表身份已经可信','历史群成员，身份尚未核实'],
      UNREVIEWED:['已有观察记录，但身份尚未审核通过','已记录，身份仍未核实'],
      MISSING_ID:['请求者 ID 或请求类型证据不足，暂时无法判断','ID 或请求类型尚无法确认']};
    return {pending:open.length,impersonation,contact,
      headline:contact?`疑似冒充熟人 · ${contact} 人待核实`:impersonation?`同名不同 ID · ${impersonation} 人待核实`:
        revoked?`撤销信任账号 · ${revoked} 人待核实`:open.length?(open.every(e=>e.risk==='MISSING_ID')?`请求界面待确认 · ${open.length} 条`:`陌生联系请求 · ${open.length} 条待核实`):'',
      reason:reasons[risk]?.[0]||'',compactReason:reasons[risk]?.[1]||'',
      advice:open.length?(risk==='MISSING_ID'?'请先核实，暂勿通过。':'核实前请勿通过请求，请经原有聊天或可信渠道确认。'):'',
      priority:!open.length?'NONE':contact?'CRITICAL':impersonation||revoked?'HIGH':'REVIEW'};
  }
  return {normalize,validMRI,labels,classify,evolve,summary};
});
