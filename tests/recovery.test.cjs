const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(){
  const snapshots=new Map();
  const stores=new Map(['groups','people','edges','events','policies','meta'].map(x=>[x,new Map()]));
  const clone=value=>structuredClone(value);
  let dbPresent=false;
  class Tx{
    pending=0;completed=false;
    constructor(){queueMicrotask(()=>this.done());}
    done(){if(!this.pending&&!this.completed){this.completed=true;this.oncomplete?.();}}
    request(op){
      const req={};this.pending++;
      queueMicrotask(()=>{try{req.result=op();req.onsuccess?.({target:req})}catch(error){req.error=error;req.onerror?.({target:req});}
        this.pending--;queueMicrotask(()=>this.done());});
      return req;
    }
    objectStore(){const tx=this;return{
      put:x=>tx.request(()=>{snapshots.set(x.id,clone(x));return x.id}),
      get:key=>tx.request(()=>clone(snapshots.get(key))),
      getAll:()=>tx.request(()=>[...snapshots.values()].map(clone)),
      delete:key=>tx.request(()=>{snapshots.delete(key);return undefined})
    };}
  }
  const fakeDB={objectStoreNames:{contains:()=>dbPresent},createObjectStore:()=>{dbPresent=true},
    transaction:()=>new Tx(),close:()=>{}};
  const indexedDB={open:()=>{const req={result:fakeDB};queueMicrotask(()=>{
    if(!dbPresent)req.onupgradeneeded?.({target:req});req.onsuccess?.({target:req});
  });return req;}};
  const context=vm.createContext({crypto:webcrypto,indexedDB,TextEncoder,Uint8Array,Date,
    queueMicrotask,Promise,JSON,Map,Set,globalThis:null,console});
  context.globalThis=context;
  const script=fs.readFileSync(path.resolve(__dirname,'../lib/recovery.js'),'utf8');
  vm.runInContext(script,context);
  const R=context.TGSRecovery;
  const D={pk:(a,id)=>JSON.stringify([a,id]),request:async r=>clone(r.result),
    async getAll(name){return [...stores.get(name).values()].map(clone)},
    async transaction(names,mode,fn){
      const tx={objectStore(name){const map=stores.get(name);return{
        getAll:()=>({result:[...map.values()].map(clone)}),
        getAllKeys:()=>({result:[...map.keys()]}),
        put:row=>{map.set(row.pk||row.account,clone(row));return {result:row}},
        add:row=>{const key=row.pk||row.account;if(map.has(key))throw Error('duplicate');map.set(key,clone(row));return {result:row}}
      }}};
      return fn(tx);
    }
  };
  const L={MAX_MEMBERS:3000,threadId:id=>typeof id==='string'&&id.includes('@thread'),personId:id=>typeof id==='string'&&id.startsWith('8:live:')};
  const account='verified:'+'a'.repeat(32),groupId='19:abcdef@thread.v2',personId='8:live:cid.abcdef';
  const group={pk:D.pk(account,groupId),account,id:groupId,memberIds:[personId],alias:'测试重点群'};
  const person={pk:D.pk(account,personId),account,id:personId,status:'NEW',manualName:'',companyApproved:false};
  stores.get('groups').set(group.pk,clone(group));stores.get('people').set(person.pk,clone(person));
  return {R,D,L,stores,snapshots,group,person,account};
}

test('actual recovery module snapshots NEW identity and verifies records without exposing raw data in summary',async()=>{
 const {R,D,person,account}=harness();
 const cp=await R.capture(D,{version:'3.3.3',sourceVersion:'3.3.2'});
 assert.equal(cp.ok,true);assert.equal(cp.counts.people,1);
 const list=await R.list();assert.equal(list.length,1);
 assert.equal(JSON.stringify(list).includes(person.id),false);
 const verification=await R.verifyCheckpoint(cp.id,D,account);
 assert.equal(verification.previousPending,1);
 assert.equal(verification.priorGroups,1);
 assert.equal(verification.missing,0);
});

test('actual recovery restores missing group but never overwrites approved person',async()=>{
 const {R,D,L,stores,group,person,account}=harness();
 const cp=await R.capture(D,{version:'3.3.3'});
 stores.get('groups').delete(group.pk);
 stores.get('people').set(person.pk,{...person,status:'APPROVED',manualName:'核实员工'});
 assert.equal((await R.verifyCheckpoint(cp.id,D,account)).missing,1);
 const result=await R.restoreMissing(cp.id,D,L,account);
 assert.equal(result.added,1);
 assert.equal(stores.get('groups').get(group.pk).alias,'测试重点群');
 assert.equal(stores.get('people').get(person.pk).status,'APPROVED');
 assert.equal(stores.get('people').get(person.pk).manualName,'核实员工');
 assert.equal((await R.restoreMissing(cp.id,D,L,account)).added,0);
});

test('actual recovery rejects tampered snapshot and incorrect ID',async()=>{
 const {R,D,L,snapshots,account}=harness();
 const cp=await R.capture(D,{version:'3.3.3'});
 const damaged=snapshots.get(cp.id);damaged.tables.people[0].status='REVOKED';
 await assert.rejects(R.restoreMissing(cp.id,D,L,account),/校验失败/);
 await assert.rejects(R.verifyCheckpoint('not-a-uuid',D,account),/无效/);
});

test('mixed historical recovery points only restore the current account and hide other counts',async()=>{
 const {R,D,L,stores,group,person,account}=harness();
 const other='verified:'+'b'.repeat(32);
 const foreignGroup={...group,account:other,pk:D.pk(other,group.id),alias:'另一个账号的群'};
 const foreignPerson={...person,account:other,pk:D.pk(other,person.id),status:'NEW'};
 stores.get('groups').set(foreignGroup.pk,structuredClone(foreignGroup));
 stores.get('people').set(foreignPerson.pk,structuredClone(foreignPerson));
 const cp=await R.capture(D,{label:'历史多账号快照'});
 stores.get('groups').delete(foreignGroup.pk);
 stores.get('people').delete(foreignPerson.pk);
 stores.get('groups').delete(group.pk);
 const list=await R.list(account);
 assert.equal(list.length,1);
 assert.equal(list[0].counts.groups,1,'only the current account should be visible');
 const preview=await R.verifyCheckpoint(cp.id,D,account);
 assert.equal(preview.missing,1,'foreign missing records are not shown');
 const recovered=await R.restoreMissing(cp.id,D,L,account);
 assert.equal(recovered.added,1);
 assert.equal(stores.get('groups').has(group.pk),true);
 assert.equal(stores.get('groups').has(foreignGroup.pk),false);
 assert.equal(stores.get('people').has(foreignPerson.pk),false);
 await assert.rejects(R.restoreMissing(cp.id,D,L,'invalid-account'),/账号/);
});
