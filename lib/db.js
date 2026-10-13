/* Persistent extension-origin IndexedDB; independent of chrome.storage.local's 10 MB budget. */
(function(root, factory){const v=factory();if(typeof module==='object'&&module.exports)module.exports=v;root.TGSDB=v;})(globalThis,()=>{
  const NAME='teams-group-sentry-v3',VERSION=1;
  let opening;
  const schema={
    groups:{keyPath:'pk',indexes:{account:'account'}},
    people:{keyPath:'pk',indexes:{account:'account',byStatus:['account','status']}},
    edges:{keyPath:'pk',indexes:{account:'account',byGroup:['account','groupId'],byPerson:['account','personId']}},
    events:{keyPath:'pk',indexes:{account:'account',byTime:['account','at'],byStatus:['account','status']}},
    policies:{keyPath:'account',indexes:{}},
    meta:{keyPath:'pk',indexes:{}}
  };
  function open(){if(opening)return opening;opening=new Promise((resolve,reject)=>{
    const req=indexedDB.open(NAME,VERSION);
    req.onupgradeneeded=()=>{const db=req.result;for(const [name,shape]of Object.entries(schema)){
      const os=db.objectStoreNames.contains(name)?req.transaction.objectStore(name):db.createObjectStore(name,{keyPath:shape.keyPath});
      for(const [ix,key]of Object.entries(shape.indexes)){if(!os.indexNames.contains(ix))os.createIndex(ix,key);}
    }};
    req.onsuccess=()=>{req.result.onversionchange=()=>{req.result.close();opening=null;};resolve(req.result);};
    req.onerror=()=>{opening=null;reject(req.error);};
    req.onblocked=()=>{opening=null;reject(new Error('数据库被其他页面占用，请关闭旧的扩展管理窗口'));};
  });return opening;}
  function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function transaction(stores,mode,fn){const db=await open(),tx=db.transaction(stores,mode);
    const complete=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('事务终止'));});
    let value;try{value=await fn(tx);await complete;return value;}catch(e){try{tx.abort();}catch{}throw e;}}
  const pk=(account,id)=>JSON.stringify([account,id]);
  async function getAllFor(store,account){return transaction([store],'readonly',tx=>request(tx.objectStore(store).index('account').getAll(account)));}
  async function getAll(store){return transaction([store],'readonly',tx=>request(tx.objectStore(store).getAll()));}
  async function getMeta(pkValue){return transaction(['meta'],'readonly',tx=>request(tx.objectStore('meta').get(pkValue)));}
  async function putMeta(rec){return transaction(['meta'],'readwrite',tx=>request(tx.objectStore('meta').put(rec)));}
  async function getPolicy(account){const p=await transaction(['policies'],'readonly',tx=>request(tx.objectStore('policies').get(account)));
    return p||{account,aaEnabled:true,aaMode:'prefix',aaPrefixes:['AA'],quietApprovedAA:true,sound:true,notifyUnknown:true,notifyKnownTransfers:true};}
  return {NAME,open,request,transaction,pk,getAllFor,getAll,getMeta,putMeta,getPolicy};
});
