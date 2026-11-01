/* Pure, shared parsing / policy logic. Never consumes message bodies or auth headers. */
(function(root, factory){const v=factory();if(typeof module==='object'&&module.exports)module.exports=v;root.TGSLogic=v;})(globalThis,()=>{
  const MAX_MEMBERS=3000;
  // Teams names are display-only, but invisible bidi controls can disguise
  // what an administrator sees in an identity-review screen. Do not let them
  // masquerade as real characters in names, IDs or thread keys.
  const UNSAFE_FORMAT=/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
  const INVALID_ID=/[\s<>\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
  const clean=(s,n=180)=>typeof s==='string'?s.replace(UNSAFE_FORMAT,' ').trim().slice(0,n):'';
  const personId=s=>typeof s==='string'&&s.length>0&&s.length<=512&&!INVALID_ID.test(s);
  const threadId=s=>typeof s==='string'&&s.length<600&&!INVALID_ID.test(s)&&/^19:[^\s]{1,520}@thread(?:\.[\w-]+)?$/i.test(s);
  const goodName=(s,id='')=>{const n=clean(s,120);return n&&!n.includes('@thread')&&n!==id&&!/^(?:8:live:cid\.|8:|28:)/i.test(n)?n:'';};
  // longTitle is a GROUP caption, not a verified ID-to-name table.
  // Expose candidates without claiming that their order matches members[].
  function titleNameHints(s){
    const text=goodName(s);if(!text)return [];
    const parts=text.split(/[,，、;；\n]+/).map(x=>clean(x,120)).filter(Boolean);
    return parts.length>=2&&parts.length<=MAX_MEMBERS? [...new Set(parts)].slice(0,120):[];
  }
  function nameFromProfile(e){
    if(!e||typeof e!=='object')return '';
    const id=e.id||e.mri||e.userId||e.skypeId||e.contactId||e.userMri||e.memberMri||'';
    for(const obj of [e,e.profile,e.user,e.person,e.details,e.contact,e.properties,e.userProfile,e.profileInfo,e.contactInfo,e.value,e.data,e.memberProfile]){
      if(!obj||typeof obj!=='object')continue;
      const foreignId=obj.id||obj.mri||obj.userId||obj.skypeId||obj.contactId||obj.userMri||obj.memberMri||obj.personId;
      // Never join an embedded profile that explicitly points at another ID.
      if(foreignId && id && foreignId!==id)continue;
      for(const name of [obj.displayName,obj.friendlyName,obj.fullName,obj.name,obj.title,obj.nickname,obj.display_name,obj.formattedName,obj.userDisplayName,obj.contactName,obj.profileName,obj.contactDisplayName]){
        const result=goodName(name,id);if(result)return result;
      }
    }
    return '';
  }
  function shortId(id){return typeof id==='string'?(id.length>22?id.slice(0,11)+'…'+id.slice(-7):id):'';}
  function findName(member, avatars){
    const id=member?.id||member?.mri||'';
    const direct=nameFromProfile(member);
    if(direct) return {name:direct,source:'members'};
    for(const av of avatars){
      const uid=av?.id||av?.mri||av?.userId||av?.skypeId||av?.userMri||av?.memberMri;
      if(uid===id){const label=nameFromProfile(av);if(label)return {name:label,source:'avatarUsersInfo'};}
    }
    return {name:'',source:'unresolved'};
  }
  function parseRecord(rec){
    if(!rec||typeof rec!=='object'||!threadId(rec.id))return {skip:'notGroup'};
    if(!Array.isArray(rec.members))return {skip:'noMembers'};
    if(rec.members.length<3&&!rec.isGroupChat&&!rec.isGroup)return {skip:'notGroup'};
    if(rec.members.length>MAX_MEMBERS||rec.isConversationMembersTruncated===true)return {skip:'unsafeRoster'};
    const ids=new Set(),members=[];
    const avatars=Array.isArray(rec.avatarUsersInfo)?rec.avatarUsersInfo.slice(0,MAX_MEMBERS):[];
    // Avoid an O(members * avatars) identity lookup for large Teams groups.
    // Only take an avatar label when its own full ID matches exactly.
    const avatarNames=new Map();
    for(const av of avatars){
      const avatarId=av?.id||av?.mri||av?.userId||av?.skypeId||av?.userMri||av?.memberMri;
      if(!personId(avatarId)||avatarNames.has(avatarId))continue;
      const avatarName=nameFromProfile(av);
      if(avatarName)avatarNames.set(avatarId,avatarName);
    }
    for(const m of rec.members){const id=m?.id||m?.mri;
      if(!personId(id)||ids.has(id))return {skip:'unsafeRoster'};
      ids.add(id);
      const direct=nameFromProfile(m);
      members.push({id,name:direct||avatarNames.get(id)||'',
        nameSource:direct?'members':avatarNames.has(id)?'avatarUsersInfo':'unresolved'});
    }
    const count=rec.conversationMembersTotalCount;
    const offset=Number.isInteger(count)&&count>=0?members.length-count:null;
    if(offset!==null&&offset!==0&&offset!==1)return {skip:'unsafeRoster'};
    const quality=rec.isConversationMembersTruncated===false&&offset!==null?'CACHE_CONSISTENT':'CACHE_OBSERVED';
    const explicit=goodName(rec.topic||rec.threadProperties?.topic||rec.conversationProperties?.topic||rec.title||'',rec.id);
    const longTitle=goodName(rec.longTitle||rec.shortTitle||'',rec.id);
    return {id:rec.id,title:explicit,longTitle,titleNameHints:titleNameHints(longTitle),quality,countOffset:offset,members};
  }
  function parseDirectRecord(rec){
    if(!rec||!threadId(rec.id)||!Array.isArray(rec.members)||rec.members.length!==2||
      rec.isGroupChat===true||rec.isGroup===true||rec.isConversationMembersTruncated===true||
      rec.topic||rec.threadProperties?.topic||rec.conversationProperties?.topic)return null;
    const kind=String(rec.conversationType||rec.threadType||rec.type||'');
    if(/group|meeting/i.test(kind)||!(rec.isGroupChat===false||rec.isGroup===false||
      /^(?:direct|p2p|one[\s_-]?to[\s_-]?one|oneonone|1[\s:_-]?1)$/i.test(kind)))return null;
    if(rec.conversationMembersTotalCount!=null&&rec.conversationMembersTotalCount!==2)return null;
    const ids=rec.members.map(m=>m?.id||m?.mri);
    return ids.every(personId)&&ids[0]!==ids[1]?{id:rec.id,memberIds:ids}:null;
  }
  function delta(before,after){const a=new Set(before||[]),b=new Set(after||[]);
    return {added:[...b].filter(x=>!a.has(x)),missing:[...a].filter(x=>!b.has(x))};}
  function classifyChange(before,after){
    if(!before)return {kind:'BASELINE',added:[],missing:[]};
    const d=delta(before,after);
    if(d.added.length&&d.missing.length)return {...d,kind:'AMBIGUOUS_REPLACEMENT'};
    if(d.missing.length)return {...d,kind:'AMBIGUOUS_SHRINK'};
    return {...d,kind:d.added.length?'OBSERVED_ADDITION':'UNCHANGED'};
  }
  function isCompanyCandidate(name,policy){if(!policy?.aaEnabled||!goodName(name))return false;
    const n=clean(name,120).normalize('NFKC').toUpperCase();
    return (policy.aaPrefixes||[]).some(s=>{const p=clean(s,30).normalize('NFKC').toUpperCase();return !!p&&(policy.aaMode==='contains'?n.includes(p):n.startsWith(p));});}
  function alertLevel({level='STANDARD',status='NEW',companyApproved=false,companyCandidate=false},policy){
    if(level==='CRITICAL')return 'CRITICAL';
    if(status==='REVOKED')return 'HIGH';
    if(status==='NEW')return level==='QUIET'?'REVIEW':'HIGH';
    // Already-approved people can still be in the wrong group.
    // QUIET remains an explicit user-defined suppression; STANDARD transfers remain visible.
    return level==='QUIET'?'SILENT':'INFO';
  }
  function groupLabel(group,peopleMap){
    if(group.alias)return group.alias;
    if(group.title)return group.title;
    if(group.longTitle)return group.longTitle;
    const names=(group.memberIds||[]).map(id=>peopleMap?.get(id)).filter(Boolean).map(p=>p.manualName||p.name).filter(Boolean).slice(0,3);
    return names.length?`成员：${names.join('、')}${group.memberIds.length>3?' 等':''}`:
      `未命名群 · ${group.memberIds?.length||0}人 · ${shortId(group.id)}`;
  }
  function validatePolicy(p){return {aaEnabled:p?.aaEnabled!==false,aaMode:p?.aaMode==='contains'?'contains':'prefix',
    aaPrefixes:Array.isArray(p?.aaPrefixes)?p.aaPrefixes.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,30)).filter(Boolean).slice(0,12):['AA'],
    quietApprovedAA:p?.quietApprovedAA!==false, sound:p?.sound!==false, notifyUnknown:p?.notifyUnknown!==false,notifyKnownTransfers:p?.notifyKnownTransfers!==false};}
  return {MAX_MEMBERS,clean,personId,threadId,goodName,nameFromProfile,titleNameHints,shortId,parseRecord,parseDirectRecord,delta,classifyChange,isCompanyCandidate,alertLevel,groupLabel,validatePolicy};
});
