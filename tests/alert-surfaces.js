(async()=>{
 const results=[];
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const frames=Object.fromEntries(['popup','compact','expanded'].map(id=>[id,document.getElementById(id)]));
 await Promise.all(Object.values(frames).map(frame=>new Promise(resolve=>{
   const ready=()=>frame.contentWindow.fixtureReady.then(resolve);
   if(frame.contentDocument.readyState==='complete'&&frame.contentWindow.fixtureReady)ready();else frame.addEventListener('load',ready,{once:true});
 })));
 const popup=frames.popup.contentWindow,compact=frames.compact.contentWindow,expanded=frames.expanded.contentWindow;
 const pop=id=>popup.document.getElementById(id),root=()=>compact.fixtureRoot,ex=()=>expanded.fixtureRoot;
 const visible=e=>!!e&&e.getClientRects().length>0;
 async function test(name,fn){try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}
   const row=document.createElement('li');row.className=results.at(-1).ok?'pass':'fail';row.textContent=(results.at(-1).ok?'PASS ':'FAIL ')+name+(results.at(-1).error?' — '+results.at(-1).error:'');document.getElementById('results').append(row);}
 await test('请求风险独立出现时，弹窗优先显示风险卡片，先显示原因再显示统计',()=>{
   assert(popup.document.body.classList.contains('has-alert'),'popup header must be red');
   assert(visible(pop('alertBanner'))&&visible(pop('contactRequests')),'popup alert/CTA missing');
   assert(pop('alertDetail').textContent.includes('ID 不同'),'missing reason');
   assert(pop('alertBanner').getBoundingClientRect().bottom<popup.document.querySelector('.grid').getBoundingClientRect().top,'alert must be above counters');
 });
 await test('收起状态栏保持收起，并直接显示风险原因、人数和入口',()=>{
   assert(!visible(root().querySelector('.details')),'must remain compact');
   for(const selector of ['.title','.request-reason','.request-count'])assert(visible(root().querySelector(selector)),selector+' missing');
   assert(root().querySelector('.title').textContent.includes('1 人待核实'),'count missing');
   assert(root().querySelector('.request-reason').textContent.includes('ID 不同'),'reason missing');
 });
 await test('展开状态栏保留红色标题，另有完整核实警告和直接入口',()=>{
   assert(visible(ex().querySelector('.request-warning')),'warning missing');
   assert(ex().querySelector('.request-warning').textContent.includes('核实前请勿通过'),'advice missing');
   assert(visible(ex().querySelector('.request-warning button')),'expanded CTA missing');
 });
 await test('三处入口均直接进入陌生好友清单',()=>{
   pop('contactRequests').click();root().querySelector('.request-count').click();ex().querySelector('.request-warning button').click();
   assert(popup.fixtureCalls.some(c=>c.url?.endsWith('ui/dashboard.html?page=requests')),'popup target');
   for(const w of [compact,expanded])assert(w.fixtureCalls.some(c=>c.action==='OPEN_DASHBOARD'&&c.page==='requests'),'overlay target');
 });
 await test('普通变动不会挤掉收起状态栏的完整风险标题或人数',async()=>{
   await compact.fixtureSet({ordinary:93,pending:12});
   const title=root().querySelector('.title'),reason=root().querySelector('.request-reason');
   assert(title.scrollWidth<=title.clientWidth+1&&reason.scrollWidth<=reason.clientWidth+1,'text clipped');
   assert(title.textContent.includes('12 人待核实'),'count lost');
   assert(!visible(root().querySelector('.info-count:not(.request-count)')),'ordinary counter crowds alert');
 });
 await test('展开后仍可查看普通变动，不丢失原有入口',async()=>{
   await expanded.fixtureSet({ordinary:93});const button=ex().querySelector('.info-detail-link');
   assert(visible(button)&&button.textContent.includes('93'),'ordinary link lost');button.click();
   assert(expanded.fixtureCalls.some(c=>c.page==='events'&&c.filter==='info'),'wrong ordinary route');
 });
 await test('普通陌生请求三处都说明首次 ID，不误称同名冒充',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({risk:'STRANGER',pending:1,ordinary:0});
   assert(pop('alertDetail').textContent.includes('首次出现')&&!pop('alertDetail').textContent.includes('同名'),'popup false collision');
   assert(root().querySelector('.request-reason').textContent.includes('首次出现'),'compact wrong reason');
   assert(ex().querySelector('.request-warning p').textContent.includes('首次出现'),'expanded wrong reason');
 });
 await test('ID 或请求类型证据不足时三处都明确无法判断',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({risk:'MISSING_ID'});
   assert(pop('alertDetail').textContent.includes('无法判断'),'popup claims known identity');
   assert(root().querySelector('.request-reason').textContent.includes('无法确认'),'compact missing limitation');
   assert(ex().querySelector('.request-warning p').textContent.includes('证据不足'),'expanded missing limitation');
 });
 await test('待办显示模式也必须展示风险，不因普通事件为零而隐藏',async()=>{
   await compact.fixtureSet({risk:'IMPERSONATION_CONTACT',mode:'alerts'});
   assert(visible(compact.document.getElementById('tgs-v31-status-host')),'alerts-only hides requests');
 });
 await test('用户明确设置完全隐藏时，仍遵守原显示偏好',async()=>{
   await compact.fixtureSet({mode:'hidden'});assert(!visible(compact.document.getElementById('tgs-v31-status-host')),'hidden preference overridden');
   await compact.fixtureSet({mode:'always'});
 });
 await test('风险处理后，弹窗及两种状态栏恢复简洁，不残留红色或警告',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({pending:0,ordinary:0});
   assert(!visible(pop('alertBanner'))&&!visible(pop('contactRequests'))&&!popup.document.body.classList.contains('has-alert'),'popup stale alert');
   for(const r of [root(),ex()])assert(!r.querySelector('.shell').classList.contains('request-alert')&&!visible(r.querySelector('.request-warning'))&&!visible(r.querySelector('.request-reason')),'overlay stale alert');
 });
 await test('账号切换时不展示上一个账号的好友风险',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({pending:1,wrongAccount:true});
   assert(!visible(pop('contactRequests')),'popup leaks old request');
   assert(!visible(root().querySelector('.request-count'))&&!visible(ex().querySelector('.request-warning')),'overlay leaks old request');
 });
 await test('弹窗刷新失败不残留上次的可处理好友入口',async()=>{
   await popup.fixtureSet({wrongAccount:false,pending:1});await popup.fixtureSet({fail:true});
   assert(!visible(pop('contactRequests'))&&visible(pop('healthBanner')),'stale actionable request');
 });
 await test('已确认的界面请求独立以红色显示，账号未确认也不等待群巡检',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({fail:false,pending:0,notice:true,ordinary:0,wrongAccount:true});
   assert(visible(pop('requestNotice'))&&popup.document.body.classList.contains('has-request-notice'),'popup missing notice');
   assert(!visible(pop('alertBanner')),'UI evidence must not become impersonation risk');
   for(const r of [root(),ex()])assert(r.querySelector('.shell').classList.contains('notice-alert')&&r.querySelector('.title').textContent.includes('请求待核实'),'overlay notice missing');
   assert(pop('requestNotice').textContent.includes('人员 ID：待核实')&&pop('requestNotice').textContent.includes('消息内容：尚未读取'),'missing explicit limitations');
   assert(root().querySelector('.request-reason').textContent.includes('待预览'),'compact lacks preview guidance');
   assert(visible(ex().querySelector('.notice-warning')),'expanded missing detail');
 });
 await test('弹窗群汇总一直未返回时，请求卡片仍独立显示',async()=>{
   await popup.fixtureSet({notice:false});await popup.fixtureSet({holdSummary:true,notice:true});
   assert(visible(pop('requestNotice')),'notice waits for summary');await popup.fixtureSet({holdSummary:false});
 });
 await test('收起栏可直接展开请求详情，已查看不触发 Teams 接受或身份审核',async()=>{
   root().querySelector('.request-count').click();assert(visible(root().querySelector('.notice-warning')),'details not expanded');
   pop('requestNoticeAck').click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   assert(!visible(pop('requestNotice')),'popup notice not acknowledged');
   for(const w of [popup,compact,expanded])assert(!w.fixtureCalls.some(c=>c.action==='REVIEW_CONTACT_REQUEST'),'UI notice approved identity');
 });
 await test('请求快通路不会被先前缓慢返回的状态覆盖',async()=>{
   await compact.fixtureSet({notice:false,holdOverlay:true});
   await compact.fixtureFastNotice();compact.fixtureReleaseOverlay();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   assert(root().querySelector('.title').textContent.includes('请求待核实'),'stale response hid notice');
   await compact.fixtureSet({holdOverlay:false});
 });
 await test('新请求界面提醒与既有高风险并存时不降级红色警报',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:true,wrongAccount:false,pending:1,risk:'IMPERSONATION_CONTACT'});
   assert(visible(pop('requestNotice'))&&visible(pop('alertBanner')),'popup lost either warning');
   assert(root().querySelector('.shell').classList.contains('request-alert'),'risk downgraded');
 });
 await test('预览姓名正文在弹窗及两种状态栏同步显示，均为红色且不渲染消息 HTML',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:true,preview:true,attack:true,pending:0,wrongAccount:true});
   assert(pop('requestNoticeTitle').textContent.startsWith('🔴'),'popup not red');
   assert(popup.getComputedStyle(pop('requestNotice')).borderTopColor==='rgb(197, 42, 50)','popup red border missing');
   assert(pop('requestNoticeDetails').textContent.includes('王六')&&pop('requestNoticeDetails').textContent.includes('你好'),'popup missing excerpts');
   assert(pop('requestNoticeDetails').querySelector('img')===null,'untrusted HTML rendered');
   assert(pop('requestNoticeIdentity').textContent.includes('ID：待核实')&&pop('requestNoticeIdentity').textContent.includes('已读取'),'wrong coverage');
   for(const r of [root(),ex()]){assert(r.querySelector('.request-reason').textContent.includes('王六：“你好'),'compact lacks author/text');assert(r.querySelector('.notice-excerpts').textContent.includes('王六'),'details lack sender');assert(!r.querySelector('.notice-excerpts img'),'HTML rendered');}
 });
 await test('缓存消息在三处标记来源，仍提示核实后再决定接受',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:true,preview:true,cache:true,attack:false});
   assert(pop('requestNoticeIdentity').textContent.includes('本地缓存'),'cache origin missing');
   assert(pop('requestNoticeAdvice').textContent.includes('核实身份后再决定是否接受'),'accept caution missing');
   for(const r of [root(),ex()])assert(r.querySelector('.notice-excerpts').textContent.includes('你好'),'cache excerpt missing');
 });
 await test('无正文时三处引导先预览，详情明确不要直接接受',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:true,preview:false,cache:false});
   assert(pop('requestNoticeAdvice').textContent.includes('不要为看消息直接点「接受」'),'popup lacks caution');
   for(const r of [root(),ex()]){assert(r.querySelector('.request-reason').textContent.includes('待预览'),'compact guidance missing');assert(r.querySelector('.notice-warning').textContent.includes('预览他们的消息'),'expanded guidance missing');}
 });
 await test('两条请求分别编号、分卡，有正文和无正文一眼可辨',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:true,preview:true,multi:true,cache:true});
   const cards=pop('requestNoticeDetails').querySelectorAll('.request-item');assert(cards.length===2,'expected two cards');
   assert(cards[0].querySelector('.request-kind').textContent.startsWith('1.'),'first number');
   assert(cards[1].querySelector('.request-kind').textContent.startsWith('2.'),'second number');
   assert(cards[1].textContent.includes('正文暂不可得'),'missing body state');
   for(const r of [root(),ex()]){assert(r.querySelectorAll('.request-item').length===2,'overlay numbered list');assert(r.querySelector('.request-reason').textContent.includes('2.'),'compact second request missing');}
 });
 await test('红边与标题强调，正文白色且页面头部保持中性',()=>{
   assert(popup.getComputedStyle(pop('requestNoticeDetails').querySelector('.request-message')).color==='rgb(248, 250, 252)','body must be white');
   assert(popup.getComputedStyle(pop('requestNoticeTitle')).color!==popup.getComputedStyle(pop('requestNoticeDetails').querySelector('.request-message')).color,'no visual hierarchy');
   assert(popup.getComputedStyle(popup.document.querySelector('header')).backgroundColor==='rgb(255, 255, 255)','page should not turn red');
   for(const [w,r] of [[compact,root()],[expanded,ex()]])assert(w.getComputedStyle(r.querySelector('.request-message')).color==='rgb(248, 250, 252)','overlay body color');
 });
 await test('长标题与正文自然换行，不产生卡片横向溢出',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({long:true});
   for(const card of pop('requestNoticeDetails').querySelectorAll('.request-item'))assert(card.scrollWidth<=card.clientWidth+1,'popup overflow');
   for(const r of [root(),ex()])for(const card of r.querySelectorAll('.request-item'))assert(card.scrollWidth<=card.clientWidth+1,'overlay overflow');
   for(const w of [popup,compact,expanded])await w.fixtureSet({long:false,multi:false});
 });
 await test('小栏只展示末条，弹窗保留已取得的多条正文',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:true,preview:true,history:true,multi:false});
   const body=pop('requestNoticeDetails').textContent;
   assert(body.includes('第一条')&&body.includes('第二条')&&body.includes('第三条'),'popup history missing');
   assert(root().querySelector('.request-reason').textContent.includes('第三条'),'compact not latest');
   assert(!root().querySelector('.request-reason').textContent.includes('第一条'),'compact overcrowded');
   for(const r of [root(),ex()])assert(r.querySelectorAll('.request-message').length===1,'overlay must show latest only');
   for(const w of [popup,compact,expanded])await w.fixtureSet({history:false});
 });
 await test('关键安全提醒与导航按钮具有明确高对比度',()=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
   const luminance=s=>rgb(s).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const contrast=(w,e)=>{const c=w.getComputedStyle(e),a=luminance(c.color),b=luminance(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
   assert(contrast(popup,pop('requestNoticeAdvice'))>=7,'popup caution contrast below 7');
   for(const [w,r] of [[compact,root()],[expanded,ex()]]){
     assert(contrast(w,r.querySelector('.notice-warning>.safety-advice'))>=7,'overlay caution contrast');
     for(const b of r.querySelectorAll('.actions button:not([hidden])'))assert(contrast(w,b)>=4.5,'navigation text/background contrast');
   }
 });
 await test('安全提醒位于正文之前，底部导航固定在可见区域',()=>{
   assert(pop('requestNoticeAdvice').getBoundingClientRect().top<pop('requestNoticeDetails').getBoundingClientRect().top,'caution buried below messages');
   const panel=ex().querySelector('.details'),actions=ex().querySelector('.actions');
   assert(actions.getBoundingClientRect().bottom<=panel.getBoundingClientRect().bottom+1,'navigation below panel');
   assert(actions.getBoundingClientRect().bottom<=expanded.innerHeight,'navigation outside window');
 });
 await test('已查看本次界面提醒后恢复简洁',async()=>{
   for(const w of [popup,compact,expanded])await w.fixtureSet({notice:false,pending:0});
   assert(!visible(pop('requestNotice'))&&!popup.document.body.classList.contains('has-request-notice'),'stale popup notice');
   for(const r of [root(),ex()])assert(!r.querySelector('.shell').classList.contains('notice-alert')&&!visible(r.querySelector('.notice-warning')),'stale overlay notice');
 });
 for(const w of [popup,compact,expanded])await w.fixtureSet({fail:false,risk:'IMPERSONATION_CONTACT',pending:1,ordinary:0,mode:'always',wrongAccount:false,notice:false,preview:false});
 document.getElementById('summary').textContent=`${results.filter(r=>r.ok).length}/${results.length} display tests passed`;
 window.surfaceTestResults=results;
})().catch(e=>document.getElementById('summary').textContent='FAILED: '+e.message);
