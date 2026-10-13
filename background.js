/* TeamsGroupSentry public release v1.0.0 — local only. No token values stored/replayed, no member removal.
   No MAIN-world identity or member payload is trusted. Missing account hints require explicit local scope approval. */
importScripts('lib/logic.js','lib/db.js','lib/recovery.js','lib/backup-diff.js');
const L=globalThis.TGSLogic,D=globalThis.TGSDB,R=globalThis.TGSRecovery,B=globalThis.TGSBackupDiff;
const ALARM='sentry-v3-poll';
const SCAN_HEALTH_KEY='tgs-v3-scan-health';
const SCAN_STALE_MS=180000; // Chrome may delay MV3 alarms while backgrounded.
let pendingTabScan=null;
const BUILD_VERSION='1.0.0', UPGRADE_KEY='upgrade-safety';
// Public semver reset does not change the IndexedDB schema or account partition IDs.
let preparationPromise=null;
// Fail closed on database mutation if the pre-upgrade recovery point cannot be saved.
function ensureUpgradeReady(){
  if(preparationPromise)return preparationPromise;
  preparationPromise=(async()=>{
    const prior=await D.getMeta(UPGRADE_KEY);
    if(prior?.version===BUILD_VERSION&&prior.ready===true)return prior;
    const existingGroups=await D.getAll('groups');
    const existingPeople=await D.getAll('people');
    const existingEvents=await D.getAll('events');
    let checkpoint=null;
    if(existingGroups.length||existingPeople.length||existingEvents.length){
      checkpoint=await R.capture(D,{label:'升级前自动恢复点',version:BUILD_VERSION,sourceVersion:prior?.version||'早期内部版本'});
      if(!checkpoint?.ok||checkpoint.empty)throw new Error('升级前恢复点创建失败，已禁止修改旧数据');
    }
    const marker={pk:UPGRADE_KEY,version:BUILD_VERSION,ready:true,at:Date.now(),
      checkpointId:checkpoint?.id||'',previousVersion:prior?.version||'旧版本',
      existingGroups:existingGroups.length,existingPeople:existingPeople.length};
    await D.putMeta(marker);
    return marker;
  })().catch(e=>{preparationPromise=null;throw e;});
  return preparationPromise;
}
async function requirePrepared(){
  try{return await ensureUpgradeReady();}
  catch(e){throw new Error('数据升级保护未就绪，已暂停写入：'+bound(e?.message||String(e),120));}
}

const GUARD_STATE_KEY='tgs-v33-guard-state',GUARD_SEEN_KEY='tgs-v33-guard-seen';
const OVERLAY_MODES=new Set(['always','alerts','hidden']);
const DEFAULT_OVERLAY={mode:'always',compact:true,offset:'top'};
let queue=Promise.resolve(), lastIngest=null, soundCreation=null;
const serial=fn=>{const p=queue.then(fn,fn);queue=p.catch(()=>{});return p;};
const bound=(s,n)=>typeof s==='string'?s.slice(0,n):'';
// Keep an explicitly resolved name from being overwritten by a weaker cache hint.
const NAME_SOURCE_PRIORITY=Object.freeze({
  'Teams 用户资料缓存':90,'Teams 联系人缓存':70,
  members:60,avatarUsersInfo:55,'Teams 会话元数据':40,cache:20,unresolved:0
});
function sourcePriority(source){return NAME_SOURCE_PRIORITY[source]||0;}
function mayUpdateName(person,name,source){
  if(!name)return false;
  if(!person.name)return true;
  if(person.name===name)return sourcePriority(source)>sourcePriority(person.nameSource);
  return sourcePriority(source)>=sourcePriority(person.nameSource);
}

// The popup, Teams in-page indicator, and toolbar badge must use one consistent
// account-safe snapshot. Do not cache independent copies of pending counts.
function safeOverlayPrefs(p){return {mode:OVERLAY_MODES.has(p?.mode)?p.mode:'always',compact:p?.compact!==false,
  offset:p?.offset==='below'?'below':'top'};}
async function overlayPrefs(){const x=await chrome.storage.local.get('overlayPrefs');return safeOverlayPrefs(x.overlayPrefs||DEFAULT_OVERLAY);}
async function broadcastOverlay(){try{const tabs=await chrome.tabs.query({url:'https://teams.live.com/*'});
  await Promise.all(tabs.slice(0,12).map(tab=>chrome.tabs.sendMessage(tab.id,{action:'OVERLAY_REFRESH'}).catch(()=>{})));
}catch{}}

async function hash(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function init(){
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  if(!(await chrome.alarms.get(ALARM)))await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
  await D.open();
  await ensureUpgradeReady();
  try{await navigator.storage?.persist?.();}catch{}
  await migrateOldPreferences();
  // Repaint toolbar after a service worker / browser restart (no stale badge).
  await refreshBadge();
}
chrome.runtime.onInstalled.addListener(()=>serial(()=>init()).catch(console.error));
chrome.runtime.onStartup.addListener(()=>serial(()=>init()).catch(console.error));
chrome.alarms.onAlarm.addListener(a=>{if(a.name!==ALARM)return;
  // Failed/absent Teams tabs still age the health indicator into STALE.
  scanTabs(false).catch(()=>{}).finally(()=>refreshBadge().catch(()=>{}));
});
chrome.notifications.onClicked.addListener(id=>{if(id.startsWith('tgs-v3-'))
  chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html?page=events')}).catch(()=>{});});
async function migrateOldPreferences(){
  // v2.5 snapshots are left untouched and can still be backed up with v2.5.
  // The first v3 scan establishes its own baseline without generating events.
  if(!(await D.getMeta('v3-origin'))){await D.putMeta({pk:'v3-origin',from:'v2.5',at:Date.now(),note:'原数据未清除；v3 首次观测建立独立基线'});}
}
// Identity binding MUST be anchored to a previously created/explicitly accepted local account.
// Merely base64-decoding an arbitrary JWT does not establish authenticity.
function cleanMRI(id){return typeof id==='string' && /^\d+:[^\s<>]{1,480}$/.test(id)?id:'';}
// A browser-cache scope is NOT proof of Microsoft authentication. It can only
// renew a binding that the user explicitly approved, and only when the current
// independent ISOLATED roster strongly matches that account's stored baseline.
// This stops an incomplete single roster from leaving a known account forever
// READ_ONLY while preventing an unknown account from inheriting another baseline.
async function rosterContinuity(rows,account){
  const recorded=await D.getAllFor('groups',account);
  if(recorded.length<10||!Array.isArray(rows)||rows.length<10)return {ok:false,compared:0,reason:'没有足够的既有群组供安全确认'};
  const base=new Map(recorded.filter(g=>L.threadId(g.id)&&Array.isArray(g.memberIds)).map(g=>[g.id,g]));
  const current=new Map(rows.filter(g=>L.threadId(g?.id)&&Array.isArray(g.members)&&g.members.length>=3)
    .map(g=>[g.id,g]));
  let matched=0,consistent=0;
  for(const [id,g] of current){
    const old=base.get(id);if(!old)continue;
    matched++;
    const oldIds=new Set(old.memberIds.filter(x=>L.personId(x)));
    const freshIds=new Set(g.members.map(x=>x.id).filter(x=>L.personId(x)));
    if(oldIds.size<3||freshIds.size<3)continue;
    let shared=0;for(const m of oldIds)if(freshIds.has(m))shared++;
    if(shared/Math.max(oldIds.size,freshIds.size)>=0.60)consistent++;
  }
  const comparable=Math.min(base.size,current.size);
  // Scope continuity is *not* based on one cherry-picked group.
  return {ok:matched>=10&&matched/comparable>=0.80&&consistent/matched>=0.80,
    compared:matched,consistent,reason:'本地缓存群组或成员关系与已绑定账号不一致'};
}
async function cacheScopeKey(p){
  const name=p?.dbName;
  if(typeof name!=='string'||!/^Teams:conversation-manager:/i.test(name)||name.length>700)return '';
  return 'account-cache-scope:'+(await hash(name)).slice(0,32);
}
async function resolveIdentity(p){
  const observed=cleanMRI(p.accountHint),claim=p.tokenIdentity&&typeof p.tokenIdentity==='object'?p.tokenIdentity:{};
  const tokenMRI=cleanMRI(claim.mri);
  const active=await D.getMeta('active');
  if(observed&&tokenMRI&&observed!==tokenMRI)
    return {mode:'READ_ONLY',account:'',reason:'账号身份线索冲突，禁止跨账号基线比对',canBind:false};
  const scopeKey=await cacheScopeKey(p);
  const linked=scopeKey?await D.getMeta(scopeKey):null;
  // The same browser cache scope must not silently cross two distinct account
  // partitions after an explicit identity switch. Require a new independent ID.
  if(!observed&&linked?.approved===true&&active?.account&&active.account!==linked.account)
    return {mode:'READ_ONLY',account:'',reason:'同一浏览器缓存关联了不同账号，缺少可独立确认的当前身份',canBind:false};
  let candidate='',anchored=false,usingActive=false,legacyLink='',legacyUnlinked=false,identityLinkKey='';
  if(observed){
    const digest=(await hash(observed)).slice(0,32);identityLinkKey='identity-link:'+digest;
    const link=await D.getMeta(identityLinkKey);
    candidate=typeof link?.account==='string'&&/^(?:verified|provisional|manual):[a-f0-9]{32}$/.test(link.account)
      ?link.account:'verified:'+digest;
    anchored=true;
    // An explicit observed MRI can establish a distinct user partition even if
    // multiple users share a browser database; never auto-rebind the scope.
  }
  else if(tokenMRI){candidate='verified:'+(await hash(tokenMRI)).slice(0,32);}
  else if(linked?.approved===true&&typeof linked.account==='string'&&
          /^(?:verified|manual|provisional):[a-f0-9]{32}$/.test(linked.account)){
    candidate=linked.account;
  }
  else if(active?.account){candidate=active.account;usingActive=true;}
  else {
    const {manualProfile=''}=await chrome.storage.local.get('manualProfile');
    const dbName=bound(p.dbName,700);
    if(manualProfile)candidate='manual:'+(await hash(manualProfile)).slice(0,32);
    else if(/^Teams:conversation-manager:/i.test(dbName))candidate='provisional:'+(await hash(dbName)).slice(0,32);
  }
  let meta=candidate?await D.getMeta('account:'+candidate):null;
  let existing=!!meta && ((await D.getAllFor('groups',candidate)).length>0||meta.manualBound===true);
  // Do not silently reuse an old provisional partition for a newly identified ID.
  if(observed&&!existing&&active?.account&&/^(?:manual|provisional):[a-f0-9]{32}$/.test(active.account)){
    const oldRows=await D.getAllFor('groups',active.account);
    if(oldRows.length){legacyLink=active.account;legacyUnlinked=true;candidate=active.account;meta=await D.getMeta('account:'+candidate);
      existing=true;usingActive=true;}
  }
  const binding=!!meta&&(meta.verified===true||meta.manualBound===true);
  const sameToken=!(meta?.tokenSubjectHash && p.tokenIdentity?.oid &&
    meta.tokenSubjectHash!==(await tokenSubjectFingerprint(p.tokenIdentity)));
  const continuity=existing&&!observed&&!p.stats?.partial
    ?await rosterContinuity(p.rows,candidate):{ok:false,compared:0};
  const scopeApproved=!!scopeKey&&linked?.approved===true&&linked.account===candidate;
  // The exact-MRI path is unchanged. Missing MRIs use a separate, explicit
  // *previously user-approved* scope binding plus a strong roster continuity gate.
  const trustedScope=!observed&&scopeApproved&&binding&&continuity.ok;
  const writable=(anchored||trustedScope)&&existing&&binding&&sameToken&&!legacyUnlinked;
  const canBind=!!candidate&&sameToken&&(
    !!observed || (!p.stats?.partial&&existing&&binding&&!!scopeKey&&continuity.ok&&!linked?.approved));
  return {mode:writable?'WRITE':'READ_ONLY',account:sameToken?candidate:'',scopeKey,
    reason:writable?'已匹配本地已确认的账号范围与群组基线（非服务器身份认证）':
      !candidate?'无法确定当前账号':
      !sameToken?'当前账号身份线索与绑定记录冲突':
      legacyUnlinked?'当前身份与旧版账号分区尚未人工关联，禁止写入原基线':
      !existing?'当前身份尚未绑定本地基线':
      !observed&&!continuity.ok?continuity.reason||'缓存与基线无法安全对应，继续只读保护':
      !observed&&!scopeApproved?'账号缺少唯一身份线索：请确认一次当前缓存与已有基线的关联':
      !binding?'本地账号未批准绑定，暂不写入基线':
      '无法确认账号，暂不写入基线',
    canBind,usingActive,observed,existing,legacyLink,identityLinkKey,
    continuityCompared:continuity.compared||0};
}

async function tokenSubjectFingerprint(claim){
  if(!claim||typeof claim!=='object'||typeof claim.oid!=='string'||!claim.oid||claim.oid.length>100)return '';
  const fields=['iss','aud','tid','oid'];
  return (await hash(fields.map(key=>typeof claim[key]==='string'?claim[key].slice(0,256):'').join('\u001f'))).slice(0,32);
}
async function sessionGuard(){try{return (await chrome.storage.session.get(GUARD_STATE_KEY))[GUARD_STATE_KEY]||null;}catch{return null;}}
async function saveGuard(state){await chrome.storage.session.set({[GUARD_STATE_KEY]:state});}
async function readOnlyAudit(p,identity){
  const account=identity.account,recorded=account?await D.getAllFor('groups',account):[];
  const byId=new Map(recorded.map(g=>[g.id,g]));
  const people=new Map((account?await D.getAllFor('people',account):[]).map(person=>[person.id,person]));
  const policy=account?await D.getPolicy(account):L.validatePolicy({});
  const prior=(await chrome.storage.session.get(GUARD_SEEN_KEY))[GUARD_SEEN_KEY]||[];
  const recent=new Map(prior.filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isFinite(x[1])&&Date.now()-x[1]<86400000));
  let compared=0,observedAdded=0,ambiguous=0,notifyCount=0,critical=0,unknown=0;
  const ambiguousGroupIds=[];
  for(const row of p.rows){
    if(!L.threadId(row?.id)||!Array.isArray(row?.members)||row.members.length<3||row.members.length>L.MAX_MEMBERS||
       !['CACHE_OBSERVED','CACHE_CONSISTENT'].includes(row.quality))continue;
    const previous=byId.get(row.id);if(!previous)continue;
    const ids=row.members.map(m=>m.id);
    if(ids.some(id=>!L.personId(id))||new Set(ids).size!==ids.length)continue;
    compared++;
    const diff=L.classifyChange(previous.memberIds,ids);
    const unsafe=previous.countOffset!==row.countOffset||
      (previous.quality==='CACHE_CONSISTENT'&&row.quality!=='CACHE_CONSISTENT');
    // A shrink-only observation is ambiguous even without any *new* ID.
    // Count it for the yellow notice, but do not notify it as a new join.
    if(unsafe||diff.missing.length>0){ambiguous++;ambiguousGroupIds.push(row.id);}
    if(!diff.added.length)continue;
    for(const id of diff.added){
      const fingerprint=(await hash(account+'\u001f'+row.id+'\u001f'+id+'\u001f'+(unsafe?'uncertain':diff.kind))).slice(0,40);
      if(recent.has(fingerprint))continue;
      recent.set(fingerprint,Date.now());observedAdded++;
      const gLevel=previous.level||'STANDARD';
      const person=people.get(id);
      const severity=L.alertLevel({level:gLevel,status:person?.status||'NEW',companyApproved:person?.companyApproved===true},policy);
      if(severity==='CRITICAL')critical++;
      if(!person)unknown++;
      if(severity==='CRITICAL'||(severity==='HIGH'&&policy.notifyUnknown)||
         (severity==='REVIEW'&&policy.notifyUnknown)||(severity==='INFO'&&policy.notifyKnownTransfers))notifyCount++;
    }
  }
  // Volatile deduplication only: no IndexedDB group/person/edge/event/meta writes in this branch.
  await chrome.storage.session.set({[GUARD_SEEN_KEY]:[...recent.entries()].slice(-300)});
  const state={mode:'READ_ONLY',reason:identity.legacyLink?'发现旧版未验证账号分区：仅只读比对；请确认绑定后沿用原有群组基线':identity.reason,account:account||'',canBind:identity.canBind,
    identityLinkKey:identity.legacyLink?identity.identityLinkKey:'',
    scopeKey:identity.canBind?identity.scopeKey||'':'',
    inspected:p.rows.length,compared,observedAdded,ambiguous,ambiguousGroupIds,unknown,critical,notifyCount,at:Date.now(),
    scanTrigger:['CACHE_WRITE','PERIODIC','REQUESTED'].includes(p.trigger)?p.trigger:'UNKNOWN',
    noBaseline:recorded.length===0,readerDegraded:identity.readerDegraded===true};
  await saveGuard(state);
  // A foreground/cache-change scan must update telemetry too, even if no alarm
  // requested it. Incomplete roster reads must not count as healthy scans.
  const incomplete=identity.readerDegraded===true;
  await recordScanResult({ok:!incomplete,error:incomplete?state.reason:''});
  await refreshBadge();
  // Incomplete scans are diagnostic-only: never notify a supposed new member.
  if(notifyCount&&!p.stats?.partial)await notifyChanges({observedAdded,unknown,critical,notifyCount},policy);
  await broadcastOverlay();
  return {ok:true,readOnly:true,guardReason:state.reason,scanned:p.rows.length,
    compared,observedAdded,ambiguous,critical,unknown,notifyCount,noBaseline:state.noBaseline,
    incomplete};
}
async function scanHealth(){
  try{return (await chrome.storage.session.get(SCAN_HEALTH_KEY))[SCAN_HEALTH_KEY]||{};}
  catch{return {};}
}
async function recordScanResult(result,attemptStartedAt=Date.now()){
  try{
    const previous=await scanHealth(),now=Date.now();
    const ok=result?.ok===true && result?.incomplete!==true;
    // A late failed alarm must never turn a newer foreground success yellow.
    if(!ok && previous.successAt && previous.successAt>attemptStartedAt)return;
    await chrome.storage.session.set({[SCAN_HEALTH_KEY]:{
      at:now,successAt:ok?now:(previous.successAt||0),
      failedConsecutive:ok?0:Math.min(99,(previous.failedConsecutive||0)+1),
      lastError:ok?'':bound(result?.error||result?.guardReason||'Teams 页面未返回有效巡检结果',150),
      lastErrorAt:ok?0:now
    }});
  }catch{} // Failure to write telemetry must never break roster scanning.
}
function messageWithin(tabId,ms){
  // Bound the wait: a suspended/broken content-script reader must not leave
  // the badge stuck forever or cause overlapping expensive alarms.
  let timer;
  const waiting=chrome.tabs.sendMessage(tabId,{action:'SCAN',force:true});
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Teams 页面本地缓存读取超时')),ms);});
  return Promise.race([waiting,timeout]).finally(()=>clearTimeout(timer));
}
async function scanTabs(force){
  if(pendingTabScan)return pendingTabScan;
  pendingTabScan=(async()=>{
    const attemptStartedAt=Date.now();
    let result;
    try{
      const tabs=await chrome.tabs.query({url:'https://teams.live.com/*'});
      if(!tabs.length)result={ok:false,error:'没有打开 Teams 网页标签；打开 Teams 后自动恢复巡检'};
      else{
        const sorted=[...tabs].filter(t=>Number.isInteger(t.id))
          .sort((a,b)=>Number(b.active===true)-Number(a.active===true));
        let failure='Teams 页面尚未响应，请刷新 Teams 网页后重试';
        for(const tab of sorted.slice(0,2)){
          try{
            const res=await messageWithin(tab.id,60000);
            if(res?.ok){result=res;break;}
            failure=bound(res?.error,150)||failure;
          }catch(e){failure=bound(e?.message,150)||failure;}
        }
        if(!result)result={ok:false,error:failure};
      }
    }catch(e){result={ok:false,error:'无法访问 Teams 标签：'+bound(e?.message,110)};}
    await recordScanResult(result,attemptStartedAt);
    if(!result.ok || result.incomplete)await refreshBadge().catch(()=>{});
    return result;
  })().finally(()=>{pendingTabScan=null;});
  return pendingTabScan;
}
function validate(payload){
  // Keep the privileged worker's trust boundary small even if the page cache
  // contains malformed or unexpectedly huge values.
  // Do not accept legacy MAIN-world scan payloads. The content script's
  // ISOLATED reader is the sole allowed producer of member rosters.
  if(payload?.trustedReader!=='ISOLATED'||payload?.accountHintSource!=='ROSTER_INTERSECTION'||
     payload?.tokenIdentity!=null)return false;
  if(!payload||!Array.isArray(payload.rows)||payload.rows.length>6000||!payload.stats||
    !Number.isFinite(payload.at)||Math.abs(Date.now()-payload.at)>120000||
    !Number.isInteger(payload.stats.databases)||payload.stats.databases<1||payload.stats.databases>8)return false;
  if(typeof payload.dbName!=='string'||payload.dbName.length>700||!/^Teams:conversation-manager:/i.test(payload.dbName))return false;
  if(typeof payload.stats.partial!=='boolean' || !Number.isInteger(payload.stats.records) ||
     payload.stats.records<0||payload.stats.records>20001)return false;
  let totalMembers=0;
  for(const r of payload.rows){
    if(!r||typeof r!=='object'||!Array.isArray(r.members)||
      r.members.length>L.MAX_MEMBERS || !L.threadId(r.id) ||
      !['CACHE_OBSERVED','CACHE_CONSISTENT'].includes(r.quality) ||
      (r.countOffset!==null&&r.countOffset!==0&&r.countOffset!==1) ||
      (r.title!==undefined&&(typeof r.title!=='string'||r.title.length>180)) ||
      (r.longTitle!==undefined&&(typeof r.longTitle!=='string'||r.longTitle.length>180)))return false;
    if(!r.members.every(m=>m&&L.personId(m.id)&&
      (m.name===undefined||(typeof m.name==='string'&&m.name.length<=120))&&
      (m.nameSource===undefined||(typeof m.nameSource==='string'&&m.nameSource.length<=36))))return false;
    totalMembers+=r.members.length;
    if(totalMembers>250000)return false;
  }
  if(payload.nameHints!=null&&(!Array.isArray(payload.nameHints)||payload.nameHints.length>16000))return false;
  return true;
}
function addEvent(tx,account,data){
  const id=crypto.randomUUID(),rec={...data,pk:D.pk(account,id),id,account,status:data.severity==='SILENT'?'LOGGED':'OPEN',at:Date.now()};
  tx.objectStore('events').put(rec);return rec;
}
async function applyBatch(rows,account,policy,initialBaseline){
  // Transactional group/person/event updates. An alarm can never interleave a whitelist edit mid-transaction.
  return D.transaction(['groups','people','edges','events'],'readwrite',async tx=>{
    const groups=tx.objectStore('groups'), people=tx.objectStore('people'), edges=tx.objectStore('edges');
    let groupsChanged=0, observedAdded=0, unknown=0, critical=0, notifyCount=0, ambiguous=0, bootstrapped=0;
    for(const row of rows){
      if(!L.threadId(row?.id)||!Array.isArray(row.members)||!row.members.length||row.members.length>L.MAX_MEMBERS||
        !['CACHE_OBSERVED','CACHE_CONSISTENT'].includes(row.quality))continue;
      const ids=[], memberInfos=new Map();let invalid=false;
      for(const m of row.members){if(!L.personId(m?.id)||memberInfos.has(m.id)){invalid=true;break;}
        ids.push(m.id);memberInfos.set(m.id,{name:L.goodName(m.name,m.id),source:bound(m.nameSource,30)});}
      if(invalid)continue;
      const gpk=D.pk(account,row.id),old=await D.request(groups.get(gpk));
      const diff=L.classifyChange(old?.memberIds,ids);
      const qualityDowngrade=old?.quality==='CACHE_CONSISTENT'&&row.quality==='CACHE_OBSERVED';
      const countRulesChanged=old && old.countOffset!==row.countOffset;
      const uncertain=old && (qualityDowngrade||countRulesChanged||diff.kind.startsWith('AMBIGUOUS'));
      const group=old||{pk:gpk,account,id:row.id,alias:'',title:'',longTitle:'',titleNameHints:[],level:'STANDARD',
        memberIds:[],firstSeen:Date.now(),stability:0,ambiguous:false};
      if(L.goodName(row.title,row.id))group.title=bound(row.title,180);
      if(L.goodName(row.longTitle,row.id))group.longTitle=bound(row.longTitle,180);
      group.titleNameHints=L.titleNameHints(group.longTitle); // group-level names; NOT automatically tied to member IDs
      group.lastObservedAt=Date.now();group.lastSnapshotCount=ids.length;
      if(!old){group.memberIds=ids;group.quality=row.quality;group.countOffset=row.countOffset;
        group.stability=1;group.ambiguous=false;group.lastCacheChangeAt=Date.now();bootstrapped++;}
      else if(uncertain){group.ambiguous=true;group.ambiguousReason=qualityDowngrade?'名单可信等级下降':countRulesChanged?'成员计数口径变化':'名单出现减少或替换';
        // Preserve the old baseline. A separate, bounded candidate roster is
        // reviewable but is NEVER adopted without a verified account and user action.
        const previousRoster=new Set(group.pendingRosterIds||[]);
        if(!Array.isArray(group.pendingRosterIds)||group.pendingRosterIds.length!==ids.length||
           !ids.every(id=>previousRoster.has(id))||group.pendingQuality!==row.quality||
           group.pendingCountOffset!==row.countOffset){group.pendingRevision=crypto.randomUUID();}
        group.pendingRosterIds=[...ids];group.pendingQuality=row.quality;
        group.pendingCountOffset=row.countOffset;group.pendingSnapshotAt=Date.now();
        const beforeCandidates=new Set(group.observedCandidateIds||[]);
        const freshCandidates=diff.added.filter(x=>!beforeCandidates.has(x));
        group.observedCandidateIds=[...new Set([...beforeCandidates,...diff.added])].slice(-100);
        group.lastCacheChangeAt=Date.now();ambiguous++;
        // Mixed replacement is not a verified join, but a brand-new ID must not go unnoticed.
        const shouldWarn=(!group.ambiguousNotifiedAt && group.level==='CRITICAL') ||
          (freshCandidates.length>0 && (group.level==='CRITICAL'||policy.notifyUnknown));
        if(shouldWarn){
          const severe=group.level==='CRITICAL'?'CRITICAL':'REVIEW';
          addEvent(tx,account,{groupId:row.id,personId:null,type:'ROSTER_UNCERTAIN',quality:'CACHE_OBSERVED',
            severity:severe,message:'缓存名单存在减少/替换并出现新的成员 ID，无法确认真实进出；请人工核实'});
          group.ambiguousNotifiedAt=Date.now();if(severe==='CRITICAL')critical++;notifyCount++;
        }
      }else{
        group.memberIds=ids;group.quality=row.quality;group.countOffset=row.countOffset;
        group.stability=Math.min(100,(group.stability||1)+1);group.ambiguous=false;
        group.observedCandidateIds=[];group.ambiguousNotifiedAt=0;
        delete group.ambiguousReason;delete group.pendingRosterIds;delete group.pendingRevision;
        delete group.pendingQuality;delete group.pendingCountOffset;delete group.pendingSnapshotAt;
        if(diff.added?.length)group.lastCacheChangeAt=Date.now();groupsChanged+=diff.added?.length?1:0;
      }
      groups.put(group);
      const acceptedNew=!uncertain && old && diff.kind==='OBSERVED_ADDITION'?new Set(diff.added):new Set();
      for(const member of row.members){
        const pk=D.pk(account,member.id),oldPerson=await D.request(people.get(pk));
        const nameInfo=memberInfos.get(member.id);const name=nameInfo.name;
        const person=oldPerson||{pk,account,id:member.id,name:'',manualName:'',nameSource:'',status:initialBaseline?'LEGACY':'NEW',
          companyApproved:false,firstSeen:Date.now(),aliases:[]};
        if(mayUpdateName(person,name,nameInfo.source)){
          if(person.name&&person.name!==name)person.aliases=[...new Set([...(person.aliases||[]),person.name])].slice(-10);
          person.name=name;person.nameSource=nameInfo.source||'cache';
        }
        person.companyCandidate=L.isCompanyCandidate(person.manualName||person.name,policy);
        person.lastSeen=Date.now();people.put(person);
        const epk=D.pk(account,D.pk(row.id,member.id));const oldEdge=await D.request(edges.get(epk));
        if(!oldEdge){edges.put({pk:epk,account,groupId:row.id,personId:member.id,firstSeen:Date.now(),lastSeen:Date.now(),seen:'OBSERVED'});}
        else{oldEdge.lastSeen=Date.now();edges.put(oldEdge);}
        if(acceptedNew.has(member.id)){
          observedAdded++;
          const severity=L.alertLevel({level:group.level,status:person.status,companyApproved:person.companyApproved},policy);
          if(severity==='CRITICAL')critical++;
          if(severity==='CRITICAL'||(severity==='REVIEW'&&policy.notifyUnknown)||
             (severity==='HIGH'&&(person.status!=='NEW'||policy.notifyUnknown))||
             (severity==='INFO'&&policy.notifyKnownTransfers))notifyCount++;
          if(person.status==='NEW')unknown++;
          addEvent(tx,account,{type:'OBSERVED_ADDITION',groupId:row.id,personId:member.id,
            quality:row.quality,severity,personWasKnown:!!oldPerson,
            nameSnapshot:person.manualName||person.name||'',message:'首次在该群缓存中观察到该成员 ID，不等于已确认实际入群'});
        }
      }
    }
    return {groupsChanged,observedAdded,unknown,critical,notifyCount,ambiguous,bootstrapped};
  });
}
async function ingest(p){
  if(!validate(p))return {ok:false,error:'本地扫描内容无效或数据库尚未建立'};
  const identity=await resolveIdentity(p);
  if(p.rows.length===0)return readOnlyAudit(p,{...identity,mode:'READ_ONLY',canBind:false,
    reason:'本次没有读取到可用的群成员名单，已保留原有索引并等待 Teams 缓存同步',readerDegraded:true});
  // A truncated cache can only be inspected, never persisted as an authoritative
  // new baseline. This avoids false member removals and untrusted partial rows.
  if(p.stats.partial)return readOnlyAudit(p,{...identity,mode:'READ_ONLY',canBind:false,
    reason:'Teams 本地缓存本次读取不完整，已保留既有名单并等待下次巡检',readerDegraded:true});
  if(identity.mode!=='WRITE')return readOnlyAudit(p,identity);
  try{await requirePrepared();}
  catch(e){return readOnlyAudit(p,{...identity,mode:'READ_ONLY',canBind:false,reason:e.message});}
  const account=identity.account,verified=true;
  await saveGuard({mode:'WRITE',reason:'已匹配已绑定账号',account,canBind:false,at:Date.now()});
  const policy=await D.getPolicy(account);
  const hints=new Map();
  if(Array.isArray(p.nameHints)&&p.nameHints.length<=16000){
    for(const h of p.nameHints){if(L.personId(h?.id)&&L.goodName(h?.name,h.id))
      hints.set(h.id,{name:L.goodName(h.name,h.id),source:bound(h.source,36)||'Teams 元数据'});}
  }
  const initialBaseline=(await D.getAllFor('groups',account)).length===0;
  const rows=p.rows.map(row=>({...row,members:Array.isArray(row.members)?row.members.map(m=>{
    const hint=hints.get(m.id);return (hint&&hint.source==='Teams 用户资料缓存')?{...m,name:hint.name,nameSource:hint.source}:((!L.goodName(m.name,m.id)&&hint)?{...m,name:hint.name,nameSource:hint.source}:m);
  }):[]}));let changes={groupsChanged:0,observedAdded:0,unknown:0,critical:0,notifyCount:0,ambiguous:0,bootstrapped:0};
  // Small bounded transactions keep service workers responsive with large Teams accounts.
  for(let i=0;i<rows.length;i+=35){const done=await applyBatch(rows.slice(i,i+35),account,policy,initialBaseline);
    for(const k of Object.keys(changes))changes[k]+=done[k]||0;}
  const active={pk:'active',account,verified,at:Date.now(),stats:{records:p.stats.records,candidates:p.stats.candidates,
    complete:p.stats.complete,partial:!!p.stats.partial,groupsProcessed:rows.length,
    nameHints:p.stats.nameHints||0,nameDatabasesFound:p.stats.nameDatabasesFound||0,
    nameRecordsChecked:p.stats.nameRecordsChecked||0,nameConflicts:p.stats.nameConflicts||0,
    nameStoresCapped:p.stats.nameStoresCapped||0,unresolved:p.stats.unresolved||0,
    nameFieldPaths:p.stats.nameFieldPaths||{},cacheWatchActive:p.stats.cacheWatchActive===true,
    scanTrigger:['CACHE_WRITE','PERIODIC','REQUESTED'].includes(p.trigger)?p.trigger:'UNKNOWN'},changes};
  await D.putMeta(active);
  const existingMeta=await D.getMeta('account:'+account);
  const jwtHash=await tokenSubjectFingerprint(p.tokenIdentity);
  await D.putMeta({...(existingMeta||{}),pk:'account:'+account,account,verified,lastSeen:Date.now(),
    tokenSubjectHash:existingMeta?.tokenSubjectHash||jwtHash||''});
  await pruneOldEvents(account).catch(e=>console.warn('历史清理失败',e));
  const total=await counts(account);
  await recordScanResult({ok:true});
  await refreshBadge();
  if(changes.notifyCount)await notifyChanges(changes,policy);
  // A completed scan updates the health timestamp, even when no roster changed.
  await broadcastOverlay();
  lastIngest=Date.now();
  return {ok:true,account,verified,scanned:rows.length,...changes,summary:total};
}
async function pruneOldEvents(account){
  const day=24*60*60*1000,meta=await D.getMeta('pruned:'+account);
  if(meta?.at && Date.now()-meta.at<day)return;
  const cutoff=Date.now()-180*day, all=await D.getAllFor('events',account);
  const olds=all.filter(e=>e.at<cutoff && e.status!=='OPEN').slice(0,1500);
  for(let i=0;i<olds.length;i+=150){await D.transaction(['events'],'readwrite',async tx=>{
    for(const e of olds.slice(i,i+150))await D.request(tx.objectStore('events').delete(e.pk));
  });}
  await D.putMeta({pk:'pruned:'+account,at:Date.now()});
}
async function counts(account){
  const [groups,people,events,edges]=await Promise.all(['groups','people','events','edges'].map(s=>D.getAllFor(s,account)));
  const unresolved=events.filter(e=>e.status==='OPEN'&&e.severity!=='SILENT');
  return {groups:groups.length,people:people.length,edges:edges.length,criticalGroups:groups.filter(g=>g.level==='CRITICAL').length,
    newUnknown:people.filter(p=>p.status==='NEW').length,legacyUnknown:people.filter(p=>p.status==='LEGACY').length,
    openUrgent:unresolved.filter(e=>['CRITICAL','HIGH','REVIEW'].includes(e.severity)).length,
    openEvents:unresolved.length, ambiguous:groups.filter(g=>g.ambiguous).length};
}
// All three visible status surfaces consume this single interpretation.
// A READ_ONLY scan never contributes unpersisted scan-time alert counters to
// actionable/approved counts: those are observations, not stored review items.
async function statusSnapshot(){
  const [guard,active]=await Promise.all([sessionGuard(),D.getMeta('active')]);
  const readOnly=guard?.mode==='READ_ONLY';
  const sameAccount=!!active?.account&&!!guard?.account&&active.account===guard.account;
  const indexed=!!active?.account&&(!readOnly||sameAccount);
  const n=indexed?await counts(active.account):null;
  const health=await scanHealth();
  const lastRead=readOnly?(guard.at||0):(active?.at||0);
  const newUnknown=n?.newUnknown||0,openUrgent=n?.openUrgent||0;
  // A diagnostic read-only scan may show DIFFERENT yellow groups from those
  // already saved. Count the union of group IDs, not max(counts), which misses
  // disjoint reviews, and never add counts, which duplicates overlapping ones.
  let ambiguous=n?.ambiguous||0;
  if(readOnly){
    const observed=Array.isArray(guard.ambiguousGroupIds)?guard.ambiguousGroupIds.filter(L.threadId):[];
    if(sameAccount){
      const saved=await D.getAllFor('groups',active.account);
      ambiguous=new Set([...saved.filter(g=>g.ambiguous).map(g=>g.id),...observed]).size;
    }else ambiguous=observed.length ? new Set(observed).size : guard.ambiguous||0;
  }
  const level=newUnknown||openUrgent?'alert':readOnly?'readonly':
    !lastRead?'uninitialized':Date.now()-lastRead>SCAN_STALE_MS?'stale':ambiguous?'review':'ok';
  return {level,indexed,guard:guard||null,active:active||null,counts:n,
    groups:readOnly?(guard.inspected||0):(n?.groups||0),
    newUnknown,openUrgent,ambiguous,lastRead,
    // Explicitly separate uncertain, ephemeral READ_ONLY observations from
    // saved unresolved records so the UI never fabricates processed events.
    observedOnly:readOnly?(guard.observedAdded||0):0,scanHealth:health};
}
// Badge shows a number only for saved pending actions. Non-red conditions use
// amber !, matching both the popup and the page overlay, never the old account.
async function updateActionBadge(n,level='ok',guard=null){
  const identities=Number.isInteger(n?.newUnknown)&&n.newUnknown>0?n.newUnknown:0;
  const events=Number.isInteger(n?.openUrgent)&&n.openUrgent>0?n.openUrgent:0;
  const total=identities+events;
  const red=total>0,amber=!red&&['readonly','review','stale','uninitialized'].includes(level);
  await chrome.action.setBadgeBackgroundColor({color:red?'#c52a32':amber?'#b7791f':'#64748b'});
  await chrome.action.setBadgeText({text:red?(total>99?'99+':String(total)):amber?'!':''});
  const suffix=guard?.readerDegraded===true?' · 缓存读取待恢复':guard?.mode==='READ_ONLY'?' · 账号只读守护':'';
  await chrome.action.setTitle?.({title:red
    ?`TeamsGroupSentry · 新身份待审 ${identities} · 重要未处理 ${events}${suffix}`:
    level==='readonly'?(guard?.readerDegraded===true?'TeamsGroupSentry · Teams 缓存读取不完整，正在自动重试':'TeamsGroupSentry · 账号只读守护，请核对当前账号'):
    level==='review'?'TeamsGroupSentry · 群成员名单待人工核查':
    level==='stale'?'TeamsGroupSentry · 最近巡检未更新，请查看失败原因':
    level==='uninitialized'?'TeamsGroupSentry · 尚未建立巡检索引':
    'TeamsGroupSentry · 暂无待处理异常'});
}
async function refreshBadge(){
  const state=await statusSnapshot();
  await updateActionBadge(state.counts,state.level,state.guard);
}
async function notifyChanges(changes,policy){
  const notable=changes.notifyCount;
  if(!notable)return;
  try{await chrome.notifications.create('tgs-v3-'+Date.now(),{type:'basic',iconUrl:chrome.runtime.getURL('icons/icon128.png'),
    title:changes.critical?'Teams 重点群需要核查':'Teams 发现新的人员 ID',
    message:`本次本地缓存观察：${changes.observedAdded} 个群成员关系变化，${changes.unknown} 个首次出现的身份，重点事项 ${changes.critical} 条。请到人员安全中心核实。`,priority:2});}catch{}
  if(policy.sound){try{if(!await chrome.offscreen.hasDocument()){
    if(!soundCreation){soundCreation=chrome.offscreen.createDocument({url:'offscreen/sound.html',reasons:['AUDIO_PLAYBACK'],
      justification:'为明确的用户启用的本地成员变化预警播放提示音'}).finally(()=>{soundCreation=null;});}
    await soundCreation;}
    await chrome.runtime.sendMessage({action:'PLAY_ALERT_SOUND'});
  }catch{}}
}
// Privileged UI edits are never allowed to mutate an account partition while
// the scanner has explicitly entered identity-conflict / unknown-account mode.
async function assertIdentitySafeToEdit(){
  const guard=await sessionGuard();
  if(guard?.mode==='READ_ONLY')throw new Error('账号身份未确认：只读守护期间禁止修改白名单或群组基线，请先在插件中确认当前账号');
  const active=await D.getMeta('active');
  if(!active?.account||!active.verified)throw new Error('当前没有已绑定的账号基线，请打开 Teams 等待自动巡检');
  // Session guard disappears after a browser restart. Keep the user's approved
  // local identity across restarts, without a new manual confirmation step.
  // However, a positive guard must belong to the active partition.
  if(guard && (guard.mode!=='WRITE'||guard.account!==active.account))
    throw new Error('当前巡检账号与保存的账号不一致，已禁止修改，请等待巡检完成');
  const approved=await D.getMeta('account:'+active.account);
  if(!approved || (approved.manualBound!==true && approved.verified!==true))
    throw new Error('当前账号尚未完成本地绑定，已禁止修改旧数据');
  return active.account;
}
async function edit(msg){
  await assertIdentitySafeToEdit();
  const active=await D.getMeta('active');if(!active?.account)throw new Error('请先打开 Teams 并巡检');
  const account=active.account;
  if(msg.kind==='policy'){const policy={...L.validatePolicy(msg.value),account};
    await D.transaction(['policies'],'readwrite',tx=>D.request(tx.objectStore('policies').put(policy)));return {ok:true};}
  if(msg.kind==='group'){
    if(!L.threadId(msg.id))throw new Error('群 ID 无效');
    return D.transaction(['groups'],'readwrite',async tx=>{
      const store=tx.objectStore('groups'),row=await D.request(store.get(D.pk(account,msg.id)));
      if(!row)throw new Error('群不存在');
      if(msg.field==='level'&&['CRITICAL','STANDARD','QUIET'].includes(msg.value))row.level=msg.value;
      else if(msg.field==='alias'&&typeof msg.value==='string')row.alias=msg.value.trim().slice(0,120);
      else throw new Error('操作不允许');
      await D.request(store.put(row));return {ok:true};
    });
  }
  if(msg.kind==='person'){
    if(!L.personId(msg.id))throw new Error('人员 ID 无效');
    return D.transaction(['people'],'readwrite',async tx=>{
      const store=tx.objectStore('people'),row=await D.request(store.get(D.pk(account,msg.id)));
      if(!row)throw new Error('人员不存在');
      if(msg.field==='status'&&['APPROVED','NEW','LEGACY','IGNORED','REVOKED'].includes(msg.value))row.status=msg.value;
      else if(msg.field==='companyApproved'&&typeof msg.value==='boolean')row.companyApproved=msg.value;
      else if(msg.field==='manualName'&&typeof msg.value==='string')row.manualName=msg.value.trim().slice(0,120);
      else throw new Error('操作不允许');
      row.reviewedAt=Date.now();await D.request(store.put(row));return {ok:true};
    });
  }
  if(msg.kind==='event'){
    return D.transaction(['events'],'readwrite',async tx=>{
      const store=tx.objectStore('events'),row=await D.request(store.get(D.pk(account,msg.id)));
      if(!row)throw new Error('事件不存在');row.status=msg.value==='ACKNOWLEDGED'?'ACKNOWLEDGED':'OPEN';
      row.reviewedAt=Date.now();await D.request(store.put(row));return {ok:true};
    });
  }
  throw new Error('未知编辑操作');
}
// Adopt a reviewed CACHE observation for exactly one group; this is NOT
// proof of server-side joining/leaving and never approves unknown people.
async function confirmRosterReview(msg){
  await assertIdentitySafeToEdit();
  const guard=await sessionGuard(),active=await D.getMeta('active');
  if(guard?.mode!=='WRITE'||!active?.account||guard.account!==active.account)
    throw new Error('请先巡检并确认账号身份，才能采用当前名单');
  if(!L.threadId(msg.id)||typeof msg.revision!=='string'||msg.revision.length>80)
    throw new Error('群组核查参数无效');
  const account=active.account;
  const result=await D.transaction(['groups','events','edges'],'readwrite',async tx=>{
    const groups=tx.objectStore('groups'),events=tx.objectStore('events'),edges=tx.objectStore('edges');
    const row=await D.request(groups.get(D.pk(account,msg.id)));
    if(!row||!row.ambiguous||!Array.isArray(row.pendingRosterIds)||!row.pendingRosterIds.length)
      throw new Error('没有可确认的最新名单，请先进行巡检');
    if(row.pendingRevision!==msg.revision)throw new Error('缓存名单已经更新，请重新查看差异后确认');
    if(!Number.isFinite(row.pendingSnapshotAt)||Date.now()-row.pendingSnapshotAt>180000||
      row.pendingSnapshotAt>Date.now()+30000)throw new Error('观察名单已过期，请先点击立即巡检');
    const next=row.pendingRosterIds;
    if(next.length>L.MAX_MEMBERS||new Set(next).size!==next.length||!next.every(L.personId))
      throw new Error('观察名单存在不合法或重复的成员 ID');
    const old=Array.isArray(row.memberIds)?row.memberIds:[];
    const previous=new Set(old),updated=new Set(next);
    const removed=old.filter(id=>!updated.has(id)),added=next.filter(id=>!previous.has(id));
    // Persist all changes and an undo/audit trail atomically. Do not delete
    // people or their global approvals; only adjust this group's active edges.
    for(const id of removed)await D.request(edges.delete(D.pk(account,D.pk(row.id,id))));
    for(const id of next){const key=D.pk(account,D.pk(row.id,id));
      const edge=await D.request(edges.get(key));
      if(!edge)await D.request(edges.put({pk:key,account,groupId:row.id,personId:id,
        firstSeen:Date.now(),lastSeen:Date.now(),seen:'MANUALLY_REVIEWED'}));}
    const audit={id:crypto.randomUUID(),account,type:'ROSTER_BASELINE_REVIEWED',
      groupId:row.id,personId:null,quality:row.pendingQuality||'CACHE_OBSERVED',
      severity:'SILENT',status:'LOGGED',at:Date.now(),
      previousMemberIds:[...old],acceptedMemberIds:[...next],addedIds:added,removedIds:removed,
      message:'用户核实 Teams 群成员后采用本地缓存名单；不等于已确认成员进出时间'};
    audit.pk=D.pk(account,audit.id);await D.request(events.put(audit));
    row.memberIds=[...next];row.quality=row.pendingQuality||'CACHE_OBSERVED';
    row.countOffset=row.pendingCountOffset;
    row.ambiguous=false;row.stability=1;row.lastCacheChangeAt=Date.now();
    row.baselineReviewedAt=Date.now();row.baselineReviewEventId=audit.id;
    row.observedCandidateIds=[];row.ambiguousNotifiedAt=0;
    for(const key of ['ambiguousReason','pendingRosterIds','pendingRevision','pendingQuality',
      'pendingCountOffset','pendingSnapshotAt'])delete row[key];
    await D.request(groups.put(row));
    // Acknowledging roster uncertainty must not approve any NEW identities.
    const open=await D.request(events.index('account').getAll(account));
    for(const event of open){if(event.groupId===row.id&&event.type==='ROSTER_UNCERTAIN'&&event.status==='OPEN'){
      event.status='ACKNOWLEDGED';event.reviewedAt=Date.now();event.reviewedByEventId=audit.id;
      await D.request(events.put(event));}}
    return {ok:true,added:added.length,removed:removed.length,groupId:row.id,eventId:audit.id};
  });
  await refreshBadge();await broadcastOverlay();return result;
}
async function bulkPeople(ids,value){
  await assertIdentitySafeToEdit();
  const meta=await D.getMeta('active');if(!meta?.account)throw new Error('请先建立群组索引');
  if(!['APPROVED','APPROVED_COMPANY','IGNORED','NEW','REVOKED','LEGACY'].includes(value)||!Array.isArray(ids)||ids.length>500||
     !ids.every(id=>L.personId(id)))throw new Error('批量审核参数不正确');
  let count=0;
  await D.transaction(['people'],'readwrite',async tx=>{
    const store=tx.objectStore('people');
    for(const id of new Set(ids)){
      const row=await D.request(store.get(D.pk(meta.account,id)));
      if(row){row.status=value==='APPROVED_COMPANY'?'APPROVED':value;
        if(value==='APPROVED_COMPANY')row.companyApproved=true;
        row.reviewedAt=Date.now();await D.request(store.put(row));count++;}
    }
  });return {ok:true,updated:count};
}
async function restore(data){
  if(!data||data.format!=='TGS3_BACKUP'||data.version!==1||
    typeof data.account!=='string'||!/^(verified|manual|provisional):[a-f0-9]{32}$/.test(data.account)||
    !data.tables||typeof data.tables!=='object'||Array.isArray(data.tables))throw new Error('备份格式或账号分区无效');
  // Dashboard already caps chosen file size, but validate again in the privileged worker.
  if(JSON.stringify(data).length>45*1024*1024)throw new Error('备份解压后的数据超过 45MB');
  const names=['groups','people','edges','events','policies'];let total=0;
  for(const name of names){if(!Array.isArray(data.tables[name])||data.tables[name].length>200000)throw new Error(`备份数据表 ${name} 无效`);
    total+=data.tables[name].length;}
  if(total>300000)throw new Error('备份记录太多');
  // Restore is scoped: do not silently overwrite another account's data.
  const active=await D.getMeta('active');if(!active?.account||active.account!==data.account)throw new Error('当前账户分区与备份不匹配；为避免串号拒绝恢复');
  for(const name of names){
    for(const row of data.tables[name]){
      if(!row||row.account!==data.account)throw new Error('备份中有跨账号或空记录');
      if(name==='policies'){
        if(row.account!==data.account)throw new Error('策略所属账号不一致');
        // Only persist the supported policy keys; no untrusted extra properties.
        const safePolicy={...L.validatePolicy(row),account:data.account};
        for(const key of Object.keys(row))delete row[key];
        Object.assign(row,safePolicy);
      }else{
        const expected=name==='groups'?D.pk(data.account,row.id):
          name==='people'?D.pk(data.account,row.id):
          name==='edges'?D.pk(data.account,D.pk(row.groupId,row.personId)):
          name==='events'?D.pk(data.account,row.id):null;
        if(!expected || row.pk!==expected)throw new Error('备份数据的复合主键不匹配');
        if(name==='groups'&&(!L.threadId(row.id)||!Array.isArray(row.memberIds)||row.memberIds.length>3000||
          !row.memberIds.every(L.personId)||new Set(row.memberIds).size!==row.memberIds.length))
          throw new Error('备份群组名单格式无效');
        if(name==='people'&&!L.personId(row.id))throw new Error('备份人员 ID 格式无效');
        if(name==='edges'&&(!L.threadId(row.groupId)||!L.personId(row.personId)))throw new Error('备份成员关系无效');
        if(name==='events'&&(typeof row.id!=='string'||row.id.length>128))throw new Error('备份事件格式无效');
      }
    }
  }
  // Default import is NON-DESTRUCTIVE. Older external backups must not reset
  // current approvals, company classification, aliases, or newly found IDs.
  const currentKeys=await D.transaction(names,'readonly',async tx=>
    Object.fromEntries(await Promise.all(names.map(async name=>
      [name,await D.request(tx.objectStore(name).getAllKeys())]))));
  let inserted=0;
  await D.transaction(names,'readwrite',tx=>{
    for(const name of names){const store=tx.objectStore(name),existing=new Set(currentKeys[name]);
      for(const row of data.tables[name]){
        const key=name==='policies'?row.account:row.pk;
        if(!existing.has(key)){store.add(row);existing.add(key);inserted++;}
      }
    }
  });
  // A fully imported account still requires explicit identity confirmation.
  // Do not reset the existing active account's binding / alert baseline here.
  return {ok:true,restored:inserted,unchanged:total-inserted};
}
// Compare with yesterday's encrypted backup WITHOUT restoring, rewinding, or changing a baseline.
async function historicalCompare(data){
  const active=await D.getMeta('active');
  if(!active?.account)throw new Error('当前尚无账号基线，无法与历史备份比较');
  await assertIdentitySafeToEdit();
  const [groups,people]=await Promise.all([D.getAllFor('groups',active.account),D.getAllFor('people',active.account)]);
  return B.compare(data,groups,people,active.account);
}
// Explicit user opt-in: save separately-labelled historical alerts, not real-time join events.
// The underlying current group/person/edge baselines must never be altered here.
async function markHistoricalAlerts(data){
  await assertIdentitySafeToEdit();
  await requirePrepared();
  const report=await historicalCompare(data);
  if(report.reportLimited)throw new Error('历史差异过多，请先人工检查报告；不允许批量自动记为入群事件');
  const active=await D.getMeta('active'),account=active.account;
  const prepared=await Promise.all(report.people.map(async p=>({person:p,
    eventId:'backup-person-'+(await hash(account+'\u001f'+p.id)).slice(0,40)})));
  let created=0;
  await D.transaction(['events'],'readwrite',async tx=>{
    const store=tx.objectStore('events');
    for(const {person:p,eventId} of prepared){
      const pk=D.pk(account,eventId);
      if(await D.request(store.get(pk)))continue;
      const g=p.groups[0],id=g?.id||'';
      const rec={pk,id:eventId,account,groupId:id,personId:p.id,
        type:'HISTORICAL_NEW_PERSON',quality:'CACHE_OBSERVED',severity:'REVIEW',status:'OPEN',
        nameSnapshot:bound(p.name,180),at:Date.now(),backupAt:report.backupAt,
        message:'相较历史备份首次出现的缓存身份；不能证明实际入群时间，需人工核实'};
      store.put(rec);created++;
    }
  });
  if(created){
    await refreshBadge();await broadcastOverlay();
    try{await chrome.notifications.create('tgs-v3-historical-'+Date.now(),{
      type:'basic',iconUrl:chrome.runtime.getURL('icons/icon128.png'),
      title:'Teams 历史备份差异提醒',
      message:`相对所选历史备份新发现 ${created} 个成员 ID，已加入待核查事件。此提醒不是实时入群证明。`,priority:1
    });}catch{}
  }
  return {ok:true,created,unchanged:report.newPeopleCount-created,report};
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(!msg||typeof msg.action!=='string')return;
  const origin=sender.url?(()=>{try{return new URL(sender.url).origin;}catch{return ''}})():'';
  const sameExtension=sender.id===chrome.runtime.id;
  const page=sameExtension&&!!sender.tab&&sender.frameId===0&&origin==='https://teams.live.com';
  // Extension pages may be hosted inside a normal browser tab (dashboard.html).
  // Distinguish by Chrome-attested sender.url origin, never by absence of sender.tab.
  // Keep Teams content scripts in the small, read-only action allowlist below.
  const own=sameExtension&&origin===new URL(chrome.runtime.getURL('/')).origin&&
    (sender.frameId===undefined||sender.frameId===0);
  const fromPageAllowed=new Set(['INGEST','OVERLAY_STATUS','OVERLAY_PREFS_SET','OPEN_DASHBOARD']);
  if(!own && !(page&&fromPageAllowed.has(msg.action)))return;
  if(msg.action==='INGEST'&&!page)return;
  (async()=>{
    switch(msg.action){
      case 'INGEST':return serial(()=>ingest(msg.payload));
      case 'SCAN_NOW':return scanTabs(true);
      case 'BIND_CURRENT':return serial(async()=>{
        await requirePrepared();
        const state=await sessionGuard();
        if(!state||state.mode!=='READ_ONLY'||!state.canBind||!state.account||
            Date.now()-state.at>120000||state.account!==msg.account)throw new Error('没有可以确认绑定的当前账号，请先在 Teams 页面巡检');
        const old=await D.getMeta('account:'+state.account);
        await D.putMeta({...(old||{}),pk:'account:'+state.account,account:state.account,
          verified:true,manualBound:true,lastSeen:Date.now()});
        if(state.identityLinkKey&&/^identity-link:[a-f0-9]{32}$/.test(state.identityLinkKey)){
          await D.putMeta({pk:state.identityLinkKey,account:state.account,approvedAt:Date.now()});
        }
        if(state.scopeKey&&/^account-cache-scope:[a-f0-9]{32}$/.test(state.scopeKey)){
          const prior=await D.getMeta(state.scopeKey);
          // An independent MRI-bound account may share the same DB name with an
          // existing identity. In that case, preserve the prior scope mapping.
          if(!(prior?.approved===true&&prior.account!==state.account))
            await D.putMeta({pk:state.scopeKey,account:state.account,approved:true,approvedAt:Date.now()});
        }
        await saveGuard({...state,reason:'账号已手动绑定，请再次点击巡检建立/更新基线',canBind:false});
        return {ok:true};
      });
      case 'OVERLAY_STATUS':{
        const state=await statusSnapshot();
        // Minimal status only: no person names, group IDs or account identifiers.
        return {ok:true,prefs:await overlayPrefs(),level:state.level,
          groups:state.groups,openUrgent:state.openUrgent,newUnknown:state.newUnknown,
          ambiguous:state.ambiguous,lastRead:state.lastRead,
          readOnly:state.guard?.mode==='READ_ONLY',
          guard:state.guard?.mode==='READ_ONLY'?{
            mode:'READ_ONLY',reason:state.guard.reason,readerDegraded:state.guard.readerDegraded===true,
            inspected:state.guard.inspected,compared:state.guard.compared,
            observedAdded:state.observedOnly}:null};
      }
      case 'OVERLAY_PREFS_SET':{
        if(!msg.prefs || typeof msg.prefs!=='object')throw new Error('状态栏设置无效');
        const next=safeOverlayPrefs(msg.prefs);
        await chrome.storage.local.set({overlayPrefs:next});await broadcastOverlay();return {ok:true,prefs:next};
      }
      case 'OPEN_DASHBOARD':{
        const target=['overview','review','events','groups','settings'].includes(msg.page)?msg.page:'events';
        await chrome.tabs.create({url:chrome.runtime.getURL('ui/dashboard.html?page='+target)});return {ok:true};
      }
      case 'SUMMARY':{const state=await statusSnapshot();return {ok:true,status:{level:state.level,indexed:state.indexed,
        groups:state.groups,newUnknown:state.newUnknown,openUrgent:state.openUrgent,ambiguous:state.ambiguous,
        lastRead:state.lastRead,observedOnly:state.observedOnly,
        scanHealth:{failedConsecutive:state.scanHealth.failedConsecutive||0,
          lastError:state.scanHealth.lastError||'',lastErrorAt:state.scanHealth.lastErrorAt||0,
          at:state.scanHealth.at||0}},
        guard:state.guard,active:state.active,counts:state.counts,
        policy:state.indexed?await D.getPolicy(state.active.account):null};}
      case 'CONFIRM_ROSTER':return serial(async()=>{await requirePrepared();return confirmRosterReview(msg);});
      case 'EDIT':return serial(async()=>{await requirePrepared();const r=await edit(msg);await refreshBadge();await broadcastOverlay();return r;});
      case 'BULK_PERSON':return serial(async()=>{await requirePrepared();const r=await bulkPeople(msg.ids,msg.value);await refreshBadge();await broadcastOverlay();return r;});
      case 'COMPARE_BACKUP':return historicalCompare(msg.data);
      case 'MARK_HISTORICAL':return serial(()=>markHistoricalAlerts(msg.data));
      case 'RESTORE':return serial(async()=>{
        await assertIdentitySafeToEdit();
        await requirePrepared();
        // Backup of current state before merging imported data, independently of the imported file.
        await R.capture(D,{label:'导入加密备份前',version:BUILD_VERSION,sourceVersion:BUILD_VERSION});
        const result=await restore(msg.data);
        await refreshBadge();await broadcastOverlay();return result;
      });
      case 'RECOVERY_STATUS':{
        let marker=null,error='';
        try{marker=await ensureUpgradeReady();}catch(e){error=bound(e?.message||String(e),180);}
        const active=await D.getMeta('active');
        const checkpoints=active?.account?await R.list(active.account):[];
        return {ok:true,ready:!!marker?.ready,version:BUILD_VERSION,error,checkpoints,
          upgradedFrom:marker?.previousVersion||'',lastCheckpointId:marker?.checkpointId||''};
      }
      case 'CREATE_CHECKPOINT':return serial(async()=>{
        await requirePrepared();
        const result=await R.capture(D,{label:'用户手动保存',version:BUILD_VERSION,sourceVersion:BUILD_VERSION});
        return result;
      });
      case 'VERIFY_CHECKPOINT':{
        const active=await D.getMeta('active'),guard=await sessionGuard();
        if(!active?.account||(guard?.mode==='READ_ONLY'&&guard.account!==active.account))
          throw new Error('当前账号不确定，不能查看其他账号的恢复记录');
        return R.verifyCheckpoint(msg.id,D,active.account);
      }
      case 'RESTORE_MISSING':return serial(async()=>{
        const account=await assertIdentitySafeToEdit();
        await requirePrepared();
        // Check and validate the account-scoped restore BEFORE capturing a
        // new recovery point; unrelated historical partitions never reappear.
        const preview=await R.verifyCheckpoint(msg.id,D,account);
        if(!preview.ok)throw new Error('恢复点无法验证');
        if(preview.missing>0)await R.capture(D,{label:'恢复缺失记录前',version:BUILD_VERSION,sourceVersion:BUILD_VERSION,protectId:msg.id});
        const result=await R.restoreMissing(msg.id,D,L,account);
              await refreshBadge();await broadcastOverlay();
        return result;
      });
      case 'SET_MANUAL_PROFILE':{
        if(typeof msg.name!=='string'||msg.name.length>80)throw new Error('档案名不正确');
        await chrome.storage.local.set({manualProfile:msg.name.trim()});return {ok:true};}
      case 'DIAGNOSTIC':{const meta=await D.getMeta('active');
        const ppl=meta?.account?await D.getAllFor('people',meta.account):[];
        const gr=meta?.account?await D.getAllFor('groups',meta.account):[];
        const currentGuard=await sessionGuard();
        const safeGuard=currentGuard?{
          mode:currentGuard.mode,reason:bound(currentGuard.reason,180),
          inspected:currentGuard.inspected||0,compared:currentGuard.compared||0,
          observedAdded:currentGuard.observedAdded||0,canBind:currentGuard.canBind===true,
          at:currentGuard.at||0}:null;
        return {ok:true,report:{version:BUILD_VERSION,guard:safeGuard,activeAccountKind:meta?.verified?'observed-user-id':'provisional-or-manual',
        peopleNamed:ppl.filter(p=>!!(p.manualName||p.name)).length,
        groupsWithTitleNames:gr.filter(g=>(g.titleNameHints||[]).length>0).length,
        hasLocalDatabase:!!meta,groupsIndexed:meta?.stats?.groupsProcessed||0,
        nameCacheDatabases:meta?.stats?.nameDatabasesFound||0,
        nameCacheRecordsChecked:meta?.stats?.nameRecordsChecked||0,
        nameHintsMatched:meta?.stats?.nameHints||0,
        nameConflicts:meta?.stats?.nameConflicts||0,
        nameStoresCapped:meta?.stats?.nameStoresCapped||0,
        nameFieldPaths:meta?.stats?.nameFieldPaths||{},
        teamsCacheRecords:meta?.stats?.records||0,possiblePartial:meta?.stats?.partial??true,
        lastCacheRead:meta?.at||0,cacheWatchActive:meta?.stats?.cacheWatchActive===true,
        lastScanTrigger:meta?.stats?.scanTrigger||'UNKNOWN',
        scanHealth:await scanHealth(),unknownGroupNameRequiresAlias:true,
        note:'仅本地 IndexedDB 缓存观察，未确认服务端实时同步'}};}
      default:throw new Error('未知操作');
    }
  })().then(reply).catch(e=>reply({ok:false,error:bound(e?.message||String(e),180)}));return true;
});
