/* Trusted-world local cache reader. All roster rows originate from an IndexedDB
 * read executed in Chrome's ISOLATED content-script world, never page messages. */
(()=>{
  const LOGIC=globalThis.TGSLogic, NAMES=globalThis.TGSNames;
  if(!LOGIC||!NAMES)return;
  const LIMIT=20000, MAX_GROUPS=6000, MAX_TRANSFER=6500000;
  let profileCache=null;
  // Recover only the extension reader's ephemeral state, never Teams storage.
  // A timed-out IndexedDB transaction can remain pending in Chromium even after
  // our outer Promise rejects; track and abort/close it before a retry.
  let readerEpoch=0;
  const activeDatabases=new Set(),activeTransactions=new Set();
  function closeDatabase(db){
    activeDatabases.delete(db);
    try{db.close();}catch{}
  }
  function checkEpoch(epoch){
    if(epoch!==readerEpoch)throw new Error('旧缓存读取已取消，等待新一轮巡检');
  }
  const OPEN_TIMEOUT_MS=10000, ROSTER_TIMEOUT_MS=25000, PROFILE_BUDGET_MS=12000;
  // Chrome may leave databases() pending after a Teams tab is suspended or its
  // storage backend is busy. Explicitly bound enumeration like cursor reads.
  function databaseList(timeoutMs=6500){
    let timer;
    return Promise.race([Promise.resolve().then(()=>indexedDB.databases()),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Teams 数据库枚举超时')),timeoutMs);
    })]).finally(()=>clearTimeout(timer));
  }
  function openExisting(name,timeoutMs=OPEN_TIMEOUT_MS){return new Promise((resolve,reject)=>{
    let finished=false,upgraded=false;
    const epoch=readerEpoch;
    const r=indexedDB.open(name);
    const timer=setTimeout(()=>finish(new Error('Teams 数据库打开超时')),timeoutMs);
    function finish(error,db){
      if(finished){if(db)closeDatabase(db);return;}
      finished=true;clearTimeout(timer);
      if(epoch!==readerEpoch)error=new Error('数据库连接已失效，等待重新读取');
      if(error){if(db)closeDatabase(db);reject(error);}
      else{activeDatabases.add(db);resolve(db);}
    }
    r.onupgradeneeded=()=>{upgraded=true;try{r.transaction.abort();}catch{}};
    r.onsuccess=()=>upgraded?finish(new Error('数据库尚未初始化'),r.result):finish(null,r.result);
    r.onerror=()=>finish(new Error('无法打开会话数据库'));
    r.onblocked=()=>finish(new Error('Teams 数据库暂时被占用'));
  });}
  function readStore(db,out,stats,hints,deadline){return new Promise((resolve,reject)=>{
    const tx=db.transaction('conversations','readonly'),request=tx.objectStore('conversations').openCursor();
    activeTransactions.add(tx);
    let finished=false;
    const timer=setTimeout(()=>{try{tx.abort();}catch{}finish(new Error('Teams 群名单读取超时'));},Math.max(1000,Math.min(ROSTER_TIMEOUT_MS,deadline-Date.now())));
    function finish(error){if(finished)return;finished=true;clearTimeout(timer);
      activeTransactions.delete(tx);
      if(error)reject(error);else resolve();}
    tx.oncomplete=()=>finish();
    tx.onerror=()=>finish(new Error('Teams 缓存读取失败'));
    tx.onabort=()=>finish(new Error('Teams 缓存读取中断'));
    request.onsuccess=()=>{const c=request.result;if(!c)return;
      stats.records++;if(stats.records>LIMIT){stats.partial=true;return;}
      const rec=c.value;
      const members=Array.isArray(rec?.members)?rec.members:[];
      const avatars=Array.isArray(rec?.avatarUsersInfo)?rec.avatarUsersInfo:[];
      // A corrupt cache object must not trigger a huge traversal or memory burst.
      if(members.length>LOGIC.MAX_MEMBERS||avatars.length>LOGIC.MAX_MEMBERS){
        if(LOGIC.threadId(rec?.id))stats.partial=true;
        c.continue();return;
      }
      for(const entries of [members,avatars])for(const entry of entries){
        const id=entry?.id||entry?.mri||entry?.userId||entry?.skypeId||entry?.profile?.id||entry?.profile?.mri;
        const name=LOGIC.nameFromProfile(entry);
        if(LOGIC.personId(id)&&name&&hints.size<16000)NAMES.merge(hints,{id,name},'Teams 会话元数据',40,stats);
      }
      const parsed=LOGIC.parseRecord(rec);
      if(parsed.id){const n=JSON.stringify(parsed).length;
        if(out.length>=MAX_GROUPS||stats.bytes+n>MAX_TRANSFER){stats.partial=true;return;}
        stats.bytes+=n;stats.candidates++;if(parsed.quality==='CACHE_CONSISTENT')stats.complete++;
        out.push(parsed);
      }else{
        stats[parsed.skip]=(stats[parsed.skip]||0)+1;
        // Explicitly truncated/invalid rosters are not safe to omit silently:
        // otherwise a subset of healthy groups could be treated as complete.
        if(parsed.skip==='unsafeRoster')stats.partial=true;
      }
      c.continue();
    };
    request.onerror=()=>finish(new Error('无法遍历会话缓存'));
  });}
  // Enumerate only profile/contact named stores; only extract name fields bound to an EXACT known member MRI.
  function readNamesFromDb(db,known,hints,stats,source,deadline){
    const stores=[...db.objectStoreNames].filter(n=>/(?:contacts?|budd(?:y|ies)|people|persons?|users?|profiles?|identit(?:y|ies)|addressbook)/i.test(n)).slice(0,30);
    return Promise.all(stores.map(store=>new Promise(resolve=>{
      let tx;try{tx=db.transaction(store,'readonly');}catch{return resolve();}
      activeTransactions.add(tx);
      const cursor=tx.objectStore(store).openCursor();let visited=0,settled=false;
      const timer=setTimeout(()=>{stats.nameStoresCapped++;try{tx.abort();}catch{}done();},
        Math.max(250,Math.min(6000,deadline-Date.now())));
      function done(){if(settled)return;settled=true;clearTimeout(timer);activeTransactions.delete(tx);resolve();}
      tx.oncomplete=done;tx.onabort=done;tx.onerror=done;
      cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;
        if(Date.now()>deadline||++visited>2500||stats.nameRecordsChecked>=40000){
          stats.nameStoresCapped++;try{tx.abort();}catch{}return;
        }
        stats.nameRecordsChecked++;
        // Report field names only; never message contents, tokens or private IDs.
        if(visited<=5){
          stats.nameFieldPaths ||= {};
          for(const [path,object] of [['root',c.value],['value',c.value?.value],
            ['profile',c.value?.profile],['value.profile',c.value?.value?.profile]]){
            if(!object||Array.isArray(object)||typeof object!=='object')continue;
            const current=stats.nameFieldPaths[path]||[];
            for(const key of Object.keys(object).slice(0,30)){
              if(/^[a-zA-Z][a-zA-Z_0-9]{0,45}$/.test(key)&&!current.includes(key)&&current.length<32)current.push(key);
            }
            stats.nameFieldPaths[path]=current;
          }
        }
        const pairs=NAMES.extract(c.value,c.key,known);
        for(const pair of pairs){if(hints.size>=16000)break;
          NAMES.merge(hints,pair,source,source==='Teams 用户资料缓存'?90:70,stats);
        }
        c.continue();};cursor.onerror=done;
    })));
  }
  async function scan(){
    const epoch=readerEpoch;
    const databaseRecords=await databaseList();checkEpoch(epoch);
    const allDbNames=databaseRecords.map(x=>x.name).filter(x=>typeof x==='string'&&/^Teams:conversation-manager:/i.test(x)).sort();
    const dbNames=allDbNames.slice(0,8);
    const rosterDeadline=Date.now()+40000;
    const rows=[],hints=new Map(),stats={databases:dbNames.length,records:0,candidates:0,complete:0,bytes:0,
      partial:allDbNames.length>dbNames.length,cacheWatchActive:false};
    for(const name of dbNames){
      checkEpoch(epoch);
      if(Date.now()>=rosterDeadline){stats.partial=true;break;}
      try{
        const db=await openExisting(name,Math.max(1000,Math.min(OPEN_TIMEOUT_MS,rosterDeadline-Date.now())));
        try{if(db.objectStoreNames.contains('conversations'))await readStore(db,rows,stats,hints,rosterDeadline);}finally{closeDatabase(db);}
      }catch{stats.partial=true;stats.rosterDatabaseErrors=(stats.rosterDatabaseErrors||0)+1;}
      checkEpoch(epoch);
      if(stats.partial)break;
    }
    // Build a bounded allow-list of observed members, so unrelated profile IDs are never transferred.
    const known=new Set();for(const row of rows)for(const person of row.members)known.add(person.id);
    stats.nameStoresCapped=0;stats.nameRecordsChecked=0;stats.nameConflicts=0;
    const profileDeadline=Date.now()+PROFILE_BUDGET_MS;
    // Profile names are optional. An unavailable profile DB must not make a
    // successfully read group roster appear to be a failed roster scan.
    let dbList=[];
    try{dbList=await databaseList(Math.max(250,Math.min(4000,profileDeadline-Date.now())));checkEpoch(epoch);}
    catch{stats.nameLookupDeferred=true;}
    const extra=dbList.map(x=>x.name).filter(x=>typeof x==='string'&&
      /^Teams:(?:[^:]*?(?:profiles?|contacts?|budd(?:y|ies)|people|person|identit(?:y|ies)|addressbook)[^:]*?):/i.test(x)).slice(0,24);
    stats.nameDatabasesFound=extra.length;
    const cacheKey=dbNames.join('|')+'::'+extra.join('|');
    const memberKey=[...known].sort().join('|');
    const fresh=profileCache&&profileCache.key===cacheKey&&profileCache.memberKey===memberKey&&Date.now()-profileCache.at<(profileCache.deferred?30000:180000);
    if(fresh){
      stats.nameCacheReused=true;
      Object.assign(stats,profileCache.stats);
      for(const pair of profileCache.entries){if(pair.conflict)hints.set(pair.id,{...pair,priority:100});else NAMES.merge(hints,pair,pair.source,pair.priority,stats);}
    }else{
      const profileHints=new Map(),profileStats={nameStoresCapped:0,nameRecordsChecked:0,nameConflicts:0,nameFieldPaths:{}};
      for(const name of extra){if(Date.now()>=profileDeadline){stats.nameLookupDeferred=true;break;}try{const db=await openExisting(name,Math.max(250,Math.min(3000,profileDeadline-Date.now())));
        try{await readNamesFromDb(db,known,profileHints,profileStats,/profiles?|identit(?:y|ies)/i.test(name)?'Teams 用户资料缓存':'Teams 联系人缓存',profileDeadline);}
        finally{closeDatabase(db);}}catch{profileStats.nameDatabaseErrors=(profileStats.nameDatabaseErrors||0)+1;}}
      for(const name of dbNames){if(Date.now()>=profileDeadline){stats.nameLookupDeferred=true;break;}try{const db=await openExisting(name,Math.max(250,Math.min(3000,profileDeadline-Date.now())));
        try{await readNamesFromDb(db,known,profileHints,profileStats,'Teams 联系人缓存',profileDeadline);}finally{closeDatabase(db);}}catch{}}
      checkEpoch(epoch);
      Object.assign(stats,profileStats);
      // An incomplete optional name pass must be retried later, not cached as final.
      if(profileStats.nameDatabaseErrors||stats.nameLookupDeferred||profileStats.nameStoresCapped)stats.nameLookupDeferred=true;
      profileCache={at:Date.now(),key:cacheKey,memberKey,deferred:!!stats.nameLookupDeferred,entries:[...profileHints.values()],stats:profileStats};
      for(const pair of profileCache.entries){if(pair.conflict)hints.set(pair.id,{...pair,priority:100});else NAMES.merge(hints,pair,pair.source,pair.priority,stats);}
      stats.nameCacheReused=false;
      // An optional name lookup retry never holds back the verified roster pass.
    }
    checkEpoch(epoch);
    stats.nameHints=[...hints.values()].filter(x=>!x.conflict).length;
    stats.unresolved=[...known].filter(id=>!hints.get(id)||hints.get(id).conflict).length;
    return {rows,nameHints:[...hints.values()].filter(x=>!x.conflict && known.has(x.id)).map(({id,name,source})=>({id,name,source})),stats,
      dbName:dbNames.join('|').slice(0,700)};
  }

  function inferSelfFromRoster(rows){
    // A strong *local observation* only, not authenticated proof of login.
    // Cache rosters may be incomplete for a small number of inactive groups.
    // Treat near-universal presence as a *hint*, never proof of login identity.
    // Do not guess when two IDs have similarly widespread presence.
    if(!Array.isArray(rows)||rows.length<10)return '';
    const counts=new Map();let eligible=0;
    for(const row of rows){
      if(!Array.isArray(row.members)||row.members.length<3)continue;
      const ids=new Set(row.members.map(m=>m.id).filter(id=>LOGIC.personId(id)));
      if(ids.size<3)continue;
      eligible++;
      for(const id of ids)counts.set(id,(counts.get(id)||0)+1);
    }
    if(eligible<10)return '';
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]);
    const [best,second]=ranked;
    if(!best||best[1]/eligible<0.95||best[1]<10)return '';
    if(second && second[1]>=best[1]*0.85)return '';
    return LOGIC.personId(best[0])?best[0]:'';
  }
  const originalScan=scan;
  let executing=null;
  globalThis.TGSIsolatedReader=Object.freeze({
    recover(){
      // Abandon a wedged generation and rebuild all transient reader resources.
      // Stale async completions cannot publish data into the next generation.
      readerEpoch++;
      profileCache=null;
      executing=null;
      const transactions=[...activeTransactions],databases=[...activeDatabases];
      activeTransactions.clear();activeDatabases.clear();
      for(const tx of transactions)try{tx.abort();}catch{}
      for(const db of databases)closeDatabase(db);
      return {ok:true};
    },
    scan(){
    if(!executing){
      // The outer content-script timeout cannot reset this inner coalescing
      // promise. Bound BOTH layers so a wedged IndexedDB call is retryable.
      let timer;
      const result=Promise.race([originalScan().then(data=>({
        ...data, accountHint:data.stats.partial?'':inferSelfFromRoster(data.rows),
        accountHintSource:'ROSTER_INTERSECTION', tokenIdentity:null,
        stats:{...data.stats,isolatedSource:true}
      })),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Teams 缓存巡检超时，稍后自动重试')),52000);})]);
      const guarded=result.finally(()=>{
        clearTimeout(timer);
        // An old scan finishing late must not clear a newer retry's lock.
        if(executing===guarded)executing=null;
      });
      executing=guarded;
    }
    return executing;
  }});
})();
