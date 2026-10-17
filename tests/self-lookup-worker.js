/* Synthetic localhost IndexedDB only. Never used by the extension manifest. */
importScripts('../lib/logic.js','../lib/name-core.js','../lib/self-evidence.js','../lib/isolated-reader.js');
const me='8:live:self123456',peer='8:live:peer654321',dbNames=['Teams:conversation-manager:'+me,'Teams:profiles:'+me,'Teams:conversation-manager:8:live:other999999'];
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function open(name,stores){const r=indexedDB.open(name);r.onupgradeneeded=()=>{for(const s of stores)r.result.createObjectStore(s);};return request(r);}
async function put(db,store,key,value){await new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
let reads=[];const nativeTransaction=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(stores,...rest){reads.push(...(typeof stores==='string'?[stores]:[...stores]));return nativeTransaction.call(this,stores,...rest);};
async function scan(options={}){reads=[];const data=await TGSIsolatedReader.scan(options);const known=new Set(data.rows.flatMap(r=>r.members.map(m=>m.id)));
 return {data,recommendation:TGSSelfEvidence.recommend(data.selfEvidence,known,{single:data.stats.databases===1,complete:!data.stats.partial}),reads};}
onmessage=async e=>{try{let result;
 if(e.data.action==='seed'){
  for(const name of dbNames)await request(indexedDB.deleteDatabase(name));
  const d=await open(dbNames[0],['conversations','authProfiles']);
  await put(d,'conversations','group',{id:'19:synthetic-self-lookup@thread.v2',isGroupChat:true,isConversationMembersTruncated:false,
   conversationMembersTotalCount:2,members:[{id:me},{id:peer}],isLastMessageFromMe:true,lastMessage:{from:me,content:'SYNTHETIC_BODY_MUST_NOT_BE_EXPORTED'}});
  await put(d,'authProfiles','forbidden',{accessToken:'SYNTHETIC_SECRET_MUST_NOT_BE_READ'});d.close();
  const p=await open(dbNames[1],['users','userTokens']);
  await put(p,'users','self',{id:me,displayName:'同名测试人',isSelf:true});await put(p,'users','peer',{id:peer,displayName:'同名测试人'});
  await put(p,'userTokens','forbidden',{accessToken:'SYNTHETIC_SECRET_MUST_NOT_BE_READ'});p.close();result=await scan();
 }else if(e.data.action==='conflict'){
  const d=await open(dbNames[1],[]);await put(d,'users','second-self',{id:peer,isSelf:true,displayName:'冲突测试'});d.close();
  result=await scan({refreshProfiles:true});
 }else if(e.data.action==='multiple'){
  const d=await open(dbNames[2],['conversations']);d.close();TGSIsolatedReader.recover();result=await scan();
 }else throw Error('unknown test action');
 postMessage({ok:true,result});
 }catch(e){postMessage({ok:false,error:e.message});}};
