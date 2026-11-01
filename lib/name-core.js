/* Safe, deterministic profile-record ID/name extraction. Does not inspect message content. */
(function(root,factory){const v=factory();if(typeof module==='object'&&module.exports)module.exports=v;root.TGSNames=v;})(globalThis,()=>{
  const ID=/^(?:8:|28:|5:|4:|1:)/i;
  const ID_FIELDS=['mri','id','userId','skypeId','contactId','personId','memberId','identity','userMri','contactMri','memberMri','userMRI','personMri'];
  const NAME_FIELDS=['displayName','friendlyName','fullName','display_name','formattedName','contactName','name','nickname','userDisplayName','profileName','display_name_native','contactDisplayName'];
  const CONTAINERS=['value','profile','user','person','contact','details','userProfile','data','result','item','attributes','properties','identity','contactInfo','profileInfo','userInfo','memberProfile','profileData','contactData','users','contacts','profiles','members','participants'];
  const INVALID_ID=/[\s<>\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
  const UNSAFE_FORMAT=/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
  const validId=x=>typeof x==='string'&&x.length<=512&&ID.test(x)&&!INVALID_ID.test(x);
  const cleanName=(s,id)=>{
    if(typeof s!=='string')return '';
    const x=s.replace(UNSAFE_FORMAT,' ').trim().slice(0,160);
    return x&&x!==id&&!validId(x)&&!x.includes('@thread')&&!/^(?:unknown|undefined|null|none|user|contact)$/i.test(x)?x:'';
  };
  function rowKeyId(key){
    if(validId(key))return key;
    // Some Teams profile records use a compound IndexedDB key. Only consider
    // an ENTIRE segment with a valid MRI, not an arbitrary substring of a key.
    if(Array.isArray(key)){for(const k of key)if(validId(k))return k;}
    if(key&&typeof key==='object')for(const prop of ID_FIELDS)if(validId(key[prop]))return key[prop];
    return '';
  }
  // Explicit ID in a nested profile always wins over a parent ID.
  function extract(row,key,known){
    const out=[];const seen=new Set(),queue=[{obj:row,id:rowKeyId(key),depth:0}];let count=0;
    while(queue.length&&count++<120){const {obj,id:inherited,depth}=queue.shift();
      if(!obj||typeof obj!=='object'||seen.has(obj)||depth>5)continue;
      seen.add(obj);
      let id=inherited;
      for(const k of ID_FIELDS)if(validId(obj[k])){id=obj[k];break;}
      if(validId(id)&&known.has(id)){
        for(const field of NAME_FIELDS){const name=cleanName(obj[field],id);if(name){out.push({id,name});break;}}
      }
      for(const field of CONTAINERS){const sub=obj[field];
        if(Array.isArray(sub)){for(const o of sub.slice(0,60))if(o&&typeof o==='object')
          // Collection items must identify themselves. Inheriting a parent ID
          // across a contact list would attach another person's name to it.
          queue.push({obj:o,id:'',depth:depth+1});}
        else if(sub&&typeof sub==='object'){
          // A map indexed by complete MRI gives an exact key-to-name link.
          // Never infer a name from the iteration order of a collection.
          const entries=Object.entries(sub);
          if(entries.length>0&&entries.length<=60&&entries.some(([k])=>validId(k))){
            for(const [k,v] of entries)if(validId(k)&&v&&typeof v==='object')
              queue.push({obj:v,id:k,depth:depth+1});
          }else queue.push({obj:sub,id,depth:depth+1});
        }
      }
    }
    return out;
  }
  function merge(map,pair,source,priority,stats){
    const old=map.get(pair.id);
    if(!old||priority>old.priority){map.set(pair.id,{...pair,source,priority});return;}
    if(priority===old.priority&&old.name!==pair.name){
      // A conflict is not a verified match: exclude until a higher-priority source resolves it.
      map.set(pair.id,{...old,conflict:true});if(stats)stats.nameConflicts=(stats.nameConflicts||0)+1;
    }
  }
  // Group-title evidence only: identical membership patterns across >=2 group titles
  // can suggest a name, but never writes a verified name or changes approval status.
  function inferTitleSuggestions(groups,people){
    const gm=new Map(),gn=new Map();
    const add=(map,key,gid)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(gid);};
    for(const g of groups){
      const mids=Array.isArray(g.memberIds)?g.memberIds:[],names=Array.isArray(g.titleNameHints)?g.titleNameHints:[];
      if(g.title||mids.length<3||mids.length>70||names.length!==mids.length||new Set(names).size!==names.length)continue;
      if(!mids.every(validId))continue;
      for(const id of mids)add(gm,id,g.id);
      for(const name of names)add(gn,name,g.id);
    }
    const signature=set=>[...set].sort().join('|');
    const byId=new Map(),byName=new Map();
    for(const [id,set] of gm){if(set.size<2)continue;const sig=signature(set);if(!byId.has(sig))byId.set(sig,[]);byId.get(sig).push(id);}
    for(const [name,set] of gn){if(set.size<2)continue;const sig=signature(set);if(!byName.has(sig))byName.set(sig,[]);byName.get(sig).push(name);}
    const result=new Map();
    for(const [sig,ids] of byId){const names=byName.get(sig)||[];
      if(ids.length===1&&names.length===1&&!(people?.get(ids[0])?.name||people?.get(ids[0])?.manualName)){
        result.set(ids[0],{name:names[0],evidence:gm.get(ids[0]).size,verified:false});
      }
    }
    return result;
  }
  return {extract,merge,validId,rowKeyId,cleanName,inferTitleSuggestions};
});
