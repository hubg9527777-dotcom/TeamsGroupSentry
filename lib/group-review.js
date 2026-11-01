/* Local-only read model for the group work queue. Observations are NOT proof
 * that someone really joined/left Teams or that a person invited them. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;root.TGSGroupReview=value;})(globalThis,()=>{
  function fromGroup(g,events=[]){
    const baseline=Array.isArray(g?.memberIds)?g.memberIds:[];
    const candidate=g?.ambiguous&&Array.isArray(g.pendingRosterIds)&&g.pendingRosterIds.length?g.pendingRosterIds:null;
    const reviewEvents=events.filter(e=>e?.groupId===g?.id&&e.type==='ROSTER_UNCERTAIN'&&
      (Array.isArray(e.addedIds)||Array.isArray(e.removedIds))).sort((a,b)=>(b.at||0)-(a.at||0));
    if(candidate){const before=new Set(baseline),after=new Set(candidate);
      return {source:'candidate',at:g.pendingSnapshotAt||0,added:[...new Set(candidate.filter(id=>!before.has(id)))],
        missing:[...new Set(baseline.filter(id=>!after.has(id)))],before:baseline.length,after:candidate.length,truncated:false};
    }
    if(g?.ambiguous&&reviewEvents.length){const e=reviewEvents[0];return {source:'event',at:e.at||0,
      added:[...new Set(e.addedIds||[])],missing:[...new Set(e.removedIds||[])],
      before:Number.isInteger(e.oldRosterCount)?e.oldRosterCount:baseline.length,
      after:Number.isInteger(e.candidateRosterCount)?e.candidateRosterCount:null,truncated:e.diffTruncated===true};}
    const archived=events.filter(e=>e?.groupId===g?.id&&e.type==='ROSTER_ALERT_CLOSED_AFTER_LEAVE')
      .sort((a,b)=>(b.at||0)-(a.at||0));
    if(g?.membershipStatus==='LEFT'&&archived.length){const e=archived[0];
      return {source:'archived',at:e.at||0,added:[...new Set(e.addedIds||[])],
        missing:[...new Set(e.removedIds||[])],
        before:Array.isArray(e.previousMemberIds)?e.previousMemberIds.length:baseline.length,
        after:Array.isArray(e.candidateMemberIds)?e.candidateMemberIds.length:null,truncated:false};}
    const observed=events.filter(e=>e?.groupId===g?.id&&
      (e.type==='OBSERVED_ADDITION'||e.type==='FIRST_SEEN_ID'||e.type==='ROSTER_BASELINE_REVIEWED'))
      .sort((a,b)=>(b.at||0)-(a.at||0));
    if(observed.length){const latest=observed[0];
      if(latest.type==='ROSTER_BASELINE_REVIEWED')return {source:'reviewed',at:latest.at||0,
        added:[...new Set(latest.addedIds||[])],missing:[...new Set(latest.removedIds||[])],
        before:Array.isArray(latest.previousMemberIds)?latest.previousMemberIds.length:baseline.length,
        after:Array.isArray(latest.acceptedMemberIds)?latest.acceptedMemberIds.length:null,truncated:false};
      const scope=observed.filter(e=>e.type!=='ROSTER_BASELINE_REVIEWED'&&
        (latest.at||0)-(e.at||0)<=120000);
      return {source:'observed',at:latest.at||0,added:[...new Set(scope.map(e=>e.personId).filter(Boolean))],
        missing:[],before:baseline.length,after:null,truncated:false};
    }
    return {source:'none',at:0,added:[],missing:[],before:baseline.length,after:null,truncated:false};
  }
  function formatPerson(id,person){const name=(person?.manualName||person?.name||'姓名待核实');return {id,name,status:person?.status||'UNKNOWN'};}
  return {fromGroup,formatPerson};
});
