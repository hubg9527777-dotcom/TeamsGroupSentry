(async()=>{
 if(location.hostname!=='127.0.0.1')throw Error('localhost only');
 const results=[],assert=(v,m='assertion failed')=>{if(!v)throw Error(m);};
 async function test(name,fn){try{await fn();results.push({ok:true,name});}catch(e){results.push({ok:false,name,error:e.message});}const li=document.createElement('li');li.className=results.at(-1).ok?'pass':'fail';li.textContent=(results.at(-1).ok?'PASS ':'FAIL ')+name+(results.at(-1).error?' — '+results.at(-1).error:'');document.getElementById('results').append(li);}
 const w=new Worker('self-lookup-worker.js');
 const call=action=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),15000);w.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve(e.data.result):reject(Error(e.data.error));};w.postMessage({action});});
 let first;
 await test('真实读取器：同名人员各自补全姓名，不合并 ID',async()=>{first=await call('seed');assert(first.data.nameHints.length===2);assert(new Set(first.data.nameHints.map(x=>x.id)).size===2);assert(first.data.nameHints.every(x=>x.name==='同名测试人'));});
 await test('真实读取器：三类一致的明确线索汇总为单个候选，不改变 accountHint',()=>{assert(first.recommendation.personId==='8:live:self123456');assert(first.recommendation.sources.length===3);assert(first.data.accountHint==='');});
 await test('真实读取器：不访问凭据存储，不输出消息正文或 Token',()=>{assert(!first.reads.some(n=>/auth|token/i.test(n)));const s=JSON.stringify(first.data);assert(!s.includes('SYNTHETIC_BODY')&&!s.includes('SYNTHETIC_SECRET'));});
 await test('真实读取器：本人标记冲突时不推荐任何 ID',async()=>{const r=await call('conflict');assert(r.recommendation.status==='CONFLICT');assert(!r.recommendation.personId);});
 await test('真实读取器：多个会话缓存时停止推荐',async()=>{const r=await call('multiple');assert(r.recommendation.status==='UNAVAILABLE');});
 w.terminate();
 for(const name of ['teams-group-sentry-v3','teams-group-sentry-recovery-v1'])await new Promise((res,rej)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=res;r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('close prior test tab'));});
 const background=new Worker('browser-worker.js');
 const native=action=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('background timeout')),15000);background.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve(e.data.result):reject(Error(e.data.error));};background.postMessage({action});});
 await test('原生后台：只读首次绑定补全姓名并给出唯一候选，不自动写基线',async()=>{const r=await native('small-auto-offer');assert(r.firstSetup&&r.selfSuggestion.personId==='8:live:self123456');assert(r.selfCandidates[0].name==='资料补全本人（虚构）');});
 await test('原生后台：人工确认推荐 ID 后才建立基线',async()=>{const r=await native('small-bind');assert(r.ok&&!r.readOnly&&r.scanned===1);});
 background.terminate();
 const f=document.getElementById('popup');if(!f.contentWindow.fixtureReady)await new Promise(resolve=>f.addEventListener('load',resolve,{once:true}));const p=f.contentWindow;await p.fixtureReady;
 await test('真实弹窗：自动展示唯一候选姓名、完整 ID 及证据，手动名单默认收起',()=>{const d=p.document;assert(d.getElementById('selfSuggestionTitle').textContent.includes('请你确认'));assert(d.getElementById('selfSuggestionReason').textContent.includes('8:live:self123456'));assert(d.getElementById('setupSelfSelect').value==='8:live:self123456');assert(!d.getElementById('manualSelfCandidates').open);assert(!p.fixtureCalls.some(c=>c.action==='BIND_CURRENT'));});
 await test('真实弹窗：自动推荐也不能跳过尾号与本人确认',async()=>{p.document.getElementById('bindCurrent').click();for(let i=0;i<4;i++)await new Promise(resolve=>requestAnimationFrame(resolve));assert(!p.fixtureCalls.some(c=>c.action==='BIND_CURRENT'));assert(p.document.getElementById('scanFeedback').textContent.includes('最后 6 位'));});
 await test('真实弹窗：查找按钮只刷新本地线索，不自动绑定',async()=>{p.document.getElementById('findSelfId').click();for(let i=0;i<4;i++)await new Promise(resolve=>requestAnimationFrame(resolve));assert(p.fixtureCalls.some(c=>c.action==='SCAN_NOW'));assert(!p.fixtureCalls.some(c=>c.action==='BIND_CURRENT'));assert(!p.document.getElementById('findSelfId').disabled);});
 await test('真实弹窗：本人线索消失后清除原自动选择，不能沿用旧推荐',async()=>{await p.fixtureSet({lookup:false});assert(p.document.getElementById('setupSelfSelect').value==='');assert(p.document.getElementById('selfSuggestionTitle').textContent.includes('尚未'));await p.fixtureSet({lookup:true});});
 document.getElementById('summary').textContent=`${results.filter(r=>r.ok).length}/${results.length} self lookup tests passed`;
})().catch(e=>document.getElementById('summary').textContent='FAILED: '+e.message);
