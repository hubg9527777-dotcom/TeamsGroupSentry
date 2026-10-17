(async()=>{
 const outcomes=[],fixture=document.getElementById('fixtures');
 const assert=(v,msg='assertion failed')=>{if(!v)throw Error(msg);};
 async function test(name,fn){try{await fn();outcomes.push({name,ok:true});}catch(e){outcomes.push({name,ok:false,error:e.message});}
   const li=document.createElement('li');li.textContent=(outcomes.at(-1).ok?'PASS ':'FAIL ')+name+(outcomes.at(-1).error?' — '+outcomes.at(-1).error:'');li.className=outcomes.at(-1).ok?'pass':'fail';document.getElementById('results').append(li);}
 // Test origin's databases only. NEVER run against Teams or the extension origin.
 if(!['127.0.0.1','localhost'].includes(location.hostname))throw Error('Tests require localhost');
 for(const name of ['teams-group-sentry-v3','teams-group-sentry-recovery-v1'])await new Promise((res,rej)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=res;r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('close prior test tab'));});
 let testWorker=new Worker('browser-worker.js');
 const call=action=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),10000);testWorker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};testWorker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};testWorker.postMessage({action});});
 const okCall=async action=>{const r=await call(action);assert(r.ok,r.error);return r.result;};
 await test('Native IndexedDB: 初始化、升级保护与账号绑定',()=>okCall('setup'));
 await test('Native IndexedDB: 请求观察不插入人员',async()=>{await okCall('observe');const r=await okCall('snapshot');assert(r.people.length===0);assert(r.events.filter(e=>e.type==='CONTACT_REQUEST').length===1);});
 await test('Native IndexedDB: 重复观察只保留一个提醒',async()=>{await okCall('observe');const r=await okCall('snapshot');assert(r.events.length===1);assert(r.state.counts.requests.pending===1);});
 await test('Native IndexedDB: worker 重启、session 消失后报警保留',async()=>{testWorker.terminate();testWorker=new Worker('browser-worker.js');const r=await okCall('snapshot');assert(r.state.counts.requests.pending===1);assert(r.events[0].firstSeenUnknown);});
 await test('Native IndexedDB: 错误 ID 核实不改变数据',async()=>{const r=await call('invalid-review');assert(!r.ok);const s=await okCall('snapshot');assert(s.people.length===0);assert(s.events[0].status==='OPEN');});
 await test('Native IndexedDB: 单个完整 ID 核实、审计与去重',async()=>{await okCall('verify');await okCall('observe');const s=await okCall('snapshot');assert(s.people[0].status==='APPROVED');assert(s.state.counts.requests.pending===0);assert(s.events.some(e=>e.type==='CONTACT_REQUEST_REVIEWED'));});
 await test('Native IndexedDB: A/B 请求和信任分区隔离',async()=>{const r=await okCall('partition');assert(r[0].risk==='STRANGER');assert(r[0].status==='OPEN');});
 await test('Native IndexedDB: 原群成员陌生 ID 报警',async()=>{const r=await okCall('group');assert(r.unknown===2);const s=await okCall('snapshot');assert(s.events.filter(e=>e.type==='FIRST_SEEN_ID').length===2);});
 await test('Native IndexedDB: 恢复点包含请求和审核事件',async()=>{const r=await okCall('checkpoint');assert(r.ok);assert(r.missing===0);});
 function panel(extra='',identity='<span data-mri="8:live:synthetic">张三</span>',heading='好友请求'){
   fixture.innerHTML=`<section role="region" aria-label="${heading}" ${extra}><h2>${heading}</h2>${identity}<button>接受</button><button>拒绝</button></section>`;}
 await test('Real DOM: 可见请求标题、控件与唯一显式 ID',()=>{panel();const r=TGSRequestUI.inspect(document);assert(r.observations.length===1);assert(r.observations[0].personId==='8:live:synthetic');assert(r.observations[0].kind==='CONTACT');});
 await test('Real DOM: 隐藏请求不能当作新请求',()=>{panel('hidden');assert(TGSRequestUI.inspect(document).observations.length===0);});
 await test('Real DOM: 普通聊天、陌生 ID 和群成员不等于好友请求',()=>{panel('','<span data-mri="8:live:stranger">张三</span>','群成员');assert(TGSRequestUI.inspect(document).observations.length===0);});
 await test('Real DOM: 缺失/冲突 ID 留为证据不足',()=>{panel('','<span>张三</span>');assert(TGSRequestUI.inspect(document).observations[0].personId==='');panel('','<span data-mri="8:a">张三</span><span data-mri="8:b">李四</span>');assert(TGSRequestUI.inspect(document).observations[0].personId==='');});
 await test('Real DOM: 普通消息中的请求文字不触发',()=>{fixture.innerHTML='<section><div>好友请求</div><span data-mri="8:a">张三</span><button>接受</button><button>拒绝</button></section>';assert(TGSRequestUI.inspect(document).observations.length===0);});
 await test('Real DOM: 邀请标题与控件必须在同一界面区域',()=>{fixture.innerHTML='<section aria-label="好友请求"><h2>好友请求</h2><section><span data-mri="8:a">张三</span><button>接受</button><button>拒绝</button></section></section>';assert(TGSRequestUI.inspect(document).observations.length===0);});
 await test('Real DOM: 通用聊天请求不直接认定为好友请求',()=>{panel('','<span data-mri="8:a">张三</span>','Chat request');assert(TGSRequestUI.inspect(document).observations[0].kind==='CHAT');});
 const realList=(rows=1,extra='')=>{fixture.innerHTML=`<div role="treeitem" data-testid="list-item-REQUESTS">请求${extra}</div>
   <div role="treegrid" aria-label="请求" data-testid="message-slice-list-vl2-viewport">${Array.from({length:rows},(_,i)=>`<div role="row" data-testid="message-slice-card-requests" id="message-slice-card-requests-RequestsSliceCardItem|19:meeting_synthetic${i}@thread.v2"><span data-tid="message-slice-card-title">虚构会议，不是发送者姓名</span></div>`).join('')}</div>`;};
 await test('Real DOM: 已核对的请求列表结构可发现会议邀请，绝不输出发送者 ID/姓名',()=>{realList();const s=TGSRequestUI.inspectSignal(document);assert(s.observed&&s.count===1&&s.meeting);assert(s.source==='VISIBLE_ROWS');assert(s.personId===undefined&&s.name===undefined);});
 await test('Real DOM: 无需进入请求列表，入口可见徽标变化即可提示',()=>{realList(0,'<span class="fui-TreeItemLayout__aside" aria-hidden="true">3</span>');const s=TGSRequestUI.inspectSignal(document);assert(s.observed&&s.count===3&&s.source==='BADGE');});
 await test('Real DOM: 徽标与可见行不累加，不把可见行数当成完整总数',()=>{realList(1,'<span class="fui-TreeItemLayout__aside" aria-hidden="true">7</span>');assert(TGSRequestUI.inspectSignal(document).count===7);realList(2);assert(TGSRequestUI.inspectSignal(document).source==='VISIBLE_ROWS');});
 await test('Real DOM: 空入口、普通聊天文字、隐藏行都不能制造新请求',()=>{realList(0);assert(!TGSRequestUI.inspectSignal(document).observed);fixture.insertAdjacentHTML('beforeend','<p>请求 9 王六 好友请求</p>');assert(!TGSRequestUI.inspectSignal(document).observed);realList();fixture.querySelector('[role="treegrid"]').hidden=true;assert(!TGSRequestUI.inspectSignal(document).observed);});
 await test('Real DOM: 普通聊天列表中的类似请求行不能冒充请求列表',()=>{realList();fixture.querySelector('[role="treegrid"]').setAttribute('aria-label','聊天');assert(!TGSRequestUI.inspectSignal(document).observed);});
 await test('Real DOM: 原生接受/阻止面板独立提示但不读取消息或执行操作',()=>{fixture.innerHTML='<div data-tid="accept-block-container"><h2 data-test-id="regular-block-title">虚构请求标题</h2><button>接受</button><button>阻止</button></div>';let clicked=0;fixture.addEventListener('click',()=>clicked++);const s=TGSRequestUI.inspectSignal(document);assert(s.source==='PANEL'&&s.count===null&&s.observed);assert(clicked===0);});

 function previewFixture({meeting=false,preview=false,selected=true,official=true,other=false,hidden=false}={}){
  const title=meeting?'测试会议':'王六';
  fixture.innerHTML=`<div role="treegrid" aria-label="请求" data-testid="message-slice-list-vl2-viewport"><div role="row" data-testid="message-slice-card-requests" aria-selected="${selected}" id="message-slice-card-requests-RequestsSliceCardItem|19:${meeting?'meeting_':''}test@thread.v2"><div role="gridcell"></div><div role="gridcell">${title}</div><div role="gridcell">12:30</div></div></div>
   <main><h2>${title}</h2><div data-tid="message-pane-list-runway" ${hidden?'hidden':''}><div data-tid="chat-pane-item"><span id="author-123" data-tid="message-author-name">${other?'李四':meeting?'已停用帐户':'王六'}</span><div data-tid="chat-pane-message" aria-labelledby="content-123 author-123"><div id="content-123">你好 &lt;img src=x onerror=alert(1)&gt; https://example.invalid</div></div></div></div>
   ${official?`<div id="vertical-flex"><div>${meeting?'已停用帐户 已将你添加到会议聊天':'王六 想和你聊天'}</div><div>来自未知人员的消息可能是钓鱼攻击</div>${preview?'<button>预览他们的消息。</button>':''}<button data-tid="accept-chat-narrow">接受</button><button data-tid="block-chat-narrow">阻止</button></div>`:''}</main>`;
 }
 await test('请求详情：列表姓名可见，会议名称始终标为会议',()=>{previewFixture({meeting:true,preview:true});const d=TGSRequestUI.inspectSignal(document).details[0];assert(d.kind==='MEETING'&&d.title==='测试会议'&&d.name==='已停用帐户');assert(!d.messages.length);});
 await test('请求详情：预览后的单人姓名和正文同时读取，不点击任何控件',()=>{previewFixture();let clicks=0;const listener=()=>clicks++;fixture.addEventListener('click',listener);const d=TGSRequestUI.inspectSignal(document).details[0];fixture.removeEventListener('click',listener);assert(d.name==='王六'&&d.messages[0].author==='王六');assert(d.messages[0].text.includes('<img'));assert(clicks===0);});
 await test('请求详情：预览前不能读取仍在页面中的旧正文',()=>{previewFixture({preview:true});const d=TGSRequestUI.inspectSignal(document).details[0];assert(d.name==='王六'&&d.previewAvailable&&!d.messages.length);});
 await test('请求详情：普通聊天没有官方请求保护区时不抓取正文',()=>{previewFixture({official:false});const d=TGSRequestUI.inspectSignal(document).details[0];assert(!d.name&&!d.messages.length);});
 await test('请求详情：未选中或重复选中不能将正文归属给请求',()=>{previewFixture({selected:false});assert(!TGSRequestUI.inspectSignal(document).details[0].messages.length);previewFixture();const row=fixture.querySelector('[role=row]');row.after(row.cloneNode(true));assert(TGSRequestUI.inspectSignal(document).details.every(d=>!d.messages.length));});
 await test('请求详情：单人请求姓名与正文作者不一致时不混入消息',()=>{previewFixture({other:true});assert(!TGSRequestUI.inspectSignal(document).details[0].messages.length);});
 await test('请求详情：会议消息保留各自作者，不归属于邀请人',()=>{previewFixture({meeting:true,other:true});const d=TGSRequestUI.inspectSignal(document).details[0];assert(d.name==='已停用帐户'&&d.messages[0].author==='李四');});
 await test('请求详情：隐藏正文和不属于该预览的正文一律不读取',()=>{previewFixture({hidden:true});assert(!TGSRequestUI.inspectSignal(document).details[0].messages.length);previewFixture();document.body.append(fixture.querySelector('[data-tid="message-pane-list-runway"]'));assert(!TGSRequestUI.inspectSignal(document).details[0].messages.length);document.body.lastElementChild.remove();});
 await test('请求详情：姓名变化中的异步页面不混淆两个请求',()=>{previewFixture();fixture.querySelector('[role=gridcell]:nth-child(2)').textContent='张三';assert(!TGSRequestUI.inspectSignal(document).details[0].messages.length);});
 await test('请求详情：正文保留最多十条，每条限制长度，去掉方向控制符',()=>{previewFixture();const list=fixture.querySelector('[data-tid="message-pane-list-runway"]');for(let i=124;i<127;i++)list.insertAdjacentHTML('beforeend',`<span data-tid="message-author-name" id="author-${i}">王六</span><div data-tid="chat-pane-message" aria-labelledby="content-${i} author-${i}"><div id="content-${i}">${'x'.repeat(350)}\u202e</div></div>`);const d=TGSRequestUI.inspectSignal(document).details[0];assert(d.messages.length===4&&d.messages.slice(1).every(m=>m.text.length===300&&!m.text.includes('\u202e')));});
 fixture.replaceChildren();testWorker.terminate();
 globalThis.testResults={total:outcomes.length,passed:outcomes.filter(x=>x.ok).length,outcomes};
 document.getElementById('summary').textContent=`${testResults.passed}/${testResults.total} passed`;
})().catch(e=>document.getElementById('summary').textContent='FAILED: '+e.message);
