/* Account-scoped local group history read model. Scan time is NOT Teams join/leave time. */
(function(root,factory){const v=factory();if(typeof module==='object'&&module.exports)module.exports=v;root.TGSGroupHistory=v;})(globalThis,()=>{
  const MAX_ITEMS=300;
  const numberAt=e=>Number.isFinite(e?.at)&&e.at>0?e.at:0;
  // Keep the first 100 unique display IDs without creating a potentially huge
  // temporary Set from an untrusted event array.
  const ids=value=>{
    if(!Array.isArray(value))return [];
    const result=[],seen=new Set();
    for(const id of value){
      if(typeof id==='string'&&id.length>0&&!seen.has(id)){
        seen.add(id);result.push(id);
        if(result.length===100)break;
      }
    }
    return result;
  };
  // Use structured array keys: IDs can contain commas or pipes, which makes
  // string-joined fingerprints ambiguous for different member sets.
  const pairKey=(added,missing)=>JSON.stringify([added,missing]);
  function within30s(index,key,at){
    const times=index.get(key);
    if(!times?.length)return false;
    // times are in descending order; find an event no more than 30 seconds away.
    let low=0,high=times.length;
    while(low<high){const mid=(low+high)>>1;
      if(times[mid]>at+30000)low=mid+1;
      else high=mid;
    }
    return low<times.length&&times[low]>=at-30000;
  }
  // One observed snapshot may also emit per-person alerts; do not show the same ID twice.
  function entries(groupId,events=[],now=Date.now()){
    const rows=Array.isArray(events)?events.filter(e=>e&&e.groupId===groupId&&numberAt(e)&&numberAt(e)<=now+30000):[];
    const snapshotTypes=new Set(['ROSTER_CHANGE_OBSERVED','ROSTER_UNCERTAIN','ROSTER_BASELINE_REVIEWED','ROSTER_ALERT_CLOSED_AFTER_LEAVE']);
    const recent=rows.filter(e=>snapshotTypes.has(e.type)).sort((a,b)=>numberAt(b)-numberAt(a))
      .map(e=>({event:e,at:numberAt(e),added:ids(e.addedIds),missing:ids(e.removedIds)}));
    const observedIndex=new Map(),allNonArchive=new Set(),snapshotPersonIndex=new Map();
    const indexAt=(index,key,at)=>{const dates=index.get(key)||[];dates.push(at);index.set(key,dates);};
    for(const row of recent){
      const {event:e,added,missing,at}=row;
      const fp=pairKey(added,missing);
      if(e.type==='ROSTER_CHANGE_OBSERVED')indexAt(observedIndex,fp,at);
      if(e.type!=='ROSTER_ALERT_CLOSED_AFTER_LEAVE')allNonArchive.add(fp);
      if(['ROSTER_CHANGE_OBSERVED','ROSTER_UNCERTAIN','ROSTER_BASELINE_REVIEWED'].includes(e.type))
        for(const id of added)indexAt(snapshotPersonIndex,id,at);
    }
    const result=[],seen=new Set();
    for(const row of recent){
      const {event:e,at,added,missing}=row;
      if(!added.length&&!missing.length)continue;
      const fp=pairKey(added,missing);
      if(e.type==='ROSTER_UNCERTAIN'&&within30s(observedIndex,fp,at))continue;
      // The leave archive copies an earlier alert; it never represents another join.
      if(e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE'&&allNonArchive.has(fp))continue;
      const unique=JSON.stringify([at,added,missing]);
      if(seen.has(unique))continue;seen.add(unique);
      const kind=e.type==='ROSTER_BASELINE_REVIEWED'?'reviewed':e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE'?'archived':'observed';
      result.push({at,kind,added,missing,id:e.id||'',truncated:e.diffTruncated===true,
        before:Number.isInteger(e.oldRosterCount)?e.oldRosterCount:null,
        after:Number.isInteger(e.candidateRosterCount)?e.candidateRosterCount:null});
    }
    // A confirmation of the same cache change is not a second join/leave.
    // Attach its review time to the original observation instead of double-counting.
    // Index only earlier observations, in a 30-day window, to avoid quadratic rescans.
    const observations=new Map(),observedRows=new Map();
    for(const r of result.filter(r=>r.kind==='observed')){
      const fp=pairKey(r.added,r.missing);
      indexAt(observations,fp,r.at);
      if(!observedRows.has(fp))observedRows.set(fp,new Map());
      if(!observedRows.get(fp).has(r.at))observedRows.get(fp).set(r.at,r);
    }
    for(const [fp,times] of observations)times.sort((a,b)=>a-b);
    const processedReviews=new Set();
    for(const reviewed of result.filter(r=>r.kind==='reviewed')){
      const fp=pairKey(reviewed.added,reviewed.missing),times=observations.get(fp);
      if(!times)continue;
      let low=0,high=times.length;
      while(low<high){const mid=(low+high)>>1;if(times[mid]<=reviewed.at)low=mid+1;else high=mid;}
      // Original behavior attaches to the most recent eligible *observed* row
      // according to the results order (latest first), not the oldest one.
      const prior=times[low-1];
      if(prior===undefined||reviewed.at-prior>30*86400000)continue;
      const original=observedRows.get(fp)?.get(prior);
      if(original){original.reviewedAt=reviewed.at;processedReviews.add(reviewed);}
    }
    if(processedReviews.size)for(let i=result.length-1;i>=0;i--)if(processedReviews.has(result[i]))result.splice(i,1);
    const singles=rows.filter(e=>['OBSERVED_ADDITION','FIRST_SEEN_ID'].includes(e.type)&&typeof e.personId==='string');
    for(const e of singles){
      if(within30s(snapshotPersonIndex,e.personId,numberAt(e)))continue;
      const at=numberAt(e),unique=JSON.stringify(['single',e.type,at,e.personId]);
      if(seen.has(unique))continue;seen.add(unique);
      result.push({at,kind:e.type==='FIRST_SEEN_ID'?'firstSeen':'observed',added:[e.personId],missing:[],
        id:e.id||'',nameSnapshot:typeof e.nameSnapshot==='string'?e.nameSnapshot.slice(0,120):''});
    }
    return result.sort((a,b)=>b.at-a.at).slice(0,MAX_ITEMS);
  }
  function filter(rows,days=30,now=Date.now()){
    const cutoff=days===0?0:now-days*86400000;
    return (Array.isArray(rows)?rows:[]).filter(r=>r.at>=cutoff&&r.at<=now+30000);
  }
  function summary(rows,days=30,now=Date.now()){
    const subset=filter(rows,days,now);
    return {changes:subset.length,added:subset.reduce((n,r)=>n+r.added.length,0),
      missing:subset.reduce((n,r)=>n+r.missing.length,0)};
  }
  return {entries,filter,summary};
});
