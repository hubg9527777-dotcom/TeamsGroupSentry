/* Passive projection of the conversation schema verified in Teams personal,
 * 2026-10-16. No service calls, UI actions, credentials or persistent writes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TGSRequestCache=api;})(globalThis,()=>{
  const PREFIX='message-slice-card-requests-RequestsSliceCardItem|';
  const clean=(s,n=120)=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';
  const thread=s=>typeof s==='string'&&/^19:[^\s<>]{1,520}@thread(?:\.[\w-]+)?$/i.test(s);
  function plain(content,doc){
    if(typeof content!=='string'||content.length>64000)return '';
    // Template content is inert: embedded media never loads and scripts never run.
    const t=doc.createElement('template');t.innerHTML=content;
    t.content.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach(e=>e.remove());
    t.content.querySelectorAll('br,p,div,li,blockquote').forEach(e=>{e.prepend(' ');e.append(' ');});
    return clean(t.content.textContent,300);
  }
  function isSelfMessage(v,selfId){
    if(!selfId||!Array.isArray(v?.members)||v.members.length>3000)return false;
    const ids=[v.lastMessage?.from,v.lastMessage?.fromUserId].filter(x=>typeof x==='string');
    if(ids.some(x=>/^(?:8|28|5|4|1):/.test(x)&&x!==selfId))return false;
    const matched=[...new Set(v.members.filter(m=>ids.includes(m?.id)).map(m=>m.id))];
    return matched.length===1&&matched[0]===selfId;
  }
  function project(v,doc,selfId=''){
    if(!v||!thread(v.id)||!['Chat','Meeting'].includes(v.type)||
       v.memberProperties?.relationshipState?.inQuarantine!==true||isSelfMessage(v,selfId))return null;
    const detail={key:PREFIX+v.id,title:clean(v.chatTitle?.longTitle||v.chatTitle?.shortTitle),
      kind:v.type==='Meeting'?'MEETING':'CHAT',name:'',previewAvailable:false,officialWarning:false,
      origin:'CACHE',messages:[]};
    const m=v.lastMessage;
    // Explicit authors stay separate from inviters. Never read *InToken fields.
    if(m&&m.contenttype==='Text'&&m.messagetype==='RichText/Html'&&!m.deletionInfo&&
       v.threadProperties?.isLastMessageFromMe!==true&&Array.isArray(v.members)&&v.members.length<=3000){
      const ids=[m.from,m.fromUserId].filter(s=>typeof s==='string'&&s.length<=512);
      const matches=[...new Set(v.members.filter(x=>ids.includes(x?.id)).map(x=>x.id))];
      const author=clean(m.imdisplayname),text=plain(m.content,doc);
      if(matches.length===1&&author&&text){detail.messages=[{author,text}];
        // Used only to produce a digest before crossing into extension session storage.
        detail.messageRevision=JSON.stringify([m.id,m.version,m.composetime,m.originalarrivaltime]);}
    }
    return detail;
  }
  async function scan(idb,doc,resolveSelf,wantedKeys){
    const wanted=Array.isArray(wantedKeys)?new Set(wantedKeys.slice(0,200)):null;
    let db,tx,timer;
    const work=(async()=>{
      const ds=(await idb.databases()).filter(d=>typeof d.name==='string'&&/^Teams:conversation-manager:/i.test(d.name));
      if(expired)throw Error('CACHE_TIMEOUT');
      if(ds.length!==1)return {details:[],status:ds.length?'AMBIGUOUS_SCOPE':'NO_CACHE'};
      const selfId=typeof resolveSelf==='function'?await resolveSelf(ds[0].name):'';
      if(expired)throw Error('CACHE_TIMEOUT');
      db=await new Promise((resolve,reject)=>{let settled=false;const r=idb.open(ds[0].name);r.onupgradeneeded=()=>r.transaction.abort();
        r.onerror=()=>{settled=true;reject(Error('CACHE_UNAVAILABLE'));};r.onblocked=()=>{settled=true;reject(Error('CACHE_BLOCKED'));};
        r.onsuccess=()=>{if(expired||settled){r.result.close();reject(Error('CACHE_TIMEOUT'));}else{settled=true;resolve(r.result);}};});
      if(expired)throw Error('CACHE_TIMEOUT');
      if(!db.objectStoreNames.contains('conversations'))return {details:[],status:'UNSUPPORTED'};
      return await new Promise((resolve,reject)=>{
        tx=db.transaction('conversations','readonly');const req=tx.objectStore('conversations').openCursor();
        let visited=0;const details=[],selfKeys=[];
        tx.onabort=tx.onerror=()=>reject(Error('CACHE_INCOMPLETE'));
        tx.oncomplete=()=>resolve({details,selfKeys,status:'OK'});
        req.onsuccess=()=>{const c=req.result;if(!c)return;
          if(++visited>20000){tx.abort();return;}
          if(c.value?.memberProperties?.relationshipState?.inQuarantine===true&&isSelfMessage(c.value,selfId)&&thread(c.value?.id)&&selfKeys.length<200)selfKeys.push(PREFIX+c.value.id);
          if(wanted&&!wanted.has(PREFIX+c.value?.id)){c.continue();return;}
          const d=project(c.value,doc,selfId);if(d){if(details.length>=20)return;details.push(d);}c.continue();};
        req.onerror=()=>reject(Error('CACHE_INCOMPLETE'));
      });
    })();
    let expired=false;
    try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{
      expired=true;try{tx?.abort();}catch{}reject(Error('CACHE_TIMEOUT'));},1800);})]);}
    catch{return {details:[],status:'UNAVAILABLE'};}
    finally{clearTimeout(timer);try{db?.close();}catch{}}
  }
  // Cache content is a supplement, never evidence that a request currently exists.
  function supplement(snapshot,cached,seen){
    if(!snapshot.observed)return {...snapshot,keys:[],details:[]};
    const keys=new Set(snapshot.keys||[]),byKey=new Map(cached.map(d=>[d.key,d]));
    const details=(snapshot.details||[]).filter(d=>keys.has(d.key)).slice(0,20).map(d=>{
      const prior=seen.get(d.key),cache=byKey.get(d.key);
      const dom=d.messages?.length?d.messages:prior?.messages||[];
      const latest=cache?.messages?.at(-1)||dom.at(-1);
      let messages=(dom.length?dom:cache?.messages||[]).slice(-10);
      if(latest&&!messages.some(m=>m.author===latest.author&&m.text===latest.text))messages=[...messages,latest].slice(-10);
      return {...d,name:d.name||prior?.name||'',officialWarning:d.officialWarning||prior?.officialWarning||false,
        messages,origin:d.messages?.length?'VISIBLE_PREVIEW':prior?.origin||cache?.origin||'VISIBLE_PREVIEW',
        ...(latest?{latestMessage:{author:latest.author,text:latest.text}}:{}),
        ...(cache?.messageRevision?{messageRevision:cache.messageRevision}:{})};
    });
    return {...snapshot,details};
  }
  return {project,plain,scan,isSelfMessage,supplement};
});
