(async()=>{
 if(location.hostname!=='127.0.0.1')throw Error('localhost only');
 const results=[],assert=(v,m='assertion failed')=>{if(!v)throw Error(m);};
 async function test(name,fn){try{await fn();results.push({ok:true,name});}catch(e){results.push({ok:false,name,error:e.message});}
   const li=document.createElement('li');li.className=results.at(-1).ok?'pass':'fail';li.textContent=(results.at(-1).ok?'PASS ':'FAIL ')+name+(results.at(-1).error?' — '+results.at(-1).error:'');document.getElementById('results').append(li);}
 for(const name of ['teams-group-sentry-v3','teams-group-sentry-recovery-v1'])await new Promise((res,rej)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=res;r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('close prior test tab'));});
 let worker=new Worker('browser-worker.js');
 const call=action=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),10000);worker.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve(e.data.result):reject(Error(e.data.error));};worker.postMessage({action});});
 await test('原生 IndexedDB：一群首次提供人工确认，不创建身份基线',async()=>{const r=await call('small-offer');assert(r.firstSetup&&r.smallSetup&&r.canBind);assert(r.selfCandidates.length===2);});
 await test('原生 IndexedDB：核对完整 ID 和尾号后建立单群基线',async()=>{const r=await call('small-bind');assert(r.ok&&!r.readOnly&&r.scanned===1);});
 await test('原生 IndexedDB：worker/session 重建后继续监控，无需重新确认',async()=>{worker.terminate();worker=new Worker('browser-worker.js');const r=await call('small-resume');assert(r.ok&&!r.readOnly);});
 await test('原生 IndexedDB：单群新增陌生 ID 仍产生原报警',async()=>{const r=await call('small-growth');assert(r.unknown===1&&!r.readOnly);});
 worker.terminate();
 const frame=document.getElementById('popup');
 if(!frame.contentWindow.fixtureReady)await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
 const p=frame.contentWindow;await p.fixtureReady;p.confirm=()=>true;
 const by=id=>p.document.getElementById(id),visible=e=>!!e&&e.getClientRects().length>0;
 const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>requestAnimationFrame(resolve));};
 await test('真实弹窗代码：一群显示绑定入口和核对说明，不预选本人',()=>{assert(visible(by('identityAction'))&&visible(by('smallSetupFields')));assert(by('setupSelfSelect').value==='');assert(by('smallSetupFields').textContent.includes('不能仅凭群名单识别本人'));});
 await test('真实弹窗代码：未选择本人不能提交绑定',async()=>{by('bindCurrent').click();await settle();assert(!p.fixtureCalls.some(c=>c.action==='BIND_CURRENT'));assert(by('scanFeedback').textContent.includes('本人 ID'));});
 await test('真实弹窗代码：选中后展示完整 ID，错误尾号不提交',async()=>{by('setupSelfSelect').value='8:live:self123456';by('setupSelfSelect').dispatchEvent(new p.Event('change'));by('setupSelfSuffix').value='wrong';by('bindCurrent').click();await settle();assert(by('setupSelfChosen').textContent==='8:live:self123456');assert(!p.fixtureCalls.some(c=>c.action==='BIND_CURRENT'));});
 await test('真实弹窗代码：明确确认后传递精确 ID、尾号和人工确认标志',async()=>{by('setupSelfSuffix').value='123456';by('bindCurrent').click();await settle();const c=p.fixtureCalls.find(c=>c.action==='BIND_CURRENT');assert(c&&c.selfId==='8:live:self123456'&&c.last6==='123456'&&c.smallConfirmed===true);});
 document.getElementById('summary').textContent=`${results.filter(r=>r.ok).length}/${results.length} small binding tests passed`;
})().catch(e=>document.getElementById('summary').textContent='FAILED: '+e.message);
