/* Synthetic UI harness only. Never loaded by the extension manifest. */
(()=>{
  const params=new URLSearchParams(location.search);
  let fixture={risk:'IMPERSONATION_CONTACT',pending:1,ordinary:0,mode:'always',wrongAccount:false,...Object.fromEntries(['risk','mode'].filter(k=>params.has(k)).map(k=>[k,params.get(k)]))};
  if(params.get('history')==='true')Object.assign(fixture,{history:true});
  if(params.get('multi')==='true')Object.assign(fixture,{multi:true});
  if(params.get('preview')==='true')Object.assign(fixture,{preview:true});
  if(params.get('notice')==='true')Object.assign(fixture,{pending:0,notice:true,wrongAccount:true});
  if(params.get('small')==='true')Object.assign(fixture,{pending:0,small:true,wrongAccount:true});
  if(params.get('lookup')==='true')Object.assign(fixture,{pending:0,small:true,wrongAccount:true,lookup:true});
  const listeners=[],calls=[];
  window.fixtureCalls=calls;
  const originalShadow=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(options){const shadow=originalShadow.call(this,options);window.fixtureRoot=shadow;return shadow;};
  function snapshot(){
    const events=Array.from({length:fixture.pending},(_,i)=>({type:'CONTACT_REQUEST',status:'OPEN',risk:fixture.risk,id:'synthetic-'+i}));
    const requests=fixture.wrongAccount?TGSContactRisk.summary([]):TGSContactRisk.summary(events);
    return {ok:true,prefs:{mode:fixture.mode,offset:'top'},level:requests.pending?'alert':fixture.wrongAccount?'readonly':'ok',
      groups:fixture.small?1:401,newUnknown:0,openUrgent:0,openInfo:fixture.ordinary,ambiguous:0,savedAmbiguous:0,lastRead:Date.now(),requests,
      requestNotice:fixture.notice?{...TGSRequestNotice.view(TGSRequestNotice.evolve(null,{
        adapter:'TEAMS_REQUEST_SIGNAL_V1',fingerprint:'b'.repeat(64),source:'VISIBLE_ROWS',
        count:fixture.multi?2:1,observed:true,meeting:!fixture.preview,
        details:[{key:'f'.repeat(64),title:fixture.preview?'王六':'虚构会议',name:fixture.preview?'王六':'',
          kind:fixture.preview?'CHAT':'MEETING',previewAvailable:!fixture.preview,origin:fixture.cache?'CACHE':'VISIBLE_PREVIEW',
          messages:fixture.preview?(fixture.history?['第一条：请核实身份','第二条：这是虚构演示','第三条：最后一条消息'].map(text=>({author:'王六',text})):[{author:'王六',text:'你好，请核实我的身份。'+(fixture.attack?'<img src=x onerror=alert(1)>':'')}]):[]},
          ...(fixture.multi?[{key:'e'.repeat(64),title:fixture.long?'很长的会议名称'.repeat(16):'项目交流会（虚构）',name:'',kind:'MEETING',previewAvailable:false,origin:'CACHE',
            messages:fixture.long?[{author:'李四',text:'仅用于换行验证的虚构文字'.repeat(25)}]:[]}]:[])]
      },1)),tabId:11,token:'a'.repeat(64)}:{pending:false},
      readOnly:fixture.wrongAccount,guard:fixture.small?{mode:'READ_ONLY',reason:'虚构单群首次绑定',account:'provisional:synthetic',
        firstSetup:true,smallSetup:true,canBind:true,at:Date.now(),eligibleGroups:1,inspected:1,
        selfCandidates:[{id:'8:live:self123456',name:'本人（虚构）',count:1},{id:'8:live:other654321',name:'群友（虚构）',count:1}],
        selfEvidenceIds:['8:live:self123456','8:live:other654321'],selfSuggestion:fixture.lookup?{status:'CANDIDATE',personId:'8:live:self123456',name:'本人（虚构）',reason:'本地资料中明确标记为本人。这是待你确认的本地线索，不是微软身份认证'}:{status:'NOT_FOUND',reason:'当前缓存没有明确本人线索，请勿猜选'}}:fixture.wrongAccount?{mode:'READ_ONLY',reason:'虚构账号切换测试'}:null};
  }
  window.chrome={runtime:{getURL:path=>'chrome-extension://synthetic/'+path,onMessage:{addListener:fn=>listeners.push(fn)},
    sendMessage:async msg=>{
      if(fixture.fail)throw Error('Synthetic unavailable');
      const value=snapshot();
      if(msg.action==='REQUEST_NOTICE_STATUS')return {ok:true,requestNotice:value.requestNotice};
      if(msg.action==='SCAN_NOW'){calls.push(msg);return {ok:true,scanned:fixture.small?1:401};}
      if(msg.action==='ACK_REQUEST_UI_NOTICE'){fixture.notice=false;return {ok:true};}
      if(msg.action==='OVERLAY_STATUS')return fixture.holdOverlay?new Promise(resolve=>window.fixtureReleaseOverlay=()=>resolve(value)):value;
      if(msg.action==='SUMMARY'&&fixture.holdSummary)return new Promise(()=>{});
      if(msg.action==='SUMMARY')return {ok:true,status:{...value,indexed:!fixture.wrongAccount},
        counts:{...value,people:1143},guard:value.guard,active:{account:'synthetic-account',at:Date.now()}};
      if(msg.action==='OVERLAY_PREFS_SET'){fixture.mode=msg.prefs.mode;return {ok:true,prefs:msg.prefs};}
      calls.push(msg);return {ok:true};
    }},tabs:{create:async msg=>{calls.push(msg);return {};}}};
  window.fixtureSet=async delta=>{
    fixture={...fixture,...delta};
    for(const listener of listeners){listener({action:'SECURITY_STATE_CHANGED'});listener({action:'OVERLAY_REFRESH'});}
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  };
  window.fixtureFastNotice=async()=>{fixture.notice=true;for(const fn of listeners)fn({action:'REQUEST_NOTICE_CHANGED',notice:snapshot().requestNotice});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
  window.fixtureReady=new Promise(resolve=>window.addEventListener('load',async()=>{
    await window.fixtureSet({});
    if(params.get('expanded')==='true')window.fixtureRoot?.querySelector('.primary')?.click();
    resolve();
  },{once:true}));
})();
