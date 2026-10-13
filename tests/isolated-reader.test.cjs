const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=n=>fs.readFileSync(path.join(root,n),'utf8');
function fakeIndexedDB(rows){
  const db={name:'Teams:conversation-manager:react-web-client:demo',objectStoreNames:Object.assign(['conversations'],{contains:n=>n==='conversations'}),close(){},transaction(name){
    if(name!=='conversations')throw new Error('unsupported');
    const tx={oncomplete:null,onerror:null,onabort:null,objectStore(){return {openCursor(){
      const req={onsuccess:null,onerror:null,result:null};let i=0;
      const step=()=>queueMicrotask(()=>{
        if(i>=rows.length){req.result=null;req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());return;}
        req.result={value:rows[i++],continue:step};req.onsuccess?.();
      });
      step();return req;
    }}}};return tx;
  }};
  return {databases:async()=>[{name:db.name}],open(name){
    const req={onsuccess:null,onerror:null,onblocked:null,onupgradeneeded:null,result:db};
    queueMicrotask(()=>req.onsuccess?.());return req;
  }};
}
function createScanner(rows){
  const ctx=vm.createContext({indexedDB:fakeIndexedDB(rows),window:{},queueMicrotask,Promise,Date,Map,Set,Array,JSON,console,URL,setTimeout,clearTimeout});
  ctx.globalThis=ctx;
  for(const file of ['lib/logic.js','lib/name-core.js','lib/isolated-reader.js'])vm.runInContext(source(file),ctx,{filename:file});
  return ctx.TGSIsolatedReader;
}
const person=n=>`8:live:cid.${String(n).padStart(16,'0')}`;
const group=(n,hasCommon=true)=>({id:`19:abc${n}@thread.v2`,
  members:[{id:hasCommon?person(1):person(90000+n),displayName:'AA-本人'},
           {id:person(n+10),displayName:'张'+n},{id:person(n+1000),displayName:'王'+n}],
  conversationMembersTotalCount:2,isConversationMembersTruncated:false,
  longTitle:`AA-本人, 张${n}, 王${n}`});
test('ISOLATED reader ingests 397 cached groups with direct ID:name mapping',async()=>{
  const scanner=createScanner(Array.from({length:397},(_,i)=>group(i)));
  const res=await scanner.scan();
  assert.equal(res.rows.length,397);
  assert.equal(res.accountHint,person(1));
  assert.equal(res.accountHintSource,'ROSTER_INTERSECTION');
  assert.equal(res.tokenIdentity,null);
  assert.equal(res.stats.isolatedSource,true);
  assert.equal(res.stats.candidates,397);
  assert.equal(res.rows[0].members[0].name,'AA-本人');
  assert.equal(res.rows[0].countOffset,1);
});
test('ISOLATED reader does not guess identity if memberships disagree',async()=>{
  const scanner=createScanner([...Array.from({length:14},(_,i)=>group(i)),group(15,false)]);
  const result=await scanner.scan();
  assert.equal(result.rows.length,15);
  assert.equal(result.accountHint,'');
});
test('ISOLATED reader does not infer identity from a single new group',async()=>{
  const scanner=createScanner([group(1)]);
  const result=await scanner.scan();
  assert.equal(result.rows.length,1);
  assert.equal(result.accountHint,'');
});

test('ISOLATED reader tolerates one stale roster missing self among 398 groups',async()=>{
  const data=[...Array.from({length:397},(_,i)=>group(i)),group(397,false)];
  const result=await createScanner(data).scan();
  assert.equal(result.rows.length,398);
  assert.equal(result.accountHint,person(1));
});
test('ISOLATED reader refuses ambiguous near-universal identities',async()=>{
  const data=Array.from({length:40},(_,i)=>({
    id:`19:ambiguous${i}@thread.v2`,
    members:[{id:person(1)},{id:person(2)},{id:person(100+i)}],
    isConversationMembersTruncated:false,conversationMembersTotalCount:2
  }));
  const result=await createScanner(data).scan();
  assert.equal(result.accountHint,'');
});

test('oversized cache roster is a diagnostic partial scan and is never treated as a complete baseline',async()=>{
  const damaged=group(888);
  damaged.members=Array.from({length:3001},(_,n)=>({id:person(n+10000)}));
  const result=await createScanner([group(1),damaged]).scan();
  assert.equal(result.stats.partial,true);
  assert.equal(result.rows.length,1);
  assert.equal(result.accountHint,'');
});

test('malformed but non-oversized member list makes scan incomplete instead of silently skipping group',async()=>{
  const corrupt=group(900);
  corrupt.conversationMembersTotalCount=800; // not the 2/3 members Teams should report
  const res=await createScanner([group(1),corrupt]).scan();
  assert.equal(res.rows.length,1);
  assert.equal(res.stats.partial,true);
  assert.equal(res.stats.unsafeRoster,1);
  assert.equal(res.accountHint,'');
});
