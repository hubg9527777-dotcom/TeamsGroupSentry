/* Presentation-only grouping of observed roster changes. No membership or trust decisions. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;root.TGSGroupDirectory=value;})(globalThis,()=>{
  function preview(rows,days=60,now=Date.now(),candidate=null){
    const cutoff=days===0?0:now-days*86400000;
    const added=[],missing=[];
    for(const row of Array.isArray(rows)?rows:[]){
      if(!Number.isFinite(row?.at)||row.at<cutoff||row.at>now+30000)continue;
      for(const [ids,target] of [[row.added,added],[row.missing,missing]]){
        if(!Array.isArray(ids))continue;
        const unique=new Set();
        for(const id of ids){if(typeof id!=='string'||!id||unique.has(id))continue;
          unique.add(id);target.push({id,at:row.at,kind:row.kind||'observed',nameSnapshot:ids.length===1?row.nameSnapshot||'':''});}
      }
    }
    // A pending roster comparison is visible even before a separate history
    // event is saved. Distinguish it from recorded history and do not duplicate
    // the same observation already persisted around the same scan timestamp.
    if(candidate?.source==='candidate'&&Number.isFinite(candidate.at)&&candidate.at>=cutoff&&candidate.at<=now+30000){
      for(const [ids,target] of [[candidate.added,added],[candidate.missing,missing]]){
        for(const id of Array.isArray(ids)?new Set(ids):[]){
          if(typeof id!=='string'||!id)continue;
          if(target.some(row=>row.id===id&&Math.abs(row.at-candidate.at)<=30000))continue;
          target.push({id,at:candidate.at,kind:'pending',nameSnapshot:''});
        }
      }
    }
    added.sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
    missing.sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
    return {added,missing};
  }
  return {preview};
});
