/* UI evidence only. This module never resolves identities or changes trust. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TGSRequestNotice=api;})(globalThis,()=>{
  const safeText=(s,n)=>typeof s==='string'&&s.length<=n&&!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(s);
  function validDetails(ds){return ds===undefined||Array.isArray(ds)&&ds.length<=20&&ds.every(d=>d&&/^[a-f0-9]{64}$/.test(d.key||'')&&
    safeText(d.title,120)&&safeText(d.name,120)&&['CHAT','MEETING'].includes(d.kind)&&typeof d.previewAvailable==='boolean'&&
    (d.officialWarning===undefined||typeof d.officialWarning==='boolean')&&
    (d.origin===undefined||['CACHE','VISIBLE_PREVIEW'].includes(d.origin))&&
    (d.messageStamp===undefined||/^[a-f0-9]{64}$/.test(d.messageStamp))&&
    (d.latestMessage===undefined||d.latestMessage&&safeText(d.latestMessage.author,120)&&!!d.latestMessage.author&&safeText(d.latestMessage.text,300)&&!!d.latestMessage.text)&&Array.isArray(d.messages)&&d.messages.length<=10&&
    d.messages.every(m=>safeText(m.author,120)&&!!m.author&&safeText(m.text,300)&&!!m.text));}
  function detailsOnly(ds){return (ds||[]).map(d=>({key:d.key,title:d.title,name:d.name,kind:d.kind,
    ...(d.origin?{origin:d.origin}:{}),...(d.messageStamp?{messageStamp:d.messageStamp}:{}),
    ...(d.latestMessage?{latestMessage:{author:d.latestMessage.author,text:d.latestMessage.text}}:{}),
    previewAvailable:d.previewAvailable,officialWarning:d.officialWarning===true,messages:d.messages.map(m=>({author:m.author,text:m.text}))}));}
  function valid(o){return !!o&&o.adapter==='TEAMS_REQUEST_SIGNAL_V1'&&typeof o.observed==='boolean'&&
    /^[a-f0-9]{64}$/.test(o.fingerprint||'')&&['BADGE','VISIBLE_ROWS','PANEL','NONE'].includes(o.source)&&
    (o.count===null||Number.isInteger(o.count)&&o.count>=0&&o.count<=9999)&&typeof o.meeting==='boolean'&&(o.selfKeys===undefined||Array.isArray(o.selfKeys)&&o.selfKeys.length<=200&&o.selfKeys.every(k=>/^[a-f0-9]{64}$/.test(k)))&&validDetails(o.details)&&
    (o.observed?(o.count===null||o.count>0)&&o.source!=='NONE':o.count===0&&o.source==='NONE');}
  function evolve(previous,o,now){
    if(!valid(o))throw Error('请求界面观察无效');
    const p=previous||{pending:false,revision:0,handled:[]};
    if(!o.observed)return {...p,pending:false,visible:false,details:[],count:0,source:'NONE',
      fingerprint:o.fingerprint,lastChecked:now,revision:p.revision+(p.pending||p.visible?1:0)};
    // Removing a local UI warning never declares accepted/blocked or trusted.
    const changed=p.fingerprint!==o.fingerprint;
    const handled=Array.isArray(p.handled)?p.handled.slice(-40):[];
    return {...p,fingerprint:o.fingerprint,count:o.count,source:o.source,meeting:o.meeting,
      details:detailsOnly(o.details),visible:true,pending:changed?!handled.includes(o.fingerprint):p.pending,
      revision:p.revision+(changed?1:0),firstObserved:changed?now:p.firstObserved,lastChecked:now,handled};
  }
  function acknowledge(p,revision){
    if(!p||p.revision!==revision)throw Error('请求界面已变化，请重新查看提醒');
    return {...p,pending:false,handled:[...new Set([...(p.handled||[]),p.fingerprint])].slice(-40)};
  }
  function view(p){
    if(!p?.pending||p.visible===false||p.source==='CACHE')return {pending:false};
    const amount=p.count===null?'':` · ${p.count} 条`;
    const items=detailsOnly(p.details),messages=items.flatMap(d=>d.messages.map(m=>`${m.author}：“${m.text}”`));
    const descriptions=items.map(d=>d.kind==='MEETING'?(d.name?`${d.name} 邀请你加入会议聊天`:`会议：${d.title||'名称待读取'}（发起者待核实）`):d.name?`${d.name} 想和你聊天`:`聊天请求：${d.title||'名称待读取'}（发起者待核实）`);
    const detailText=descriptions.map((t,i)=>`${i+1}. ${t}`+(items[i].messages.length?'\n'+items[i].messages.map(m=>`${m.author}：“${m.text}”`).join('\n'):'\n正文暂不可得，请先预览。')).join('\n\n')||'请求详情暂不可得。请在 Teams「请求」中选中请求并预览。';
    const missing=items.some(d=>!d.messages.length)||!items.length;
    const compact=items.slice(0,2).map((d,i)=>{
      const label=d.kind==='MEETING'?'会议：'+(d.title||'名称待获取'):(d.name||d.title||'姓名待获取');
      if(!d.messages.length)return `${i+1}. ${label} · 正文待预览`;
      const m=d.latestMessage||d.messages.at(-1),who=d.kind==='MEETING'||m.author!==label?' · '+m.author+'：':'：';
      return `${i+1}. ${label}${who}“${m.text.slice(0,26)}”`;
    });
    const knownCount=items.length;
    const coverage=p.source==='BADGE'?`入口提示 ${p.count} 条，已获取 ${knownCount} 条详情`:p.source==='VISIBLE_ROWS'?'仅展示当前可见请求，可能还有未显示项':'请求详情尚不完整';
    return {pending:true,revision:p.revision,count:p.count,source:p.source,visible:p.visible,
      headline:(p.meeting&&p.source==='VISIBLE_ROWS'&&p.count===1?'会议聊天请求待核实':'聊天请求待核实')+amount,
      severity:'HIGH',details:items,detailText,
      identityNote:(messages.length?(items.some(d=>d.origin==='CACHE'&&d.messages.length)?'消息内容：已读取本地缓存':'消息内容：已读取可见预览'):'消息内容：尚未读取')+' · 人员 ID：待核实',
      compactReason:compact.length?compact.join('\n')+(knownCount>2?`\n另有 ${knownCount-2} 条，展开查看`:'')+(missing?'\n先预览，核实后再接受':''):'详情待获取 · 先预览，核实后再接受',
      reason:(p.visible===false?'当前页面未显示，处理状态未知 · ':'')+coverage,
      advice:'核实身份后再决定是否接受。\n切勿共享账号信息或授权登录。'+(missing?'\n先点「预览他们的消息」查看，不要为看消息直接点「接受」。':''),
      firstObserved:p.firstObserved};
  }
  return {valid,detailsOnly,evolve,acknowledge,view};
});
