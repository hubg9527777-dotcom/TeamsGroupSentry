(async()=>{
 if(location.hostname!=='127.0.0.1')throw Error('localhost only');
 const results=[];const assert=(v,m='assertion failed')=>{if(!v)throw Error(m);};
 const test=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}const li=document.createElement('li');li.textContent=JSON.stringify(results.at(-1));document.querySelector('#results').append(li);};
 const name='Teams:conversation-manager:synthetic-cache-test';
 const fixtureIDB={databases:async()=>(await indexedDB.databases()).filter(d=>d.name===name),open:(...args)=>indexedDB.open(...args)};
 const del=()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=r.onblocked=()=>reject(Error('close prior test'));});
 const seed=async(rows)=>{await del();const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('conversations',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=reject;});await new Promise((resolve,reject)=>{const tx=db.transaction('conversations','readwrite');rows.forEach(r=>tx.objectStore('conversations').put(r));tx.oncomplete=resolve;tx.onerror=reject;});db.close();};
 const row=(extra={})=>({id:'19:synthetic@thread.v2',type:'Chat',memberProperties:{relationshipState:{inQuarantine:true}},members:[{id:'8:synthetic'}],chatTitle:{longTitle:'虚构会议名称'},lastMessage:{id:'100',version:'1',content:'<p>你好，请核实身份</p>',contenttype:'Text',messagetype:'RichText/Html',imdisplayname:'王六',from:'8:synthetic',fromUserId:'8:synthetic',composetime:'2026-10-16T00:00:00Z'},...extra});
 await test('原生 IndexedDB 只读扫描，无请求列表或预览 DOM 也取得摘要',async()=>{await seed([row()]);const r=await TGSRequestCache.scan(fixtureIDB,document);assert(r.status==='OK',r.status+' dbs='+JSON.stringify((await indexedDB.databases()).map(d=>d.name.split(':').slice(0,2).join(':'))));assert(r.details[0].messages[0].text==='你好，请核实身份');assert(r.details[0].name==='');});
 await test('会议作者独立于会议名，不推断邀请者',async()=>{await seed([row({type:'Meeting'})]);const d=(await TGSRequestCache.scan(fixtureIDB,document)).details[0];assert(d.kind==='MEETING'&&d.name===''&&d.messages[0].author==='王六');});
 await test('完整本人 ID 过滤自身消息，回传仅本地抑制键；同名别人仍保留',async()=>{
   await seed([row()]);const own=await TGSRequestCache.scan(fixtureIDB,document,async()=>'8:synthetic');
   assert(own.status==='OK'&&own.details.length===0&&own.selfKeys.length===1);
   const peer=await TGSRequestCache.scan(fixtureIDB,document,async()=>'8:different');
   assert(peer.details.length===1&&peer.details[0].messages[0].author==='王六');
 });
 await test('真实空请求 DOM 加历史隔离缓存，不产生当前请求警示',async()=>{
   await seed([row()]);const cache=await TGSRequestCache.scan(fixtureIDB,document);
   const snapshot=TGSRequestUI.inspectSignal(document),merged=TGSRequestCache.supplement(snapshot,cache.details,new Map());
   assert(!merged.observed&&!merged.details.length);
   assert(!TGSRequestNotice.view({source:'CACHE',pending:true,visible:true,details:cache.details}).pending);
 });
 await test('真实可见请求行只关联同一会话，其他缓存不展示',async()=>{
   await seed([row()]);const cache=await TGSRequestCache.scan(fixtureIDB,document);
   const fixture=document.createElement('div');fixture.innerHTML='<div role="treegrid" aria-label="请求" data-testid="message-slice-list-vl2-viewport"><div role="row" data-testid="message-slice-card-requests" id="message-slice-card-requests-RequestsSliceCardItem|19:synthetic@thread.v2"><div role="gridcell">王六</div></div></div>';document.body.append(fixture);
   const merged=TGSRequestCache.supplement(TGSRequestUI.inspectSignal(document),[...cache.details,{...cache.details[0],key:'old-cache'}],new Map());
   assert(merged.observed&&merged.details.length===1&&merged.details[0].messages.length===1);fixture.remove();
 });
 await test('定向读取当前请求，不被前二十条历史缓存挤掉正文',async()=>{
   const target=row({id:'19:zz-current@thread.v2'});
   await seed([...Array.from({length:22},(_,i)=>row({id:'19:old'+i+'@thread.v2'})),target]);
   const key='message-slice-card-requests-RequestsSliceCardItem|'+target.id;
   const result=await TGSRequestCache.scan(fixtureIDB,document,undefined,[key]);
   assert(result.status==='OK'&&result.details.length===1&&result.details[0].key===key&&result.details[0].messages.length===1);
 });
 await test('HTML 转为文字，脚本媒体链接不执行不加载',()=>{window.cacheAttack=0;const text=TGSRequestCache.plain('<script>window.cacheAttack=1</script><img src="http://127.0.0.1:1/never" onerror="window.cacheAttack=2"><a href="https://example.invalid">查看</a><style>body{display:none}</style>',document);assert(text==='查看');assert(window.cacheAttack===0);assert(TGSRequestCache.plain('<p>第一段</p><p>第二段</p>',document)==='第一段 第二段');});
 await test('普通会话不会提示，缓存正文缺失也保留请求',async()=>{await seed([row({lastMessage:null}),row({id:'19:ordinary@thread.v2',memberProperties:{}})]);const r=await TGSRequestCache.scan(fixtureIDB,document);assert(r.details.length===1&&r.details[0].messages.length===0);});
 await test('重复扫描相同，末条消息 ID 改变则修订改变',async()=>{await seed([row()]);const a=(await TGSRequestCache.scan(fixtureIDB,document)).details[0];const b=(await TGSRequestCache.scan(fixtureIDB,document)).details[0];assert(JSON.stringify(a)===JSON.stringify(b));const changed=row();changed.lastMessage.id='101';await seed([changed]);const c=(await TGSRequestCache.scan(fixtureIDB,document)).details[0];assert(a.messageRevision!==c.messageRevision);});
 await test('多账号缓存拒绝读取正文',async()=>{const fake={databases:async()=>[{name},{name:name+'-B'}],open(){throw Error('must not read');}};const r=await TGSRequestCache.scan(fake,document);assert(r.status==='AMBIGUOUS_SCOPE'&&!r.details.length);});
 await test('枚举超时有界退出，迟到连接关闭',async()=>{const r=await TGSRequestCache.scan({databases:()=>new Promise(()=>{})},document);assert(r.status==='UNAVAILABLE');});
 await test('请求超过显示限额仍提醒，最多保留 20 条',async()=>{await seed(Array.from({length:21},(_,i)=>row({id:'19:synthetic'+i+'@thread.v2'})));const r=await TGSRequestCache.scan(fixtureIDB,document);assert(r.status==='OK'&&r.details.length===20);});
 await del();window.testResults=results;document.querySelector('#summary').textContent=`${results.filter(x=>x.ok).length}/${results.length} passed`;
})();
