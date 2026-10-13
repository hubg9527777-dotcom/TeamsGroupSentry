/* Non-invasive Teams conversation cache write-completion observer.
   Signals only after a completed native IndexedDB transaction. No row data is read. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TGSCacheWatch=api;})(globalThis,()=>{
  function isWatchedTransaction(name,storeNames,mode){
    return /^Teams:conversation-manager:/i.test(String(name||'')) && mode==='readwrite' &&
      (typeof storeNames==='string'?storeNames==='conversations':
       Array.isArray(storeNames)?storeNames.includes('conversations'):
       // DOMStringList / iterable stores, but never iterate unknown user-controlled objects.
       storeNames&&typeof storeNames.contains==='function'&&storeNames.contains('conversations'));
  }
  function install(IDBDatabaseCtor,onComplete){
    if(!IDBDatabaseCtor?.prototype||typeof onComplete!=='function')return false;
    const proto=IDBDatabaseCtor.prototype,original=proto.transaction;
    if(typeof original!=='function')return false;
    if(original.__tgsCacheWatcher)return true;
    function watchedTransaction(storeNames,mode,options){
      // Preserve native invocation and throw behavior, and register AFTER successful creation.
      const tx=original.apply(this,arguments);
      try{
        if(isWatchedTransaction(this.name,storeNames,mode) && typeof tx.addEventListener==='function'){
          tx.addEventListener('complete',()=>{try{onComplete();}catch{}},{once:true});
        }
      }catch{}
      return tx;
    }
    try{Object.defineProperty(watchedTransaction,'__tgsCacheWatcher',{value:true});
      proto.transaction=watchedTransaction;return proto.transaction===watchedTransaction;
    }catch{return false;}
  }
  return {install,isWatchedTransaction};
});
