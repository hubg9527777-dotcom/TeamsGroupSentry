const test=require('node:test');
const assert=require('node:assert/strict');
const {install,isWatchedTransaction}=require('../lib/cache-watch.js');
function sandbox(){
 let calls=0,originalCalls=0;
 class Database{
   constructor(name){this.name=name;this.tx=[];}
   transaction(stores,mode){
     originalCalls++;const listeners=new Map();
     const tx={oncomplete:null,addEventListener(type,fn){listeners.set(type,fn);},
       emit(type){if(listeners.has(type))listeners.get(type)();if(type==='complete')this.oncomplete?.();}};
     this.tx.push(tx);return tx;
   }
 }
 return {Database,read:()=>calls,original:()=>originalCalls,install:()=>install(Database,()=>calls++)};
}
test('watcher observes only successful Teams conversations readwrite transactions',()=>{
 const s=sandbox();assert.equal(s.install(),true);
 const db=new s.Database('Teams:conversation-manager:react-web-client:account');
 db.transaction('conversations','readwrite').emit('complete');
 assert.equal(s.read(),1);
 db.transaction(['conversations','other'],'readwrite').emit('complete');
 assert.equal(s.read(),2);
 db.transaction('conversations','readonly').emit('complete');
 db.transaction('events','readwrite').emit('complete');
 new s.Database('other-service').transaction('conversations','readwrite').emit('complete');
 assert.equal(s.read(),2);
 assert.equal(s.original(),5);
});
test('abort/error does not signal, original transaction behavior is preserved',()=>{
 const s=sandbox();s.install();const d=new s.Database('Teams:conversation-manager:x');
 d.transaction('conversations','readwrite').emit('abort');
 d.transaction('conversations','readwrite').emit('error');
 assert.equal(s.read(),0);assert.equal(s.install(),true);
 d.transaction('conversations','readwrite').emit('complete');assert.equal(s.read(),1);
});
test('observer guards absent and unsupported browser APIs',()=>{
 assert.equal(install(undefined,()=>{}),false);
 assert.equal(isWatchedTransaction('Teams:conversation-manager:demo',['conversations'],'readwrite'),true);
 assert.equal(isWatchedTransaction('Teams:conversation-manager:demo',['conversations'],'readonly'),false);
 assert.equal(isWatchedTransaction('Teams:conversation-manager:demo',['other'],'readwrite'),false);
});
