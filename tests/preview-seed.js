(async()=>{
 const previewWorker=new Worker('browser-worker.js');
 const pending=[];let processing=false;
 async function request(data){return new Promise((resolve,reject)=>{pending.push({data,resolve,reject});pump();});}
 function pump(){if(processing||!pending.length)return;processing=true;const item=pending.shift();previewWorker.onmessage=e=>{
   processing=false;if(e.data.ok)item.resolve(e.data.result);else item.reject(Error(e.data.error));pump();};previewWorker.postMessage(item.data);}
 await request({action:'demo'});
 globalThis.chrome={runtime:{sendMessage:msg=>request({action:'api',message:msg})},tabs:{create:async()=>({})}};
 const script=document.createElement('script');script.src='../ui/dashboard.js';document.body.append(script);
})().catch(e=>{document.getElementById('systemWarning').textContent=e.message;document.getElementById('systemWarning').style.display='block';});
