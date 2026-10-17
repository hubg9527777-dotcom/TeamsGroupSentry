/* TeamsGroupSentry public release v1.0.1 — local only. No token values stored/replayed, no member removal.
   No MAIN-world identity or member payload is trusted. Missing account hints require explicit local scope approval. */
importScripts('lib/logic.js','lib/db.js','lib/recovery.js','lib/backup-diff.js','lib/contact-risk.js','lib/request-notice.js','lib/self-evidence.js');
const L=globalThis.TGSLogic,D=globalThis.TGSDB,R=globalThis.TGSRecovery,B=globalThis.TGSBackupDiff;
const ALARM='sentry-v3-poll';
const SCAN_HEALTH_KEY='tgs-v3-scan-health';
const SCAN_STALE_MS=180000; // Chrome may delay MV3 alarms while backgrounded.
let pendingTabScan=null;
const BUILD_VERSION='1.0.1', UPGRADE_KEY='upgrade-safety';
const FEATURE_BUILD='live-ui-evidence-history-2026-10-16', C=globalThis.TGSContactRisk;
const N=globalThis.TGSRequestNotice,NOTICE_KEY='tgs-request-ui-tab:';
const SELF=globalThis.TGSSelfEvidence;
// A separate per-tab queue never waits for a group scan or writes identity data.
const noticeQueues=new Map();
function noticeSerial(tabId,fn){const p=(noticeQueues.get(tabId)||Promise.resolve()).catch(()=>{}).then(fn);
  noticeQueues.set(tabId,p);p.finally(()=>{if(noticeQueues.get(tabId)===p)noticeQueues.delete(tabId);}).catch(()=>{});return p;}
async function noticeRecord(tabId){return (await chrome.storage.session.get(NOTICE_KEY+tabId))[NOTICE_KEY+tabId]||null;}
async function notifyRequestUI(tabId,record){
  // Fast delivery does not wait for any IndexedDB summary/group transaction.
  try{await chrome.tabs.sendMessage(tabId,{action:'REQUEST_NOTICE_CHANGED',notice:N.view(record)},{documentId:record.documentId});}catch{}
  try{await chrome.runtime.sendMessage({action:'SECURITY_STATE_CHANGED'});}catch{}
}
async function currentRequestNotice(sender){
  let tabId=sender?.tab?.id,token='',documentId=sender?.documentId;
  const fromTeams=sender?.url?.startsWith('https://teams.live.com/');
  if(!fromTeams){
    const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    const tab=tabs.find(t=>{try{return new URL(t.url).origin==='https://teams.live.com';}catch{return false;}});
    if(!tab)return {pending:false};tabId=tab.id;
    try{token=(await chrome.tabs.sendMessage(tabId,{action:'REQUEST_NOTICE_CONTEXT'}))?.token||'';}catch{return {pending:false};}
  }
  if(!Number.isInteger(tabId))return {pending:false};
  const record=await noticeRecord(tabId);
  if(!record||(fromTeams?(!documentId||record.documentId!==documentId):(!token||record.token!==token)))return {pending:false};
  return {...N.view(record),tabId,token:record.token};
}
async function ingestRequestNotice(msg,sender){
  if(!/^[a-f0-9]{64}$/.test(msg.token||'')||typeof sender.documentId!=='string'||sender.documentId.length>120||
     !Number.isInteger(sender.tab?.id)||!N.valid(msg.evidence))throw Error('请求界面观察无效');
  // Bounded UI display excerpts stay in extension session storage only. No credentials, raw thread IDs or identity/trust writes.
  const {adapter,observed,fingerprint,source,count,meeting,selfKeys}=msg.evidence;
  const details=N.detailsOnly(msg.evidence.details);
  const o={adapter,observed,fingerprint,source,count,meeting,details,...(selfKeys?{selfKeys}: {})},tabId=sender.tab.id;
  return noticeSerial(tabId,async()=>{
    const stored=await noticeRecord(tabId);
    const previous=stored?.documentId===sender.documentId&&stored.token===msg.token?stored:null;
    const next={...N.evolve(previous,o,Date.now()),documentId:sender.documentId,token:msg.token};
    await chrome.storage.session.set({[NOTICE_KEY+tabId]:next});
    if(!previous||previous.revision!==next.revision||previous.pending!==next.pending||previous.visible!==next.visible){
      notifyRequestUI(tabId,next).catch(()=>{});refreshBadge().catch(()=>{});
    }
    return {ok:true};
  });
}
async function acknowledgeRequestNotice(msg,sender){
  const current=await currentRequestNotice(sender);
  if(!current.pending||current.revision!==msg.revision||
     (sender.url?.startsWith('chrome-extension:')&&(msg.tabId!==current.tabId||msg.token!==current.token)))
    throw Error('请求页面已变化，请刷新提醒');
  return noticeSerial(current.tabId,async()=>{
    const record=await noticeRecord(current.tabId);
    if(record?.token!==current.token)throw Error('请求页面已变化，请刷新提醒');
    const next=N.acknowledge(record,msg.revision);
    await chrome.storage.session.set({[NOTICE_KEY+current.tabId]:next});
    notifyRequestUI(current.tabId,next).catch(()=>{});refreshBadge().catch(()=>{});return {ok:true};
  });
}
// Public semver reset does not change the IndexedDB schema or account partition IDs.
let preparationPromise=null;
// Fail closed on database mutation if the pre-upgrade recovery point cannot be saved.
function ensureUpgradeReady(){
  if(preparationPromise)return preparationPromise;
  preparationPromise=(async()=>{
    const prior=await D.getMeta(UPGRADE_KEY);
    if(prior?.version===BUILD_VERSION&&prior.featureBuild===FEATURE_BUILD&&prior.ready===true)return prior;
    const existingGroups=await D.getAll('groups');
    const existingPeople=await D.getAll('people');
    const existingEvents=await D.getAll('events');
    let checkpoint=null;
    if(existingGroups.length||existingPeople.length||existingEvents.length){
      checkpoint=await R.capture(D,{label:'升级前自动恢复点',version:BUILD_VERSION,sourceVersion:prior?.version||'早期内部版本'});
      if(!checkpoint?.ok||checkpoint.empty)throw new Error('升级前恢复点创建失败，已禁止修改旧数据');
    }
    const marker={pk:UPGRADE_KEY,version:BUILD_VERSION,featureBuild:FEATURE_BUILD,ready:true,at:Date.now(),
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
// Only short-lived ID candidates from a successful WRITE scan; never a token or credential.
const SELF_ID_OFFER_KEY='tgs-self-id-offer-v1', SELF_ID_OFFER_TTL=120000;
const OVERLAY_MODES=new Set(['always','alerts','hidden']);
const DEFAULT_OVERLAY={mode:'always',offset:'top'};
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
function safeOverlayPrefs(p){return {mode:OVERLAY_MODES.has(p?.mode)?p.mode:'always',
  offset:p?.offset==='below'?'below':'top'};}
async function overlayPrefs(){const x=await chrome.storage.local.get('overlayPrefs');return safeOverlayPrefs(x.overlayPrefs||DEFAULT_OVERLAY);}
async function broadcastOverlay(){
  // Refresh the popup before waiting on possibly suspended Teams tabs.
  // This signal carries no private state; each surface reads the canonical summary.
  try{await chrome.runtime.sendMessage({action:'SECURITY_STATE_CHANGED'});}catch{}
  try{const tabs=await chrome.tabs.query({url:'https://teams.live.com/*'});
    await Promise.all(tabs.slice(0,12).map(tab=>chrome.tabs.sendMessage(tab.id,{action:'OVERLAY_REFRESH'}).catch(()=>{})));
  }catch{}
}

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
  chrome.tabs.create({url:chrome.runtime.getURL(id.startsWith('tgs-v3-contact-')?'ui/dashboard.html?page=requests':'ui/dashboard.html?page=events')}).catch(()=>{});});
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
  // Two-person group chats are legitimate group records and matter especially
  // to a smaller new account. One-person records remain ineligible.
  const current=new Map(rows.filter(g=>L.threadId(g?.id)&&Array.isArray(g.members)&&g.members.length>=2)
    .map(g=>[g.id,g]));
  let matched=0,consistent=0;
  for(const [id,g] of current){
    const old=base.get(id);if(!old)continue;
    matched++;
    const oldIds=new Set(old.memberIds.filter(x=>L.personId(x)));
    const freshIds=new Set(g.members.map(x=>x.id).filter(x=>L.personId(x)));
    if(oldIds.size<2||freshIds.size<2)continue;
    let shared=0;for(const m of oldIds)if(freshIds.has(m))shared++;
    // A stable shared ID can be 1/2 of a legitimate two-person conversation.
    const threshold=Math.max(oldIds.size,freshIds.size)===2?0.5:0.60;
    if(shared/Math.max(oldIds.size,freshIds.size)>=threshold)consistent++;
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
// A first installation with no self-MRI needs explicit ONE-TIME local consent.
// This digest binds the user's approval to the actual first cache observation,
// not just an arbitrary database name. It is NOT a Microsoft login signature.
async function bootstrapSnapshotHash(rows){
  const parts=rows.filter(r=>L.threadId(r?.id)&&Array.isArray(r.members)&&r.members.length>=2)
    .map(r=>r.id+'\u001e'+r.members.map(m=>m.id).filter(L.personId).sort().join('\u001f')).sort();
  return hash(parts.join('\u001d'));
}
// The member intersection is a list of human-review candidates, never a proof
// of the logged-in account. Do not look at browser auth cookies or store tokens.
function setupRowsWithNames(p){
  const names=new Map(),known=new Set((p.rows||[]).flatMap(r=>(r.members||[]).map(m=>m.id)));
  function add(id,value,source){
    if(!known.has(id))return;const name=L.goodName(value,id),priority=sourcePriority(source);
    if(!name||!priority)return;const old=names.get(id);
    if(!old||priority>old.priority)names.set(id,{priority,values:new Set([name])});
    else if(priority===old.priority)old.values.add(name);
  }
  for(const r of p.rows||[])for(const m of r.members||[])add(m.id,m.name,m.nameSource||'members');
  for(const h of (Array.isArray(p.nameHints)?p.nameHints:[]).slice(0,16000))add(h?.id,h?.name,h?.source);
  // Read-only projection. Never persist names/identities before account approval.
  return (p.rows||[]).map(r=>({...r,members:r.members.map(m=>{const n=names.get(m.id);
    return {...m,name:n?.values.size===1?[...n.values][0]:'',nameConflict:!!n&&n.values.size>1};})}));
}
function suggestedSelfIds(rows){
  const freq=new Map(), names=new Map(),conflicts=new Set();let eligible=0;
  for(const row of Array.isArray(rows)?rows:[]){
    if(!L.threadId(row?.id)||!Array.isArray(row.members)||row.members.length<2||row.members.length>L.MAX_MEMBERS)continue;
    const seen=new Set(row.members.map(m=>m?.id).filter(L.personId));
    if(seen.size<2)continue;eligible++;
    for(const m of row.members){if(!seen.has(m?.id))continue;
      freq.set(m.id,(freq.get(m.id)||0)+1);
      if(m.nameConflict)conflicts.add(m.id);
      if(!names.has(m.id) && L.goodName(m.name,m.id))names.set(m.id,bound(m.name,60));
    }
  }
  // Sparse, pristine profiles offer observed IDs for explicit manual review;
  // one group's membership can NEVER automatically identify its owner.
  const min=eligible<10?1:Math.max(3,Math.ceil(eligible*0.5));
  const ranked=[...freq].filter(([id,count])=>(eligible<10?C.validMRI(id):L.personId(id))&&count>=min)
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const candidates=ranked.slice(0,24).map(([id,count])=>({id,count,name:conflicts.has(id)?'':names.get(id)||'',nameConflict:conflicts.has(id)}));
  return {eligible,candidates,evidenceIds:ranked.slice(0,10000).map(([id])=>id)};
}
// Legacy indexes can contain hundreds of chats the user already left; do
// not require the user's ID to appear in 80% of those historical rosters.
// A user may explicitly type an ID only if several CURRENT cache rosters
// contain it. These are evidence of a cached ID, not authentication proof.
function legacySelfIdEvidence(rows){
  const frequency=new Map(),names=new Map();let eligible=0;
  for(const row of Array.isArray(rows)?rows:[]){
    if(!L.threadId(row?.id)||!Array.isArray(row.members)||row.members.length<2||row.members.length>L.MAX_MEMBERS)continue;
    const seen=new Set(row.members.map(m=>m?.id).filter(L.personId));
    if(seen.size<2)continue;
    eligible++;
    for(const m of row.members){
      if(!seen.has(m?.id))continue;
      frequency.set(m.id,(frequency.get(m.id)||0)+1);
      if(!names.has(m.id)&&L.goodName(m.name,m.id))names.set(m.id,bound(m.name,60));
    }
  }
  const eligibleIds=[...frequency].filter(([id,count])=>count>=3&&L.personId(id));
  eligibleIds.sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return {eligible,candidates:eligibleIds.slice(0,48).map(([id,count])=>({id,count,name:names.get(id)||''})),
    // Bounded to avoid keeping unnecessarily large identity maps in memory.
    confirmedByCache:eligibleIds.slice(0,10000).map(([id,count])=>({id,count}))};
}
function memberFrequency(rows,id){
  let eligible=0,count=0;
  for(const row of Array.isArray(rows)?rows:[]){
    if(!L.threadId(row?.id)||!Array.isArray(row.members)||row.members.length<2||row.members.length>L.MAX_MEMBERS)continue;
    const members=new Set(row.members.map(m=>m?.id).filter(L.personId));
    if(members.size<2)continue;
    eligible++;if(members.has(id))count++;
  }
  return {eligible,count};
}
async function pristineProfileForSetup(account){
  // Fail closed if any previous identity records exist in this Chrome profile.
  const active=await D.getMeta('active');if(active?.account)return false;
  for(const store of ['groups','people','edges','events','policies']){
    if((await D.getAll(store)).length)return false;
  }
  const metas=await D.getAll('meta');
  return !metas.some(m=>typeof m?.pk==='string' && (
    (m.pk.startsWith('account:')&&m.account!==account) ||
    (m.pk.startsWith('account-cache-scope:')&&m.approved===true&&m.account!==account)
  ));
}
function eligibleForFirstSetup(p){
  return p?.stats?.databases===1&&p.stats.partial!==true&&Array.isArray(p.rows)&&p.rows.length>=1&&
    new Set(p.rows.map(r=>r?.id)).size===p.rows.length&&
    p.rows.every(r=>L.threadId(r?.id)&&Array.isArray(r.members)&&r.members.length>=2&&
      ['CACHE_OBSERVED','CACHE_CONSISTENT'].includes(r.quality)&&r.members.length<=L.MAX_MEMBERS&&
      r.members.every(m=>L.personId(m?.id))&&new Set(r.members.map(m=>m.id)).size===r.members.length);
}
async function smallScopeContinuity(p,profile,scopeKey){
  if(!profile?.smallRosterBound||profile.smallScopeKey!==scopeKey||!scopeKey||!eligibleForFirstSetup(p)||
     !L.personId(profile.manualSelfId)||!L.threadId(profile.smallAnchorGroupId))return {ok:false,compared:0};
  const old=(await D.getAllFor('groups',profile.account)).find(g=>g.id===profile.smallAnchorGroupId);
  const fresh=p.rows.find(g=>g.id===profile.smallAnchorGroupId);
  if(!old||!fresh||!old.memberIds?.includes(profile.manualSelfId)||
     !fresh.members.some(m=>m.id===profile.manualSelfId))return {ok:false,compared:0};
  const peers=new Set(old.memberIds.filter(id=>L.personId(id)&&id!==profile.manualSelfId));
  return {ok:fresh.members.some(m=>peers.has(m.id)),compared:1,
    reason:'小号绑定的缓存范围、本人 ID 或初始群关系无法对应，已保持只读'};
}
async function resolveIdentity(p){
  const rosterHint=cleanMRI(p.accountHint),claim=p.tokenIdentity&&typeof p.tokenIdentity==='object'?p.tokenIdentity:{};
  const tokenMRI=cleanMRI(claim.mri);
  const active=await D.getMeta('active');
  const scopeKey=await cacheScopeKey(p);
  const linked=scopeKey?await D.getMeta(scopeKey):null;
  // Prefer an explicitly selected self ID over the weak roster-intersection
  // heuristic when the same approved Chrome profile still contains that ID.
  // Never treat the heuristic itself as proof of a Microsoft login.
  let confirmedSelfId='';
  if(!p.stats?.partial&&linked?.approved===true&&(!active?.account||active.account===linked.account)){
    const approved=await D.getMeta('account:'+linked.account);
    if(L.personId(approved?.manualSelfId)){
      const found=memberFrequency(p.rows,approved.manualSelfId);
      const clue=SELF.recommend(p.selfEvidence,new Set(p.rows.flatMap(r=>r.members.map(m=>m.id))),{
        single:p.stats?.databases===1,complete:!p.stats?.partial&&!p.stats?.selfCluesCapped});
      // Historical/exited chats may still be in cache, so a legitimate self ID
      // need not appear in most rosters. Require multiple independent roster
      // observations; the existing account must ALSO pass rosterContinuity.
      if(clue.status==='CANDIDATE'&&clue.personId===approved.manualSelfId)confirmedSelfId=approved.manualSelfId;
      else if(approved.smallRosterBound&&approved.smallScopeKey===scopeKey&&eligibleForFirstSetup(p)&&found.count>=1)
        confirmedSelfId=approved.manualSelfId;
      else if(found.eligible>=5&&found.count>=3)confirmedSelfId=approved.manualSelfId;
    }
  }
  const observed=confirmedSelfId||rosterHint;
  if(observed&&tokenMRI&&observed!==tokenMRI)
    return {mode:'READ_ONLY',account:'',reason:'账号身份线索冲突，禁止跨账号基线比对',canBind:false};
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
  let hasBaseline=!!candidate&&(await D.getAllFor('groups',candidate)).length>0;
  let existing=!!meta&&(hasBaseline||meta.manualBound===true);
  // Do not silently reuse an old provisional partition for a newly identified ID.
  if(observed&&!existing&&active?.account&&/^(?:manual|provisional):[a-f0-9]{32}$/.test(active.account)){
    const oldRows=await D.getAllFor('groups',active.account);
    if(oldRows.length){legacyLink=active.account;legacyUnlinked=true;candidate=active.account;meta=await D.getMeta('account:'+candidate);
      existing=true;hasBaseline=true;usingActive=true;}
  }
  const binding=!!meta&&(meta.verified===true||meta.manualBound===true);
  const currentSelfClue=SELF.recommend(p.selfEvidence,new Set(p.rows.flatMap(r=>r.members.map(m=>m.id))),{
    single:p.stats?.databases===1,complete:!p.stats?.partial&&!p.stats?.selfCluesCapped});
  if(currentSelfClue.status==='CONFLICT'||(C.validMRI(meta?.manualSelfId)&&currentSelfClue.status==='CANDIDATE'&&
      currentSelfClue.personId!==meta.manualSelfId))
    return {mode:'READ_ONLY',account:'',canBind:false,reason:'本人身份线索冲突，不能选择或沿用已有账号，请核对当前 Teams 登录身份'};
  const sameToken=!(meta?.tokenSubjectHash && p.tokenIdentity?.oid &&
    meta.tokenSubjectHash!==(await tokenSubjectFingerprint(p.tokenIdentity)));
  const continuity=existing&&(!observed||!!confirmedSelfId||meta?.smallRosterBound)&&!p.stats?.partial
    ?(meta?.smallRosterBound?await smallScopeContinuity(p,meta,scopeKey):await rosterContinuity(p.rows,candidate)):{ok:false,compared:0};
  const scopeApproved=!!scopeKey&&linked?.approved===true&&linked.account===candidate;
  // First setup must obtain an explicit self MRI selected by the user,
  // rather than silently treating the most common cached member as the owner.
  const namedSetupRows=setupRowsWithNames(p),setupPool=suggestedSelfIds(namedSetupRows);
  // Direct, explicit clues are not discarded merely for low group frequency.
  if(currentSelfClue.status==='CANDIDATE'&&!setupPool.evidenceIds.includes(currentSelfClue.personId))
    setupPool.evidenceIds.push(currentSelfClue.personId);
  const selfSuggestion=SELF.recommend(p.selfEvidence,new Set(setupPool.evidenceIds),{
    single:p.stats?.databases===1,complete:!p.stats?.partial&&!p.stats?.selfCluesCapped});
  if(selfSuggestion.status==='CANDIDATE'){
    const id=selfSuggestion.personId;
    let person=setupPool.candidates.find(c=>c.id===id);
    if(!person){const m=namedSetupRows.flatMap(r=>r.members).find(m=>m.id===id);
      person={id,count:memberFrequency(p.rows,id).count,name:m?.name||'',nameConflict:m?.nameConflict===true};}
    setupPool.candidates=[person,...setupPool.candidates.filter(c=>c.id!==id)].slice(0,24);
    selfSuggestion.name=person.name;selfSuggestion.nameConflict=person.nameConflict===true;
  }
  const hasSetupEvidence=!!scopeKey&&eligibleForFirstSetup(p)&&
    setupPool.candidates.length>0&&!hasBaseline&&
    await pristineProfileForSetup(candidate);
  const setupHash=hasSetupEvidence?await bootstrapSnapshotHash(p.rows):'';
  const firstSetupPossible=hasSetupEvidence&&
    (!binding||(scopeApproved&&!hasBaseline&&(meta?.bootstrapHash!==setupHash||
      !Number.isFinite(meta?.bootstrapApprovedAt)||Date.now()-meta.bootstrapApprovedAt>=10*60*1000)))&&
    (!linked?.approved||linked.account===candidate);
  const now=Date.now();
  const approvedBootstrap=hasSetupEvidence&&scopeApproved&&binding&&
    L.personId(meta?.manualSelfId)&&
    setupPool.evidenceIds.includes(meta.manualSelfId)&&
    typeof meta?.bootstrapHash==='string'&&meta.bootstrapHash===setupHash&&
    Number.isFinite(meta.bootstrapApprovedAt)&&now-meta.bootstrapApprovedAt<10*60*1000;
  // Existing accounts still require strong continuity; this bypass applies
  // ONLY once to an approved, pristine first-install account and exact scan.
  const trustedScope=!observed&&scopeApproved&&binding&&continuity.ok;
  const manualScopeSafe=meta?.smallRosterBound?(scopeApproved&&continuity.ok):!confirmedSelfId||continuity.ok||!hasBaseline;
  const requiresBootstrap=!hasBaseline&&L.personId(meta?.manualSelfId);
  const writable=(!requiresBootstrap&&(anchored||trustedScope)&&manualScopeSafe&&existing&&binding&&sameToken&&!legacyUnlinked)||
    (approvedBootstrap&&sameToken);
  const firstSetup=!writable&&firstSetupPossible;
  const canBind=!!candidate&&sameToken&&(
    !!observed || firstSetup || (!p.stats?.partial&&existing&&binding&&!!scopeKey&&continuity.ok&&!linked?.approved));
  return {mode:writable?'WRITE':'READ_ONLY',account:sameToken?candidate:'',scopeKey,
    reason:writable?'已匹配本地已确认的账号范围与群组基线（非服务器身份认证）':
      !candidate?'无法确定当前账号':
      !sameToken?'当前账号身份线索与绑定记录冲突':
      legacyUnlinked?'当前身份与旧版账号分区尚未人工关联，禁止写入原基线':
      firstSetup?'检测到新的独立浏览器资料与 '+p.rows.length+' 个缓存群。请确认一次当前 Teams 账号后安全建立本地基线':
      !existing?'当前身份尚未绑定本地基线':
      !observed&&!continuity.ok?continuity.reason||'缓存与基线无法安全对应，继续只读保护':
      !observed&&!scopeApproved?'账号缺少唯一身份线索：请确认一次当前缓存与已有基线的关联':
      !binding?'本地账号未批准绑定，暂不写入基线':
      '无法确认账号，暂不写入基线',
    canBind,firstSetup,setupHash:firstSetup?setupHash:'',
    selfCandidates:firstSetup?setupPool.candidates:[],eligibleGroups:setupPool.eligible,
    smallSetup:firstSetup&&setupPool.eligible<10,
    selfSuggestion:firstSetup?selfSuggestion:null,
    selfEvidenceIds:firstSetup?setupPool.evidenceIds:[],
    setupAnchors:firstSetup&&setupPool.eligible<10?p.rows.map(r=>({id:r.id,memberIds:r.members.map(m=>m.id)})):[],
    usingActive,observed,existing,legacyLink,identityLinkKey,
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
  let compared=0,observedAdded=0,ambiguous=0,notifyCount=0,infoNotices=0,critical=0,unknown=0;
  const ambiguousGroupIds=[];
  for(const row of p.rows){
    if(!L.threadId(row?.id)||!Array.isArray(row?.members)||row.members.length<2||row.members.length>L.MAX_MEMBERS||
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
         (severity==='REVIEW'&&policy.notifyUnknown)||(severity==='INFO'&&policy.notifyKnownTransfers)){
      notifyCount++;if(severity==='INFO')infoNotices++;}
    }
  }
  // Volatile deduplication only: no IndexedDB group/person/edge/event/meta writes in this branch.
  await chrome.storage.session.set({[GUARD_SEEN_KEY]:[...recent.entries()].slice(-300)});
  const state={mode:'READ_ONLY',reason:identity.legacyLink?'发现旧版未验证账号分区：仅只读比对；请确认绑定后沿用原有群组基线':identity.reason,account:account||'',canBind:identity.canBind,
    identityLinkKey:identity.legacyLink?identity.identityLinkKey:'',
    scopeKey:identity.canBind?identity.scopeKey||'':'',
    inspected:p.rows.length,compared,observedAdded,ambiguous,ambiguousGroupIds,unknown,critical,notifyCount,infoNotices,at:Date.now(),
    scanTrigger:['CACHE_WRITE','PERIODIC','REQUESTED'].includes(p.trigger)?p.trigger:'UNKNOWN',
    noBaseline:recorded.length===0,readerDegraded:identity.readerDegraded===true,
    firstSetup:identity.firstSetup===true,setupHash:identity.setupHash||'',
    selfCandidates:identity.firstSetup?(identity.selfCandidates||[]):[],eligibleGroups:identity.eligibleGroups||0,
    smallSetup:identity.smallSetup===true,selfEvidenceIds:identity.selfEvidenceIds||[],setupAnchors:identity.setupAnchors||[],
    selfSuggestion:identity.selfSuggestion||null};
  await saveGuard(state);
  // A foreground/cache-change scan must update telemetry too, even if no alarm
  // requested it. Incomplete roster reads must not count as healthy scans.
  const incomplete=identity.readerDegraded===true;
  await recordScanResult({ok:!incomplete,error:incomplete?state.reason:''});
  await refreshBadge();
  // Incomplete scans are diagnostic-only: never notify a supposed new member.
  if(notifyCount&&!p.stats?.partial)await notifyChanges({observedAdded,unknown,critical,notifyCount,infoNotices,readOnly:true},policy);
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
// Extension reload invalidates already-injected content scripts in still-open Teams tabs.
// Reattach packaged, extension-owned scripts only to the already permitted Teams origin.
// Never navigate/reload the Teams page or touch its ongoing messages.
const TEAMS_CONTENT_FILES=['lib/logic.js','lib/name-core.js','lib/contact-risk.js','lib/request-ui.js','lib/self-evidence.js','lib/isolated-reader.js','lib/request-cache.js','content.js','lib/request-view.js','overlay/overlay.js'];
const TEAMS_MAIN_FILES=['lib/cache-watch.js','page-reader.js'];
function isReaderConnectionError(message=''){
  return /Receiving end does not exist|Could not establish connection|Extension context invalidated|context invalidated|读取器未初始化|message port closed|message channel closed|listener indicated|连接已失效/i.test(String(message));
}
async function readerPing(tabId){
  let timer;
  try{return await Promise.race([
    chrome.tabs.sendMessage(tabId,{action:'PING'}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PING 超时')),2500);})
  ]);}catch{return null;}finally{clearTimeout(timer);}
}
async function reconnectReader(tabId){
  // This is deliberately gated on an unresponsive reader, so regular scans
  // cannot accumulate duplicate timers / event listeners in a live page.
  if(!chrome.scripting?.executeScript)return {ok:false,error:'当前浏览器不支持自动重新连接读取器'};
  try{
    // MAIN is a write-completion hint only, and cannot pass member data.
    await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:TEAMS_MAIN_FILES});
    await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',files:TEAMS_CONTENT_FILES});
    const ping=await readerPing(tabId);
    return ping?.ok===true?{ok:true}:{ok:false,error:'读取器重新注入后未能响应'};
  }catch(e){return {ok:false,error:'重新连接读取器失败：'+bound(e?.message,120)};}
}
async function scanTabWithRecovery(tabId){
  let initial,failed='';
  try{initial=await messageWithin(tabId,60000);
    if(initial?.ok)return initial;
    if(initial?.error && !isReaderConnectionError(initial.error))return initial;
    failed=initial?.error||'Teams 巡检没有返回结果';
  }catch(e){failed=String(e?.message||e);
    if(!isReaderConnectionError(failed))throw e;
  }
  // If PING still works, the live scanner is responding and may be in a
  // transient data failure; do not spawn a duplicate instance.
  if((await readerPing(tabId))?.ok)return {ok:false,error:bound(failed,150)||'缓存读取失败，稍后会自动重试'};
  const healed=await reconnectReader(tabId);
  if(!healed.ok)return healed;
  const again=await messageWithin(tabId,60000);
  return again?.ok?{...again,reconnected:true}:again||{ok:false,error:'重连后巡检未返回结果'};
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
            const res=await scanTabWithRecovery(tab.id);
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
  if(payload.stats?.rawGroupIds!==undefined&&
    (!Array.isArray(payload.stats.rawGroupIds)||payload.stats.rawGroupIds.length>6000||
     payload.stats.rawGroupIds.some(id=>!L.threadId(id))))return false;
  if(payload.nameHints!=null&&(!Array.isArray(payload.nameHints)||payload.nameHints.length>16000))return false;
  return true;
}
function addEvent(tx,account,data){
  const id=crypto.randomUUID(),rec={...data,pk:D.pk(account,id),id,account,status:data.severity==='SILENT'?'LOGGED':'OPEN',at:Date.now()};
  tx.objectStore('events').put(rec);return rec;
}
async function applyBatch(rows,account,policy,initialBaseline,repairLegacyEdges=false){
  // Transactional group/person/event updates. An alarm can never interleave a whitelist edit mid-transaction.
  return D.transaction(['groups','people','edges','events'],'readwrite',async tx=>{
    const groups=tx.objectStore('groups'), people=tx.objectStore('people'), edges=tx.objectStore('edges');
    let groupsChanged=0, observedAdded=0, unknown=0, critical=0, notifyCount=0, infoNotices=0, ambiguous=0, bootstrapped=0;
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
      const wasAmbiguous=old?.ambiguous===true;
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
            severity:severe,oldRosterCount:old.memberIds?.length||0,candidateRosterCount:ids.length,
            addedIds:diff.added.slice(0,100),removedIds:diff.missing.slice(0,100),
            diffTruncated:diff.added.length>100||diff.missing.length>100,
            message:'本地缓存名单存在不确定变化；请对照 Teams 真实成员列表人工核查'});
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
      // An ambiguous cache is an observation, NOT an approved group relation.
      // Reconcile any stale candidate edges left by older plugin versions only
      // after a stable scan or explicit human adoption of a candidate roster.
      if(!uncertain && ((repairLegacyEdges && !!old) || wasAmbiguous || diff.added?.length)){
        const acceptedIds=new Set(ids);
        const storedEdges=await D.request(edges.index('byGroup').getAll([account,row.id]));
        for(const edge of storedEdges){
          if(!acceptedIds.has(edge.personId))await D.request(edges.delete(edge.pk));
        }
      }
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
        // Keep unknown identities visible for review, but never assert that
        // a member belongs to this group based on an unverified candidate.
        if(!uncertain){
          const epk=D.pk(account,D.pk(row.id,member.id)),oldEdge=await D.request(edges.get(epk));
          if(!oldEdge)await D.request(edges.put({pk:epk,account,groupId:row.id,personId:member.id,
            firstSeen:Date.now(),lastSeen:Date.now(),seen:'OBSERVED'}));
          else{oldEdge.lastSeen=Date.now();await D.request(edges.put(oldEdge));}
        }
        const observedRelationship=acceptedNew.has(member.id);
        // A previously unseen identity MUST create a person-linked red review
        // event after the initial baseline, including new groups and ambiguous
        // candidates. Do not infer the actor or mistake cache observation for
        // a confirmed admission. A historical NEW/REVOKED identity keeps its
        // review priority even if previously observed in another group.
        const firstEver=!oldPerson&&!initialBaseline;
        if(observedRelationship||firstEver){
          // Only changes in an established, comparable group count as new
          // relationships. A new identity in an uncertain/new group is an
          // identity alert, not a confirmed member-join relationship.
          if(observedRelationship)observedAdded++;
          const severity=firstEver?(group.level==='CRITICAL'?'CRITICAL':'HIGH'):
            L.alertLevel({level:group.level,status:person.status,companyApproved:person.companyApproved},policy);
          if(severity==='CRITICAL')critical++;
          if(firstEver||severity==='CRITICAL'||(severity==='REVIEW'&&policy.notifyUnknown)||
             (severity==='HIGH'&&(person.status!=='NEW'||policy.notifyUnknown))||
             (severity==='INFO'&&policy.notifyKnownTransfers)){
            notifyCount++;if(severity==='INFO')infoNotices++;}
          if(firstEver)unknown++;
          addEvent(tx,account,{type:observedRelationship?'OBSERVED_ADDITION':'FIRST_SEEN_ID',groupId:row.id,personId:member.id,
            quality:row.quality,severity,personWasKnown:!!oldPerson,rosterUncertain:!!uncertain,
            nameSnapshot:person.manualName||person.name||'',
            message:firstEver?'该 ID 首次出现在本地索引中，必须核查；不等于确认谁执行了入群操作':
              '首次在该群缓存中观察到该成员 ID，不等于已确认实际入群'});
        }
      }
    }
    return {groupsChanged,observedAdded,unknown,critical,notifyCount,infoNotices,ambiguous,bootstrapped};
  });
}
// Only a completed account-safe scan may persist request UI evidence. Never
// infer a request from conversation/profile fields or the mere presence of an ID.
async function ingestContactRequests(payload,account){
  const ui=payload.requestUI;
  const valid=ui?.adapter==='VISIBLE_REQUEST_V1'&&ui.coverage==='LIMITED_UI'&&
    Array.isArray(ui.observations)&&ui.observations.length<=50&&ui.observations.every(o=>
      o&&typeof o.personId==='string'&&(!o.personId||C.validMRI(o.personId))&&
      ['CONTACT','CHAT'].includes(o.kind)&&typeof o.name==='string'&&o.name.length<=120&&typeof o.context==='string'&&o.context.length<=600&&
      typeof o.evidence==='string'&&o.evidence.length<=180);
  if(!valid||payload.stats.databases!==1){
    await D.putMeta({pk:'request-coverage:'+account,account,at:Date.now(),coverage:'UNAVAILABLE',
      reason:payload.stats.databases!==1?'存在多个 Teams 缓存，不能安全归属请求':'未获得可识别的请求界面证据'});
    return {ok:true,limited:true,created:0};
  }
  if(!ui.observations.length){
    await D.putMeta({pk:'request-coverage:'+account,account,at:Date.now(),coverage:'LIMITED_UI',observed:0,
      reason:'当前未观察到支持的可见请求界面，不能据此判定没有请求'});
    return {ok:true,limited:true,created:0};
  }
  const [people,edges,groups]=await Promise.all(['people','edges','groups'].map(s=>D.getAllFor(s,account)));
  // Historical roster snapshots can retain relations whose current edge was removed.
  const relations=[...edges];for(const g of groups)for(const id of g.memberIds||[])relations.push({personId:id,groupId:g.id});
  const profile=await D.getMeta('account:'+account);
  const directChats=Array.isArray(payload.stats.directChats)&&payload.stats.directChats.length<=2000?payload.stats.directChats:[];
  const observations=ui.observations.map(o=>{
    if(o.kind==='CONTACT')return o;
    // Generic chat requests may be group invitations. Require the SAME visible
    // conversation plus an affirmative 1:1 cache mapping, never member-count alone.
    const direct=directChats.find(d=>d?.id===o.context&&L.threadId(d.id)&&Array.isArray(d.memberIds)&&
      d.memberIds.length===2&&new Set(d.memberIds).size===2&&d.memberIds.every(C.validMRI)&&
      d.memberIds.includes(profile?.manualSelfId)&&d.memberIds.includes(o.personId));
    return direct?o:{...o,personId:'',name:'',evidence:'请求界面可见，但无法确认单聊、群邀请或请求者 ID；不认定为好友请求'};
  });
  const prepared=await Promise.all(observations.map(async o=>({o,
    id:'contact-'+(await hash(account+'\u001f'+(o.personId||'unresolved:'+o.context))).slice(0,48)})));
  let created=0,notify=0,impersonation=0;
  await D.transaction(['events'],'readwrite',async tx=>{
    const events=tx.objectStore('events');
    for(const {o,id} of prepared){
      const pk=D.pk(account,id),previous=await D.request(events.get(pk));
      const assessment=C.classify(o,people,relations,previous);
      const next={...C.evolve(previous,o,assessment,Date.now()),id,pk,account};
      // Keep all unresolved evidence. A panel disappearing, an incomplete scan
      // or a repeated ID never proves that Teams accepted/rejected a request.
      await D.request(events.put(next));
      if(!previous)created++;
      if(next.status==='OPEN'&&(!previous||previous.status!=='OPEN'||
        (next.severity!==previous.severity&&['HIGH','CRITICAL'].includes(next.severity)))){
        notify++;if(['CRITICAL','HIGH'].includes(next.severity))impersonation++;
      }
    }
  });
  await D.putMeta({pk:'request-coverage:'+account,account,at:Date.now(),coverage:'LIMITED_UI',
    observed:ui.observations.length,reason:'仅被动观察当前可见且可识别的请求界面；未见请求不代表没有请求；离开界面后的官方状态未知'});
  if(notify)try{await chrome.notifications.create('tgs-v3-contact-'+Date.now(),{type:'basic',
    iconUrl:chrome.runtime.getURL('icons/icon128.png'),priority:2,
    title:impersonation?'警惕：同名不同 ID 或已撤销信任':'陌生联系请求待核实',
    message:`发现 ${notify} 条需核实的联系请求观察。请勿直接通过，请先经原有聊天或可信渠道确认身份。`});}catch{}
  return {ok:true,limited:true,created};
}
async function reviewContactRequest(msg){
  // Only VERIFY grants trust. KEEP/CLOSE continue to handle the local alert
  // without requiring a fresh scan or silently altering trust.
  const account=msg.decision==='VERIFY'?await assertFreshScanForSensitiveEdit():await assertIdentitySafeToEdit();
  if(msg.account!==account)throw new Error('当前账号已变化，请刷新清单后再处理');
  if(typeof msg.id!=='string'||!/^contact-[a-f0-9]{48}$/.test(msg.id)||
    !['VERIFY','KEEP','CLOSE'].includes(msg.decision))throw new Error('请求审核参数无效');
  return D.transaction(['events','people'],'readwrite',async tx=>{
    const events=tx.objectStore('events'),people=tx.objectStore('people');
    const row=await D.request(events.get(D.pk(account,msg.id)));
    if(!row||row.type!=='CONTACT_REQUEST'||row.reviewRevision!==msg.revision)
      throw new Error('请求资料已变化，请重新查看详情再核实');
    if(msg.decision==='VERIFY'&&(!C.validMRI(row.personId)||msg.confirmed!==true||msg.personId!==row.personId||msg.last6!==row.personId.slice(-6)))
      throw new Error('请先通过可信渠道核实完整 ID，再勾选确认并填写 ID 尾号');
    const previousStatus=row.status;
    if(msg.decision==='VERIFY'){
      const pk=D.pk(account,row.personId),person=await D.request(people.get(pk));
      const next=person||{pk,account,id:row.personId,name:row.nameSnapshot,manualName:'',nameSource:'请求界面（人工核实）',
        firstSeen:row.at,aliases:[],companyApproved:false};
      next.status='APPROVED';next.reviewedAt=Date.now();
      next.reviewMethod='REQUEST_ID_CONFIRMED';await D.request(people.put(next));
      row.status='RESOLVED';row.reviewDecision='VERIFIED_ID';
    }else if(msg.decision==='CLOSE'){
      // Explicitly closing ONE local alert never changes trust or official Teams status.
      if(msg.confirmed!==true)throw new Error('结束本地提醒需要单独确认，不会批准对方');
      row.status='ACKNOWLEDGED';row.reviewDecision='CLOSED_WITHOUT_TRUST';
    }else{row.status='OPEN';row.reviewDecision='KEEP_PENDING';}
    row.reviewedAt=Date.now();row.reviewRevision++;await D.request(events.put(row));
    addEvent(tx,account,{type:'CONTACT_REQUEST_REVIEWED',personId:row.personId,severity:'SILENT',
      requestEventId:row.id,decision:row.reviewDecision,previousStatus,nextStatus:row.status,
      message:'本地请求提醒处理记录；没有接受、拒绝或发送 Teams 消息'});
    return {ok:true};
  });
}

async function ingest(p,scanTabId){
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
  await saveGuard({mode:'WRITE',reason:'已匹配已绑定账号',account,canBind:false,
    scanTabId:Number.isInteger(scanTabId)?scanTabId:null,at:Date.now()});
  const policy=await D.getPolicy(account);
  // Compare BEFORE this scan writes group IDs/names. Request-only observations never join people.
  let contactResult;
  try{contactResult=await ingestContactRequests(p,account);}catch{contactResult={ok:false,limited:true};}
  const hints=new Map();
  if(Array.isArray(p.nameHints)&&p.nameHints.length<=16000){
    for(const h of p.nameHints){if(L.personId(h?.id)&&L.goodName(h?.name,h.id))
      hints.set(h.id,{name:L.goodName(h.name,h.id),source:bound(h.source,36)||'Teams 元数据'});}
  }
  const initialBaseline=(await D.getAllFor('groups',account)).length===0;
  // Older releases could create edges from an unverified candidate roster.
  // Sweep existing stable group edges once after upgrading, then only when a
  // group has changed or just left ambiguous mode. Avoid 399 extra indexed
  // queries on every unchanged 30-second scan.
  const edgeRepairKey='edge-reconcile-v1:'+account;
  const repairLegacyEdges=(await D.getMeta(edgeRepairKey))?.done!==true;
  const rows=p.rows.map(row=>({...row,members:Array.isArray(row.members)?row.members.map(m=>{
    const hint=hints.get(m.id);return (hint&&hint.source==='Teams 用户资料缓存')?{...m,name:hint.name,nameSource:hint.source}:((!L.goodName(m.name,m.id)&&hint)?{...m,name:hint.name,nameSource:hint.source}:m);
  }):[]}));let changes={groupsChanged:0,observedAdded:0,unknown:0,critical:0,notifyCount:0,infoNotices:0,ambiguous:0,bootstrapped:0};
  // Small bounded transactions keep service workers responsive with large Teams accounts.
  for(let i=0;i<rows.length;i+=35){const done=await applyBatch(rows.slice(i,i+35),account,policy,initialBaseline,repairLegacyEdges);
    for(const k of Object.keys(changes))changes[k]+=done[k]||0;}
  if(repairLegacyEdges)await D.putMeta({pk:edgeRepairKey,account,done:true,at:Date.now()});
  // This is a *cache-source* snapshot, not a confirmed Teams membership list.
  // Persist only after an entire, non-partial cache scan was ingested. It makes
  // old extension-only records distinguishable from conversations still present
  // in Teams' local IndexedDB, without deleting audits, aliases or baselines.
  const boundAccount=await D.getMeta('account:'+account);
  const confirmedSelfId=boundAccount?.manualBound===true&&L.personId(boundAccount.manualSelfId)?boundAccount.manualSelfId:'';
  const cacheGroupIds=[...new Set(Array.isArray(p.stats.rawGroupIds)?p.stats.rawGroupIds:rows.map(row=>row.id))];
  const cacheSelfIds=confirmedSelfId? [...new Set(rows.filter(row=>row.members.some(m=>m.id===confirmedSelfId)).map(row=>row.id))]:[];
  const cacheSnapshot={account,at:Date.now(),complete:true,groupIds:cacheGroupIds,
    rosterGroupIds:[...new Set(rows.map(row=>row.id))],
    selfConfirmed:!!confirmedSelfId,selfIncludedGroupIds:cacheSelfIds};
  const active={pk:'active',account,verified,at:Date.now(),
    scanTabId:Number.isInteger(scanTabId)?scanTabId:null,cacheSnapshot,stats:{records:p.stats.records,candidates:p.stats.candidates,
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
    // First setup proof is single-use; subsequent scans use roster continuity.
    bootstrapHash:'',bootstrapApprovedAt:0,
    tokenSubjectHash:existingMeta?.tokenSubjectHash||jwtHash||''});
  // Older working profiles can have hundreds of saved groups without any
  // user-confirmed self ID. Prepare candidates only after a successful WRITE
  // scan; do not silently identify the user and do not alter stored baselines.
  if(!L.personId(existingMeta?.manualSelfId)){
    const pool=legacySelfIdEvidence(rows);
    const offer=pool.eligible>=10 && pool.candidates.length ? {
      account,at:Date.now(),scopeKey:identity.scopeKey||'',
      eligible:pool.eligible,candidates:pool.candidates,confirmedByCache:pool.confirmedByCache
    }:null;
    await chrome.storage.session.set({[SELF_ID_OFFER_KEY]:offer});
  }else{
    await chrome.storage.session.set({[SELF_ID_OFFER_KEY]:null});
  }

  await pruneOldEvents(account).catch(e=>console.warn('历史清理失败',e));
  const total=await counts(account);
  await recordScanResult({ok:true});
  await refreshBadge();
  if(changes.notifyCount)await notifyChanges(changes,policy);
  // A completed scan updates the health timestamp, even when no roster changed.
  await broadcastOverlay();
  lastIngest=Date.now();
  return {ok:true,account,verified,scanned:rows.length,...changes,summary:total,contactResult};
}
async function pruneOldEvents(account){
  const day=24*60*60*1000,meta=await D.getMeta('pruned:'+account);
  if(meta?.at && Date.now()-meta.at<day)return;
  const cutoff=Date.now()-180*day, all=await D.getAllFor('events',account);
  const olds=all.filter(e=>e.at<cutoff && e.status!=='OPEN' && !['CONTACT_REQUEST','CONTACT_REQUEST_REVIEWED','IDENTITY_REVIEWED'].includes(e.type)).slice(0,1500);
  for(let i=0;i<olds.length;i+=150){await D.transaction(['events'],'readwrite',async tx=>{
    for(const e of olds.slice(i,i+150))await D.request(tx.objectStore('events').delete(e.pk));
  });}
  await D.putMeta({pk:'pruned:'+account,at:Date.now()});
}
async function counts(account){
  const [groups,people,events,edges]=await Promise.all(['groups','people','events','edges'].map(s=>D.getAllFor(s,account)));
  const requests=C.summary(events);
  const unresolved=events.filter(e=>e.type!=='CONTACT_REQUEST'&&e.status==='OPEN'&&e.severity!=='SILENT');
  return {requests,groups:groups.length,people:people.length,edges:edges.length,criticalGroups:groups.filter(g=>g.level==='CRITICAL').length,
    newUnknown:people.filter(p=>p.status==='NEW').length,legacyUnknown:people.filter(p=>p.status==='LEGACY').length,
    openUrgent:unresolved.filter(e=>['CRITICAL','HIGH','REVIEW'].includes(e.severity)).length,
    // INFO is an unread observation, not an actionable security alarm.
    openInfo:unresolved.filter(e=>e.severity==='INFO').length,
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
  const newUnknown=n?.newUnknown||0,openUrgent=n?.openUrgent||0,openInfo=n?.openInfo||0;
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
  const level=newUnknown||openUrgent||n?.requests?.pending?'alert':readOnly?'readonly':
    !lastRead?'uninitialized':Date.now()-lastRead>SCAN_STALE_MS?'stale':ambiguous?'review':openInfo?'info':'ok';
  return {level,indexed,guard:guard||null,active:active||null,counts:n,
    groups:readOnly?(guard.inspected||0):(n?.groups||0),
    newUnknown,openUrgent,openInfo,ambiguous,lastRead,
    // Explicitly separate uncertain, ephemeral READ_ONLY observations from
    // saved unresolved records so the UI never fabricates processed events.
    observedOnly:readOnly?(guard.observedAdded||0):0,scanHealth:health};
}
// Badge shows a number only for saved pending actions. Non-red conditions use
// amber !, matching both the popup and the page overlay, never the old account.
async function updateActionBadge(n,level='ok',guard=null,tabId=null,notice=null){
  const identities=Number.isInteger(n?.newUnknown)&&n.newUnknown>0?n.newUnknown:0;
  const events=Number.isInteger(n?.openUrgent)&&n.openUrgent>0?n.openUrgent:0;
  const info=Number.isInteger(n?.openInfo)&&n.openInfo>0?n.openInfo:0;
  const requests=n?.requests||{pending:0};
  const total=identities+events+requests.pending;
  const red=total>0||notice?.pending===true,amber=!red&&(['readonly','review','stale','uninitialized'].includes(level));
  const blue=!red&&!amber&&info>0;
  const scope=Number.isInteger(tabId)?{tabId}:{};
  await chrome.action.setBadgeBackgroundColor({...scope,color:red?'#c52a32':amber?'#b7791f':blue?'#2968ae':'#64748b'});
  await chrome.action.setBadgeText({...scope,text:red?(total?(total>99?'99+':String(total)):'!'):amber?'!':blue?(info>99?'99+':String(info)):''});
  const suffix=guard?.readerDegraded===true?' · 缓存读取待恢复':guard?.mode==='READ_ONLY'?' · 账号只读守护':'';
  await chrome.action.setTitle?.({...scope,title:notice?.pending&&!total?'TeamsGroupSentry · 聊天请求待核实 · 务必核实身份':red
    ?(requests.pending?`TeamsGroupSentry · ${requests.headline}${suffix}`:`TeamsGroupSentry · 新身份待审 ${identities} · 重要未处理 ${events}${suffix}`):
    level==='readonly'?(guard?.readerDegraded===true?'TeamsGroupSentry · Teams 缓存读取不完整，正在自动重试':'TeamsGroupSentry · 账号只读守护，请核对当前账号'):
    level==='review'?'TeamsGroupSentry · 群成员名单待人工核查':
    level==='stale'?'TeamsGroupSentry · 最近巡检未更新，请查看失败原因':
    level==='uninitialized'?'TeamsGroupSentry · 尚未建立巡检索引':
    blue?`TeamsGroupSentry · ${info} 条普通跨群事件待查看（非安全警报）`:
    'TeamsGroupSentry · 暂无待处理异常'});
}
async function refreshBadge(){
  const state=await statusSnapshot();
  await updateActionBadge(state.counts,state.level,state.guard);
  // Override only tabs with their own observation; no request count is shared
  // with another Teams tab/account. Other saved group alarms retain priority.
  try{const tabs=await chrome.tabs.query({url:'https://teams.live.com/*'});
    await Promise.all(tabs.slice(0,24).map(async tab=>{const r=await noticeRecord(tab.id);
      if(r)await updateActionBadge(state.counts,state.level,state.guard,tab.id,N.view(r));}));
  }catch{}
}
async function notifyChanges(changes,policy){
  const notable=changes.notifyCount;
  if(!notable)return;
  // INFO-only observations are not new strangers or confirmed admissions.
  // Give the notification a faithful, neutral title without changing priority,
  // event persistence, or the user's notification preference.
  const infoOnly=changes.notifyCount>0&&changes.infoNotices===changes.notifyCount;
  const title=changes.critical?'Teams 重点群需要核查':infoOnly?(changes.readOnly?'Teams 只读观察到跨群变化':'Teams 已知成员跨群变化（普通观察）'):'Teams 群成员变化待核查';
  const message=infoOnly
    ?(changes.readOnly?`本次只读观察到 ${changes.infoNotices} 条普通跨群变化，未写入正式事件。请先核实缓存或当前账号。`:
      `本次在 Teams 本地缓存中观察到 ${changes.infoNotices} 条普通跨群变化。并非服务器确认入群，请查看对应群组。`)
    :`本次本地缓存观察：${changes.observedAdded} 个群成员关系变化，${changes.unknown} 个首次出现的身份，重点事项 ${changes.critical} 条。请到人员安全中心核实。`;
  try{await chrome.notifications.create('tgs-v3-'+Date.now(),{type:'basic',iconUrl:chrome.runtime.getURL('icons/icon128.png'),
    title,message,priority:2});}catch{}
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
// High-impact trust/roster writes require the SAME recently scanned Teams tab
// and a fresh successful WRITE scan. This does not reset or re-confirm the
// user's persisted account binding after a browser restart: another scan is
// sufficient. Read-only views, event acknowledgements, and notes are unchanged.
async function assertFreshScanForSensitiveEdit(){
  const account=await assertIdentitySafeToEdit();
  const [guard,active]=await Promise.all([sessionGuard(),D.getMeta('active')]);
  const now=Date.now();
  const recent=at=>Number.isFinite(at)&&at>0&&at<=now+5000&&now-at<=SCAN_STALE_MS;
  if(guard?.mode!=='WRITE'||guard.account!==account||active?.account!==account||
     !Number.isInteger(guard.scanTabId)||guard.scanTabId<0||
     !Number.isInteger(active.scanTabId)||active.scanTabId<0||
     guard.scanTabId!==active.scanTabId||!recent(guard.at)||!recent(active.at))
    throw new Error('账号巡检已过期或页面不一致，请切换到 Teams 点击「立即巡检」后重试；无需重新确认本人 ID');
  return account;
}
// Acknowledge only non-critical informational observations and uncertain-roster
// REVIEW cards in bulk. Unknown or revoked identities remain individually
// actionable. This does NOT approve anyone or adopt a candidate roster.
async function acknowledgeRoutineEvents(ids){
  const account=await assertIdentitySafeToEdit();
  if(!Array.isArray(ids)||!ids.length||ids.length>250||
     ids.some(id=>typeof id!=='string'||id.length>90)||new Set(ids).size!==ids.length)
    throw new Error('批量事件数量或标识无效');
  return D.transaction(['events'],'readwrite',async tx=>{
    const store=tx.objectStore('events'),selected=[];
    // Validate ALL IDs before writing anything, including under mocked DBs.
    for(const id of ids){
      const rec=await D.request(store.get(D.pk(account,id)));
      if(!rec||rec.account!==account||rec.status!=='OPEN')throw new Error('事件已经处理或不属于当前账号，请刷新后重试');
      if(!(rec.severity==='INFO'||(rec.type==='ROSTER_UNCERTAIN'&&rec.severity==='REVIEW')))
        throw new Error('包含必须逐项核查的安全事件，已拒绝批量操作');
      selected.push(rec);
    }
    for(const rec of selected){
      rec.status='ACKNOWLEDGED';rec.reviewedAt=Date.now();
      rec.reviewMethod='BULK_ACK_ONLY';
      await D.request(store.put(rec));
    }
    return {ok:true,changed:selected.length};
  });
}
async function edit(msg){
  await assertIdentitySafeToEdit();
  if(msg.kind==='person'&&['status','companyApproved'].includes(msg.field))
    await assertFreshScanForSensitiveEdit();
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
    return D.transaction(['people','events'],'readwrite',async tx=>{
      const store=tx.objectStore('people'),row=await D.request(store.get(D.pk(account,msg.id)));
      if(!row)throw new Error('人员不存在');
      const previousStatus=row.status;
      if(msg.field==='status'&&['APPROVED','NEW','LEGACY','IGNORED','REVOKED'].includes(msg.value))row.status=msg.value;
      else if(msg.field==='companyApproved'&&typeof msg.value==='boolean')row.companyApproved=msg.value;
      else if(msg.field==='manualName'&&typeof msg.value==='string')row.manualName=msg.value.trim().slice(0,120);
      else throw new Error('操作不允许');
      row.reviewedAt=Date.now();await D.request(store.put(row));
      if(previousStatus!==row.status)addEvent(tx,account,{type:'IDENTITY_REVIEWED',personId:row.id,severity:'SILENT',previousStatus,nextStatus:row.status,message:'用户逐项修改本地身份审核状态'});
      return {ok:true};
    });
  }
  if(msg.kind==='event'){
    return D.transaction(['events'],'readwrite',async tx=>{
      const store=tx.objectStore('events'),row=await D.request(store.get(D.pk(account,msg.id)));
      if(!row)throw new Error('事件不存在');
      if(row.type==='CONTACT_REQUEST')throw new Error('联系请求必须在陌生好友清单逐项核实；已查看不能批准身份');
      row.status=msg.value==='ACKNOWLEDGED'?'ACKNOWLEDGED':'OPEN';
      row.reviewedAt=Date.now();await D.request(store.put(row));return {ok:true};
    });
  }
  throw new Error('未知编辑操作');
}
// Adopt a reviewed CACHE observation for exactly one group; this is NOT
// proof of server-side joining/leaving and never approves unknown people.
async function confirmRosterReview(msg){
  await assertFreshScanForSensitiveEdit();
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
    // people or their global approvals. Reconcile ALL active group edges,
    // including unverified candidate edges left by older plugin versions.
    const storedEdges=await D.request(edges.index('byGroup').getAll([account,row.id]));
    for(const edge of storedEdges){
      if(!updated.has(edge.personId))await D.request(edges.delete(edge.pk));
    }
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
  await assertFreshScanForSensitiveEdit();
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
  const fromPageAllowed=new Set(['INGEST','OVERLAY_STATUS','OVERLAY_PREFS_SET','OPEN_DASHBOARD','REQUEST_UI_NOTICE','ACK_REQUEST_UI_NOTICE','REQUEST_SELF_CONTEXT']);
  if(!own && !(page&&fromPageAllowed.has(msg.action)))return;
  if(msg.action==='INGEST'&&!page)return;
  if(msg.action==='REQUEST_UI_NOTICE'&&!page)return;
  (async()=>{
    switch(msg.action){
      case 'INGEST':return serial(()=>ingest(msg.payload,sender.tab?.id));
      case 'REQUEST_UI_NOTICE':return ingestRequestNotice(msg,sender);
      case 'REQUEST_SELF_CONTEXT':{
        if(!page||!/^[a-f0-9]{64}$/.test(msg.scopeDigest||''))return {ok:true,selfId:''};
        const scope=await D.getMeta('account-cache-scope:'+msg.scopeDigest.slice(0,32));
        if(scope?.approved!==true||!scope.account)return {ok:true,selfId:''};
        const profile=await D.getMeta('account:'+scope.account);
        return {ok:true,selfId:profile?.verified===true&&profile.manualBound===true&&C.validMRI(profile.manualSelfId)?profile.manualSelfId:''};
      }
      case 'REQUEST_NOTICE_STATUS':return {ok:true,requestNotice:await currentRequestNotice(sender)};
      case 'ACK_REQUEST_UI_NOTICE':return acknowledgeRequestNotice(msg,sender);
      case 'SCAN_NOW':return scanTabs(true);
      case 'NAVIGATE_CHAT':{
        const guard=await sessionGuard(),active=await D.getMeta('active');
        if(!active?.account||!active.verified||guard?.mode!=='WRITE'||
           guard.account!==active.account)
          throw new Error('当前账号尚未安全确认，不能打开历史聊天');
        // A cached WRITE guard may refer to a different Teams account after a
        // login switch. Require fresh evidence AND the exact tab that scanned.
        if(!Number.isInteger(active.scanTabId)||!Number.isInteger(guard.scanTabId)||
           active.scanTabId!==guard.scanTabId||
           !Number.isFinite(active.at)||!Number.isFinite(guard.at)||
           Date.now()-active.at>180000||Date.now()-guard.at>180000||
           active.at>Date.now()+5000||guard.at>Date.now()+5000)
          throw new Error('账号巡检信息已过期，请先在 Teams 执行一次巡检再打开聊天');
        const kind=msg.kind, id=msg.id;
        if(kind!=='group'&&kind!=='person')throw new Error('聊天类型不正确');
        if(kind==='group'&&!L.threadId(id) || kind==='person'&&!L.personId(id))
          throw new Error('聊天 ID 无效');
        const source=kind==='group'?'groups':'people';
        const record=await D.transaction([source],'readonly',tx=>
          D.request(tx.objectStore(source).get(D.pk(active.account,id))));
        if(!record)throw new Error('当前账号未保存这条聊天资料');
        // Native Teams group title is strongest. For unnamed groups, Teams
        // searches the *participant names separated by spaces*, not the ID or
        // our local label ("成员：张三、李四"). Never treat a manually given
        // alias as the real Teams title, or infer ID-to-name correspondence.
        const nameToken=value=>{
          const name=L.goodName(value,id);
          return name&&!/^(?:未命名群|成员：|8:|19:)/i.test(name)?name.trim():'';
        };
        const joinNames=names=>{
          const clean=[...new Set(names.map(nameToken).filter(Boolean))].slice(0,8);
          let text='';
          for(const n of clean){if((text?text.length+1:0)+n.length>100)break;
            text+=(text?' ':'')+n;}
          return text;
        };
        let searchText='';
        if(kind==='group'){
          const titled=nameToken(record.title);
          if(titled)searchText=titled;
          else{
            const nameHints=Array.isArray(record.titleNameHints)?record.titleNameHints:[];
            if(nameHints.length>=2)searchText=joinNames(nameHints);
            // Some Teams caches use spaces rather than comma punctuation in
            // longTitle. Keep the exact native order, just normalize delimiters.
            if(!searchText&&nameToken(record.longTitle))
              searchText=String(record.longTitle).replace(/[,，、;；\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
            // If the cache has no title at all, use native recorded member
            // names (never hand-entered aliases) as a search hint only.
            if(!searchText&&Array.isArray(record.memberIds)&&record.memberIds.length){
              const accountMeta=await D.getMeta('account:'+active.account);
              const selfMRI=L.personId(accountMeta?.manualSelfId)?accountMeta.manualSelfId:'';
              const mids=record.memberIds.filter(mid=>L.personId(mid)&&mid!==selfMRI).slice(0,8);
              const members=await D.transaction(['people'],'readonly',tx=>
                Promise.all(mids.map(mid=>D.request(tx.objectStore('people').get(D.pk(active.account,mid))))));
              searchText=joinNames(members.filter(Boolean).map(p=>p.name));
            }
          }
        }else{
          // Manual input is a search-only hint: it never grants permission to
          // open a chat unless the matching conversation ID was verified.
          searchText=nameToken(msg.searchQuery)||
            [record.name,record.manualName,...(Array.isArray(record.aliases)?record.aliases.slice(0,3):[])]
              .map(nameToken).find(Boolean)||'';
        }
        let selfId='';
        if(kind==='person'){
          const profile=await D.getMeta('account:'+active.account);
          selfId=profile?.manualSelfId;
          if(!L.personId(selfId))throw new Error('请先在设置中确认本人 Teams ID，再打开个人聊天');
          if(id===selfId)throw new Error('不能打开与自己的单人聊天');
        }
        const tabs=(await chrome.tabs.query({url:'https://teams.live.com/*'}))
          .filter(t=>Number.isInteger(t.id));
        if(!tabs.length)return {ok:false,code:'NO_TEAMS_TAB',
          error:'请先打开 Teams 网页，再点击打开聊天'};
        // Do not select a seemingly nearby tab when there are multiple Teams
        // windows: it might be logged into a different account.
        if(tabs.length!==1)return {ok:false,code:'MULTIPLE_TEAMS_TABS',
          error:'检测到多个 Teams 页面，请暂时只保留一个 Teams 标签页，避免打开错误账号'};
        const tab=tabs[0];
        if(tab.id!==active.scanTabId)return {ok:false,code:'UNVERIFIED_TEAMS_TAB',
          error:'当前 Teams 页面不是最近确认的巡检页面，请先在该页面执行一次巡检再重试'};
        // Virtualized Teams sidebar rows are often absent while the tab is in
        // the background. Bring the already verified tab forward BEFORE
        // searching its DOM; do not activate a different or unverified tab.
        try{
          // Bring the VERIFIED Teams tab and its Chrome window forward before
          // issuing any DOM navigation. The content script independently waits
          // for document.visibilityState and document.hasFocus.
          await chrome.tabs.update(tab.id,{active:true});
          await chrome.windows.update(tab.windowId,{focused:true});
        }catch{return {ok:false,code:'TAB_NOT_VISIBLE',error:'无法切换到 Teams 页面，请检查浏览器窗口是否正常打开'};}
        // If lookup fails, return focus to the extension's detail/selection UI
        // so the user can actually see the reason and any verified choices.
        const restoreDashboard=async()=>{
          const sourceTab=own&&sender.tab;
          if(!Number.isInteger(sourceTab?.id)||sourceTab.id===tab.id)return;
          try{await chrome.tabs.update(sourceTab.id,{active:true});}catch{}
          if(Number.isInteger(sourceTab.windowId))
            try{await chrome.windows.update(sourceTab.windowId,{focused:true});}catch{}
        };
        let response;
        try{response=await chrome.tabs.sendMessage(tab.id,{action:'NAVIGATE_TEAMS_CHAT',kind,searchText,
          ...(kind==='group'?{chatId:id}:{personId:id,selfId,...(msg.chatId?{chatId:msg.chatId}:{})})});}
        catch{await restoreDashboard();return {ok:false,code:'CONTENT_UNAVAILABLE',error:'Teams 页面尚未连接插件，请刷新 Teams 后重试'};}
        if(!response?.ok){
          // A valid Teams filter query is useful even when we cannot validate
          // the result ID (old/exited chats, DOM virtualization). Leave Teams
          // in front with the exact search text for the user to choose, while
          // clearly reporting that no automatic chat opening took place.
          if(response?.code==='SEARCH_NO_MATCH'&&response.searched===true)
            return {ok:true,opened:false,assisted:true,reason:'SEARCH_NO_MATCH',kind};
          await restoreDashboard();
          const reasons={NOT_RENDERED:'Teams 当前未加载这条聊天，请尝试从搜索框查找',
            SEARCH_UNAVAILABLE:'Teams 聊天筛选框暂时无法输入，请在 Teams 展开聊天搜索后重试',
            SEARCH_ACTIVATION_REQUIRED:'已切换到 Teams，但筛选框暂时不可用；请确认当前 Teams 界面正常加载后重试',
            TEAMS_NOT_FOCUSED:'无法确认 Teams 页面已经切换到前台，已停止搜索以避免误操作',
            NO_SEARCH_NAME:'缺少可搜索的姓名，请在安全中心输入 Teams 中显示的姓名再搜索',
            SEARCH_NO_MATCH:'搜索后没有找到能与原聊天 ID 匹配的结果，可能已退出或当前无权限',
            NO_DIRECT_CHAT:'本地缓存找不到与该人员对应的已有单聊，不能自动新建聊天',
            AMBIGUOUS_CHAT:'找到多条经过核对的个人聊天，请选择要打开的一条',
            TOO_MANY_CHATS:'该联系人有太多历史会话，暂时不能可靠定位',
            INVALID_CHAT_SELECTION:'所选聊天不属于这个联系人，已停止跳转',
            UNVERIFIED_CHAT_TYPE:'无法确定缓存里的双人会话是否是单聊，已停止跳转以防打开双人群',
            CACHE_INCOMPLETE:'Teams 会话缓存不完整，请稍后再试',
            TAB_NOT_VISIBLE:'请先将 Teams 标签页切换为可见，再重试',
            LOOKUP_FAILED:'读取聊天对应关系失败，请稍后重试',
            NAVIGATION_BUSY:'正在打开上一条聊天，请稍后再试'};
          return {ok:false,code:response?.code||'NAVIGATION_FAILED',
            error:reasons[response?.code]||'无法可靠打开该聊天，请在 Teams 中手动查找',
            ...(response?.code==='AMBIGUOUS_CHAT'&&Array.isArray(response.chatIds)?
              {chatIds:response.chatIds.filter(id=>L.threadId(id)).slice(0,12)}:{})};
        }
        // Assisted navigation intentionally opens only Teams search, not a
        // guessed personal chat. Report that distinction to the dashboard.
        if(response.assisted===true&&response.opened===false)
          return {ok:true,opened:false,assisted:true};
        return {ok:true,opened:true};
      }
      // Only first-party extension pages can request/confirm a local self ID.
      // READ_ONLY, stale and mismatched-account states never reveal candidates.
      case 'SELF_ID_STATUS':{
        const active=await D.getMeta('active'),guard=await sessionGuard();
        if(!active?.account||guard?.mode!=='WRITE'||guard.account!==active.account)
          return {ok:true,available:false,confirmed:false,reason:'请先确认当前账号已正常巡检；只读状态不能核对本人 ID'};
        const accountMeta=await D.getMeta('account:'+active.account);
        if(L.personId(accountMeta?.manualSelfId))
          return {ok:true,available:false,confirmed:true,selfId:accountMeta.manualSelfId};
        const offer=(await chrome.storage.session.get(SELF_ID_OFFER_KEY))[SELF_ID_OFFER_KEY];
        const ready=!!offer&&offer.account===active.account&&Date.now()-offer.at<SELF_ID_OFFER_TTL&&
          offer.eligible>=10&&Array.isArray(offer.candidates)&&offer.candidates.length>0;
        return {ok:true,available:ready,confirmed:false,eligibleGroups:ready?offer.eligible:0,
          candidates:ready?offer.candidates:[],reason:ready?'':'请先在 Teams 中完成一次巡检，再核对本人 ID'};
      }
      case 'CONFIRM_SELF_ID':return serial(async()=>{
        await requirePrepared();
        const active=await D.getMeta('active'),guard=await sessionGuard();
        const account=active?.account;
        if(!account||guard?.mode!=='WRITE'||guard.account!==account||account!==msg.account)
          throw new Error('当前账号不处于安全巡检状态，已拒绝修改身份');
        const profile=await D.getMeta('account:'+account);
        if(!profile||(profile.manualBound!==true&&profile.verified!==true)||
           (await D.getAllFor('groups',account)).length<10)
          throw new Error('尚无足够的已绑定历史群组，不能使用旧账号身份核对');
        if(L.personId(profile.manualSelfId))throw new Error('本人 ID 已确认，不允许直接覆盖原绑定');
        const offer=(await chrome.storage.session.get(SELF_ID_OFFER_KEY))[SELF_ID_OFFER_KEY];
        if(!offer||offer.account!==account||Date.now()-offer.at>SELF_ID_OFFER_TTL||offer.eligible<10)
          throw new Error('候选名单已过期，请重新巡检后核对');
        const selfId=cleanMRI(msg.selfId),evidence=Array.isArray(offer.confirmedByCache)&&
          offer.confirmedByCache.find(c=>c.id===selfId);
        if(!L.personId(selfId)||!evidence||evidence.count<3)
          throw new Error('该 ID 未在最近巡检的至少 3 个群名单里找到，不能确认');
        if(typeof msg.last6!=='string'||msg.last6!==selfId.slice(-6))
          throw new Error('ID 尾号核对失败，身份未保存');
        const identityKey='identity-link:'+(await hash(selfId)).slice(0,32);
        const linked=await D.getMeta(identityKey);
        if(linked?.account&&linked.account!==account)
          throw new Error('此 ID 已关联另一个历史账号，禁止自动合并');
        const scopeKey=offer.scopeKey;
        if(!/^account-cache-scope:[a-f0-9]{32}$/.test(scopeKey||''))
          throw new Error('无法核实浏览器缓存来源，拒绝保存');
        const oldScope=await D.getMeta(scopeKey);
        if(oldScope?.approved===true&&oldScope.account!==account)
          throw new Error('此缓存已绑定其他账号，拒绝覆盖');
        // Commit identity metadata atomically; never rename the account partition
        // or edit its groups, people, events, edges, policies or existing baseline.
        const now=Date.now();
        await D.transaction(['meta'],'readwrite',async tx=>{
          const store=tx.objectStore('meta');
          await D.request(store.put({...profile,manualBound:true,manualSelfId:selfId,
            manualSelfConfirmedAt:now,manualSelfMethod:'user-reviewed-cache-candidate'}));
          await D.request(store.put({pk:identityKey,account,approvedAt:now}));
          if(oldScope?.approved!==true)
            await D.request(store.put({pk:scopeKey,account,approved:true,approvedAt:now}));
        });
        await chrome.storage.session.set({[SELF_ID_OFFER_KEY]:null});
        return {ok:true,confirmed:true};
      });
      case 'BIND_CURRENT':return serial(async()=>{
        await requirePrepared();
        const state=await sessionGuard();
        if(!state||state.mode!=='READ_ONLY'||!state.canBind||!state.account||
            Date.now()-state.at>120000||state.account!==msg.account)throw new Error('没有可以确认绑定的当前账号，请先在 Teams 页面巡检');
        let account=state.account,selfId='',smallAnchor=null;
        if(state.firstSetup){
          selfId=cleanMRI(msg.selfId);
          const recommended=state.selfSuggestion?.status==='CANDIDATE'?state.selfSuggestion.personId:'';
          if(recommended&&selfId!==recommended)throw new Error('所选 ID 与本人线索不一致，请重新查找，不能改绑其他群成员');
          const inEvidence=(state.smallSetup||recommended)?Array.isArray(state.selfEvidenceIds)&&state.selfEvidenceIds.includes(selfId):
            Array.isArray(state.selfCandidates)&&state.selfCandidates.some(c=>c.id===selfId&&Number.isInteger(c.count)&&c.count>=3);
          if(!L.personId(selfId)||!inEvidence)
            throw new Error('首次建档请从候选列表确认本人 Teams 成员 ID');
          if(recommended&&(msg.selfConfirmed!==true||msg.last6!==selfId.slice(-6)))
            throw new Error('自动推荐仍需核对完整本人 ID、填写最后 6 位并确认');
          if(state.smallSetup){
            if(!C.validMRI(selfId))throw new Error('请选择完整人员 ID，不能使用群组或会议编号');
            if(msg.smallConfirmed!==true||typeof msg.last6!=='string'||msg.last6!==selfId.slice(-6))
              throw new Error('单群不能自动识别本人，请核对完整 ID、填写最后 6 位并确认');
            smallAnchor=(state.setupAnchors||[]).find(g=>L.threadId(g.id)&&g.memberIds?.includes(selfId)&&g.memberIds.length>=2);
            if(!smallAnchor)throw new Error('缺少含本人 ID 的初始群证据，请重新巡检');
          }
          account='verified:'+(await hash(selfId)).slice(0,32);
          if(!/^account-cache-scope:[a-f0-9]{32}$/.test(state.scopeKey||'')||
             !/^[a-f0-9]{64}$/.test(state.setupHash||'')||
             !await pristineProfileForSetup(account))
            throw new Error('首次建档环境已变化：存在旧账号数据或缓存证据缺失，已拒绝混用');
          const previous=await D.getMeta(state.scopeKey);
          if(previous?.approved&&previous.account!==state.account&&previous.account!==account)
            throw new Error('缓存已关联另一个账号，禁止首次建档');
        }
        const old=await D.getMeta('account:'+account);
        await D.putMeta({...(old||{}),pk:'account:'+account,account,
          verified:true,manualBound:true,lastSeen:Date.now(),
          ...(state.firstSetup?{manualSelfId:selfId,bootstrapHash:state.setupHash,bootstrapApprovedAt:Date.now(),
            ...(state.selfSuggestion?.status==='CANDIDATE'?{bindingEvidence:'LOCAL_SELF_CLUE_CONFIRMED',
              bindingClueSources:state.selfSuggestion.sources||[]}:{}),
            ...(state.smallSetup?{smallRosterBound:true,smallScopeKey:state.scopeKey,smallAnchorGroupId:smallAnchor.id,
              bindingMethod:'MANUAL_SMALL_ROSTER',bindingConfirmedAt:Date.now()}: {})}: {})});
        if(state.firstSetup){
          await D.putMeta({pk:'identity-link:'+(await hash(selfId)).slice(0,32),account,approvedAt:Date.now()});
        }else if(state.identityLinkKey&&/^identity-link:[a-f0-9]{32}$/.test(state.identityLinkKey)){
          await D.putMeta({pk:state.identityLinkKey,account,approvedAt:Date.now()});
        }
        if(state.scopeKey&&/^account-cache-scope:[a-f0-9]{32}$/.test(state.scopeKey)){
          const prior=await D.getMeta(state.scopeKey);
          if(!(prior?.approved===true&&prior.account!==state.account&&prior.account!==account))
            await D.putMeta({pk:state.scopeKey,account,approved:true,approvedAt:Date.now()});
        }
        await saveGuard({...state,account,reason:'本人 ID 已确认；请再次巡检建立/更新基线',canBind:false});
        return {ok:true};
      });
      case 'OVERLAY_STATUS':{
        const [state,requestNotice]=await Promise.all([statusSnapshot(),currentRequestNotice(sender)]);
        // Minimal status only: no person names, group IDs or account identifiers.
        return {ok:true,prefs:await overlayPrefs(),level:state.level,requestNotice,
          requests:state.counts?.requests||{pending:0,impersonation:0,contact:0,headline:''},
          groups:state.groups,openUrgent:state.openUrgent,newUnknown:state.newUnknown,
          openInfo:state.openInfo,ambiguous:state.ambiguous,
          // Only persisted yellow groups can be opened by the filtered group center.
          // READ_ONLY observations may be ephemeral and must not expose other-account groups.
          savedAmbiguous:state.counts?.ambiguous||0,lastRead:state.lastRead,
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
        const target=['overview','review','events','groups','settings','requests'].includes(msg.page)?msg.page:'events';
        // Only an enumerated filter is accepted from the Teams overlay.
        const filter=target==='events'&&['info','urgent','open','all','ack'].includes(msg.filter)?msg.filter:
          target==='groups'&&msg.filter==='uncertain'?'uncertain':'';
        const path='ui/dashboard.html?page='+target+(filter?'&filter='+filter:'');
        await chrome.tabs.create({url:chrome.runtime.getURL(path)});return {ok:true};
      }
      case 'SUMMARY':{const [state,requestNotice]=await Promise.all([statusSnapshot(),currentRequestNotice(sender)]);const requestCoverage=state.indexed?await D.getMeta('request-coverage:'+state.active.account):null;return {ok:true,requestNotice,status:{level:state.level,indexed:state.indexed,
        requests:state.counts?.requests||{pending:0,impersonation:0,contact:0,headline:''},
        requestCoverage:'LIMITED_UI',groups:state.groups,newUnknown:state.newUnknown,openUrgent:state.openUrgent,
        openInfo:state.openInfo,ambiguous:state.ambiguous,lastRead:state.lastRead,observedOnly:state.observedOnly,
        scanHealth:{failedConsecutive:state.scanHealth.failedConsecutive||0,
          lastError:state.scanHealth.lastError||'',lastErrorAt:state.scanHealth.lastErrorAt||0,
          at:state.scanHealth.at||0}},
        requestCoverage,guard:state.guard,active:state.active,counts:state.counts,
        policy:state.indexed?await D.getPolicy(state.active.account):null};}
      case 'REVIEW_CONTACT_REQUEST':return serial(async()=>{await requirePrepared();const r=await reviewContactRequest(msg);await refreshBadge();await broadcastOverlay();return r;});
      case 'CONFIRM_ROSTER':return serial(async()=>{await requirePrepared();return confirmRosterReview(msg);});
      case 'EDIT':return serial(async()=>{await requirePrepared();const r=await edit(msg);await refreshBadge();await broadcastOverlay();return r;});
      case 'ACK_ROUTINE_EVENTS':return serial(async()=>{await requirePrepared();
        const r=await acknowledgeRoutineEvents(msg.ids);await refreshBadge();await broadcastOverlay();return r;});
      case 'BULK_PERSON':return serial(async()=>{await requirePrepared();const r=await bulkPeople(msg.ids,msg.value);await refreshBadge();await broadcastOverlay();return r;});
      case 'COMPARE_BACKUP':return historicalCompare(msg.data);
      case 'MARK_HISTORICAL':return serial(()=>markHistoricalAlerts(msg.data));
      case 'RESTORE':return serial(async()=>{
        await assertIdentitySafeToEdit();
        await requirePrepared();
        // Backup of current state before merging imported data, independently of the imported file.
        await R.capture(D,{label:'导入加密备份前',version:BUILD_VERSION,sourceVersion:BUILD_VERSION});
        const result=await restore(msg.data);
        const active=await D.getMeta('active');
        if(active?.account)await D.putMeta({pk:'edge-reconcile-v1:'+active.account,account:active.account,done:false,at:Date.now()});
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
        // Old checkpoints may contain unverified candidate edges. Recheck
        // the account's stable group relationships after a restore.
        if(result.added>0)await D.putMeta({pk:'edge-reconcile-v1:'+account,account,done:false,at:Date.now()});
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
