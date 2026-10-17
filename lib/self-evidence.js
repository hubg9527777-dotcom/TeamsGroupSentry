/* Optional NON-CREDENTIAL cache shape probes. These shapes may not exist in
 * a Teams build. Results are local identity CLUES for human confirmation,
 * never authenticated identity, automatic account binding or trust approval.
 * No token/cookie/header/message-body fields are read. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TGSSelfEvidence=api;})(globalThis,()=>{
  const valid=id=>typeof id==='string'&&/^(?:8|28|5|4|1):[^\s<>\x00-\x1f]{1,480}$/.test(id);
  const kinds=new Set(['CACHE_OWNER','PROFILE_SELF','OUTGOING_METADATA']);
  const safeStore=name=>typeof name==='string'&&!/auth|token|credential|cookie|secret|session|login/i.test(name);
  function scope(name){const m=/^Teams:[^:]+:(.+)$/i.exec(name||'');return m?m[1]:'';}
  function owner(name){const suffix=scope(name);return valid(suffix)?suffix:'';}
  function profile(row,key){
    const found=new Set();
    // No generic traversal of arbitrary fields or collections. A child needs
    // its own explicit ID; never inherit another person's parent identity.
    const nodes=[row,row?.value,row?.profile,row?.user,row?.value?.profile];
    for(const obj of nodes){if(!obj||typeof obj!=='object'||Array.isArray(obj))continue;
      const marked=obj.isSelf===true||obj.isMe===true||obj.isCurrentUser===true||
        (obj===row&&typeof key==='string'&&/^(?:me|self|currentUser)$/i.test(key));
      if(!marked)continue;
      const ids=[obj.mri,obj.id,obj.userId,obj.skypeId].filter(valid);
      const unique=[...new Set(ids)];if(unique.length===1)found.add(unique[0]);
      else if(unique.length>1)return unique; // propagate conflicts, never pick one
    }
    return [...found];
  }
  function outgoing(row){
    if(row?.isLastMessageFromMe!==true)return '';
    // Optional explicit outgoing marker + sender, not a body/name/creator guess.
    const from=row.lastMessage?.from;return valid(from)?from:'';
  }
  function recommend(evidence,known,{single=false,complete=false}={}){
    if(!single||!complete)return {status:'UNAVAILABLE',reason:'缓存不完整或存在多个账号缓存，未推荐本人 ID'};
    if(Array.isArray(evidence)&&evidence.length>100)return {status:'UNAVAILABLE',reason:'本人线索过多，暂不能安全推荐'};
    const entries=(Array.isArray(evidence)?evidence:[]).filter(e=>e&&valid(e.personId)&&
      kinds.has(e.kind)&&Number.isInteger(e.count)&&e.count>0&&e.count<=6000).slice(0,100);
    const ids=[...new Set(entries.map(e=>e.personId))];
    // Retain contradictory IDs even if one is absent from the group roster.
    if(ids.length>1)return {status:'CONFLICT',reason:'本人身份线索指向不同 ID，不能替你选择'};
    if(!ids.length)return {status:'NOT_FOUND',reason:'当前缓存没有可用的明确本人线索，请勿猜选'};
    if(!known.has(ids[0]))return {status:'UNAVAILABLE',reason:'本人线索未能与本次人员名单对应，请勿猜选'};
    const sources=[...new Set(entries.map(e=>e.kind))];
    const labels={CACHE_OWNER:'会话缓存所属人员 ID',PROFILE_SELF:'本地资料中明确标记为本人',OUTGOING_METADATA:'本地已发送消息的发送者 ID'};
    return {status:'CANDIDATE',personId:ids[0],sources,reason:sources.map(s=>labels[s]).join('；')+'。这是待你确认的本地线索，不是微软身份认证'};
  }
  return {valid,safeStore,scope,owner,profile,outgoing,recommend};
});
