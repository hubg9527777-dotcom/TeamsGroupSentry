/*
 * TeamsGroupSentry local upgrade recovery points.
 * Kept in a SEPARATE extension-origin IndexedDB, so schema changes to the
 * main database cannot delete the recovery stores. Not an external backup.
 * Only the privileged service worker loads this module.
 */
(function (root, factory) {
  const recovery = factory();
  if (typeof module === 'object' && module.exports) module.exports = recovery;
  root.TGSRecovery = recovery;
})(globalThis, () => {
  'use strict';
  const NAME = 'teams-group-sentry-recovery-v1';
  const VERSION = 1;
  const TABLES = Object.freeze(['groups', 'people', 'edges', 'events', 'policies', 'meta']);
  const RESTORABLE = Object.freeze(['groups', 'people', 'edges', 'events', 'policies']);
  const RETAIN = 4;
  let openPromise;

  function open() {
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('checkpoints'))
          db.createObjectStore('checkpoints', {keyPath: 'id'});
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); openPromise = null; };
        resolve(db);
      };
      req.onerror = () => { openPromise = null; reject(req.error || new Error('恢复数据库无法打开')); };
      req.onblocked = () => { openPromise = null; reject(new Error('恢复数据库被旧页面占用')); };
    });
    return openPromise;
  }
  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('恢复数据库读写失败'));
    });
  }
  async function transaction(mode, fn) {
    const db = await open();
    const tx = db.transaction('checkpoints', mode);
    const complete = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('恢复点事务失败'));
      tx.onabort = () => reject(tx.error || new Error('恢复点事务已取消'));
    });
    try {
      const result = await fn(tx.objectStore('checkpoints'));
      await complete;
      return result;
    } catch (error) {
      try { tx.abort(); } catch {}
      throw error;
    }
  }
  async function digest(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const validAccount = account => typeof account==='string' &&
    /^(?:verified|manual|provisional):[a-f0-9]{32}$/.test(account);
  const scopedRows = (tables,table,account) =>
    (Array.isArray(tables?.[table])?tables[table]:[]).filter(row=>row?.account===account);
  const safeMetadata = (rec,account='') => {
    if(!account)return {id:rec.id,at:rec.at,label:rec.label,version:rec.version,
      sourceVersion:rec.sourceVersion,counts:rec.counts,total:rec.total,bytes:rec.bytes};
    const counts=Object.fromEntries(RESTORABLE.map(table=>[table,scopedRows(rec.tables,table,account).length]));
    return {id:rec.id,at:rec.at,label:rec.label,version:rec.version,
      sourceVersion:rec.sourceVersion,counts,total:Object.values(counts).reduce((a,b)=>a+b,0),bytes:rec.bytes};
  };

  // Read all relevant object stores IN ONE READONLY transaction, producing a
  // transactionally consistent checkpoint even while an audit is active.
  async function collect(dbApi) {
    return dbApi.transaction(TABLES, 'readonly', async tx => {
      const pairs = await Promise.all(TABLES.map(async table =>
        [table, await dbApi.request(tx.objectStore(table).getAll())]));
      return Object.fromEntries(pairs);
    });
  }
  async function capture(dbApi, {label='手动恢复点',version='',sourceVersion='',protectId=''}={}) {
    const tables = await collect(dbApi);
    const counts = Object.fromEntries(TABLES.map(table => [table, tables[table].length]));
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (total === 0) return {ok:true,empty:true,total:0};
    const raw = JSON.stringify(tables);
    // A giant snapshot could exhaust local disk. Fail closed rather than
    // silently running an unsafe migration with no recoverable checkpoint.
    if (raw.length > 65 * 1024 * 1024)
      throw new Error('本地数据超过恢复点安全上限，请先导出加密备份');
    const record = {
      id:crypto.randomUUID(),at:Date.now(),label:String(label).slice(0,80),
      version:String(version).slice(0,20),sourceVersion:String(sourceVersion).slice(0,20),
      counts,total,bytes:new TextEncoder().encode(raw).length,
      checksum:await digest(raw),tables
    };
    await transaction('readwrite', store => request(store.put(record)));
    await prune(protectId).catch(() => {}); // Failure to prune must not invalidate a saved checkpoint.
    return {ok:true,...safeMetadata(record)};
  }
  async function list(account='') {
    if(account&&!validAccount(account))throw new Error('恢复点所属账号无效');
    const all = await transaction('readonly', store => request(store.getAll()));
    return all.sort((a,b)=>b.at-a.at).map(rec=>safeMetadata(rec,account)).filter(rec=>!account||rec.total>0);
  }
  async function prune(protectId='') {
    const all = await list();
    if (all.length <= RETAIN) return;
    const keep = new Set(all.slice(0,RETAIN).map(row=>row.id));
    if (protectId && all.some(row=>row.id===protectId)) {
      keep.add(protectId);
      if (keep.size>RETAIN) {
        const replaceable=all.slice(0,RETAIN).reverse().find(row=>row.id!==protectId);
        if (replaceable) keep.delete(replaceable.id);
      }
    }
    const excess = all.filter(row=>!keep.has(row.id)).map(row=>row.id);
    await transaction('readwrite', store => {
      for (const id of excess) store.delete(id);
      return Promise.resolve();
    });
  }
  async function getCheckpoint(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
      throw new Error('无效的恢复点标识');
    const snapshot = await transaction('readonly', store => request(store.get(id)));
    if (!snapshot) throw new Error('恢复点不存在或已过期');
    const raw = JSON.stringify(snapshot.tables);
    if (!snapshot.checksum || await digest(raw) !== snapshot.checksum)
      throw new Error('恢复点校验失败：数据可能损坏，禁止恢复');
    return snapshot;
  }
  async function verifyCheckpoint(id, dbApi, account) {
    if(!validAccount(account))throw new Error('需要已确定的当前账号才能核对恢复点');
    const snapshot = await getCheckpoint(id);
    const tables = snapshot.tables;
    const keys = await dbApi.transaction(RESTORABLE,'readonly',async tx =>
      Object.fromEntries(await Promise.all(RESTORABLE.map(async table =>
        [table,await dbApi.request(tx.objectStore(table).getAllKeys())]))));
    const missingByTable = {};
    for (const table of RESTORABLE) {
      const known = new Set(keys[table]);
      missingByTable[table] = scopedRows(tables,table,account).filter(row =>
        !known.has(table === 'policies' ? row.account : row.pk)).length;
    }
    const missing = Object.values(missingByTable).reduce((sum,n)=>sum+n,0);
    const previousPending=scopedRows(tables,'people',account).filter(p=>p.status==='NEW').length;
    const priorGroups=scopedRows(tables,'groups',account).length;
    return {ok:true,missing,missingByTable,previousPending,priorGroups,checkedAt:Date.now(),
      explanation:'核对记录是否还存在，不比较后来正常修改过的审核状态或群组内容'};
  }
  function validateRecord(table, row, dbApi, logic) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    if (typeof row.account !== 'string' || !/^(verified|manual|provisional):[a-f0-9]{32}$/.test(row.account)) return false;
    if (table === 'policies') return row.account && typeof row.account === 'string';
    if (typeof row.pk !== 'string') return false;
    if (table === 'groups')
      return logic.threadId(row.id) && row.pk === dbApi.pk(row.account,row.id) &&
        Array.isArray(row.memberIds) && row.memberIds.length <= logic.MAX_MEMBERS &&
        row.memberIds.every(logic.personId) && new Set(row.memberIds).size===row.memberIds.length;
    if (table === 'people')
      return logic.personId(row.id) && row.pk === dbApi.pk(row.account,row.id);
    if (table === 'edges')
      return logic.threadId(row.groupId) && logic.personId(row.personId) &&
        row.pk === dbApi.pk(row.account,dbApi.pk(row.groupId,row.personId));
    if (table === 'events')
      return typeof row.id === 'string' && row.id.length <= 128 &&
        row.pk === dbApi.pk(row.account,row.id);
    return false;
  }
  // Non-destructive recovery: missing keys only. No existing review statuses,
  // aliases, baselines or events are replaced. Account binding remains manual.
  async function restoreMissing(id, dbApi, logic, account) {
    if(!validAccount(account))throw new Error('需要已确定的当前账号才能恢复历史记录');
    const snapshot = await getCheckpoint(id);
    const tables = snapshot.tables;
    if (!RESTORABLE.every(table => Array.isArray(tables?.[table])))
      throw new Error('恢复点数据表不完整');
    const scoped=Object.fromEntries(RESTORABLE.map(table=>[table,scopedRows(tables,table,account)]));
    if(!RESTORABLE.some(table=>scoped[table].length))
      throw new Error('所选恢复点没有当前账号的记录，已拒绝跨账号恢复');
    for (const table of RESTORABLE)
      for (const row of scoped[table])
        if (!validateRecord(table,row,dbApi,logic))
          throw new Error(`恢复点包含非法 ${table} 记录，已停止恢复`);
    // Collect keys outside the write transaction so no external promise
    // causes a write transaction to auto-commit in the middle of the restore.
    const keys = await dbApi.transaction(RESTORABLE,'readonly',async tx => {
      const result = await Promise.all(RESTORABLE.map(async table =>
        [table,await dbApi.request(tx.objectStore(table).getAllKeys())]));
      return Object.fromEntries(result);
    });
    const existing = Object.fromEntries(RESTORABLE.map(t=>[t,new Set(keys[t])]));
    const additions = Object.fromEntries(RESTORABLE.map(t=>[t,scoped[t].filter(row => !existing[t].has(t==='policies'?row.account:row.pk))]));
    const added = Object.values(additions).reduce((n,rows)=>n+rows.length,0);
    if (added) await dbApi.transaction(RESTORABLE,'readwrite',tx=>{
      for(const table of RESTORABLE)
        for(const row of additions[table]) tx.objectStore(table).put(row);
      return Promise.resolve();
    });
    const total=RESTORABLE.reduce((sum,table)=>sum+scoped[table].length,0);
    return {ok:true,added,unchanged:total-added,
      addedByTable:Object.fromEntries(RESTORABLE.map(table=>[table,additions[table].length]))};
  }
  return {NAME,TABLES,RETAIN,collect,capture,list,getCheckpoint,verifyCheckpoint,restoreMissing};
});
