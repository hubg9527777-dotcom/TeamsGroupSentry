/* Read-only comparison of a historical encrypted backup's decrypted data against current local snapshots.
   A cache observation is never treated as a confirmed server-side admission event. */
(function(root,factory){const v=factory();if(typeof module==='object'&&module.exports)module.exports=v;root.TGSBackupDiff=v;})(globalThis,()=>{
  const MAX_REPORT=150;
  const goodAccount=s=>typeof s==='string'&&/^(verified|manual|provisional):[a-f0-9]{32}$/.test(s);
  const goodGroup=s=>typeof s==='string'&&s.startsWith('19:')&&s.length<=720;
  const goodPerson=s=>typeof s==='string'&&/^\d+:[^\s<>]{1,480}$/.test(s);
  function validateBackup(data,activeAccount){
    if(!data||data.format!=='TGS3_BACKUP'||data.version!==1||!goodAccount(data.account)||
       data.account!==activeAccount||!data.tables||typeof data.tables!=='object'||
       !Array.isArray(data.tables.groups)||!Array.isArray(data.tables.people)||
       data.tables.groups.length>6000||data.tables.people.length>200000){
      throw new Error('历史备份格式、账号或记录数量不正确，拒绝跨账号比较');
    }
    if(JSON.stringify(data).length>45*1024*1024)throw new Error('备份解密数据超出 45MB');
    for(const g of data.tables.groups){
      if(!g||g.account!==activeAccount||!goodGroup(g.id)||
         !Array.isArray(g.memberIds)||g.memberIds.length>3000||
         g.memberIds.some(x=>!goodPerson(x))||new Set(g.memberIds).size!==g.memberIds.length)
        throw new Error('历史备份包含异常群成员记录');
    }
    for(const p of data.tables.people){
      if(!p||p.account!==activeAccount||!goodPerson(p.id))throw new Error('历史备份包含异常人员记录');
    }
    return true;
  }
  function compare(data,currentGroups,currentPeople,account){
    validateBackup(data,account);
    const oldGroups=new Map(data.tables.groups.map(g=>[g.id,g]));
    const current=new Map();
    for(const g of currentGroups){
      if(g?.account===account&&goodGroup(g.id)&&Array.isArray(g.memberIds)&&
         g.memberIds.length<=3000&&g.memberIds.every(goodPerson))current.set(g.id,g);
    }
    const currentNames=new Map();
    for(const p of currentPeople){
      if(p?.account===account&&goodPerson(p.id))currentNames.set(p.id,p);
    }
    const priorIds=new Set();
    for(const p of data.tables.people)priorIds.add(p.id);
    for(const g of oldGroups.values())for(const id of g.memberIds)priorIds.add(id);
    const nowIds=new Set(currentNames.keys());
    const personGroups=new Map();
    const additions=[],deletions=[],newGroups=[];
    for(const g of current.values()){
      for(const id of g.memberIds){nowIds.add(id);const arr=personGroups.get(id)||[];arr.push(g);personGroups.set(id,arr);}
      const previous=oldGroups.get(g.id);
      if(!previous){newGroups.push(g);continue;}
      const prior=new Set(previous.memberIds),next=new Set(g.memberIds);
      for(const id of next)if(!prior.has(id))additions.push({groupId:g.id,personId:id,title:g.alias||g.title||g.longTitle||''});
      for(const id of prior)if(!next.has(id))deletions.push({groupId:g.id,personId:id,title:g.alias||g.title||g.longTitle||''});
    }
    const newcomers=[...nowIds].filter(id=>!priorIds.has(id));
    const people=newcomers.slice(0,MAX_REPORT).map(id=>{
      const p=currentNames.get(id)||{},groups=personGroups.get(id)||[];
      return {id,name:typeof p.manualName==='string'&&p.manualName?p.manualName:
          typeof p.name==='string'?p.name:'',status:typeof p.status==='string'?p.status:'',
        inPreviouslyKnownGroup:groups.some(g=>oldGroups.has(g.id)),
        groupCount:groups.length,groups:groups.slice(0,5).map(g=>({id:g.id,title:g.alias||g.title||g.longTitle||''}))};
    });
    return {ok:true,backupAt:typeof data.at==='string'?data.at.slice(0,40):'',
      beforeGroups:oldGroups.size,currentGroups:current.size,newGroupCount:newGroups.length,
      newPeopleCount:newcomers.length,oldGroupNewRelations:additions.length,
      oldGroupMissingRelations:deletions.length,people,
      newGroups:newGroups.slice(0,MAX_REPORT).map(g=>({id:g.id,title:g.alias||g.title||g.longTitle||'',count:g.memberIds.length})),
      additions:additions.slice(0,MAX_REPORT),deletions:deletions.slice(0,MAX_REPORT),
      reportLimited:newcomers.length>MAX_REPORT||additions.length>MAX_REPORT||deletions.length>MAX_REPORT||newGroups.length>MAX_REPORT,
      // Historical diff is not a server-confirmed join time or a replacement for active monitoring.
      kind:'HISTORICAL_CACHE_COMPARISON'};
  }
  return {validateBackup,compare,MAX_REPORT};
});
