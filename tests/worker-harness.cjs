const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
function database(){
 const tables=Object.fromEntries(['groups','people','edges','events','policies','meta'].map(s=>[s,new Map()]));
 const clone=v=>v===undefined?undefined:structuredClone(v);
 const store=name=>({
   get:key=>clone(tables[name].get(key)),
   put:row=>{const key=name==='policies'?row.account:row.pk;tables[name].set(key,clone(row));return key;},
   add:row=>{const key=name==='policies'?row.account:row.pk;if(tables[name].has(key))throw Error('duplicate');tables[name].set(key,clone(row));},
   delete:key=>tables[name].delete(key),getAll:()=>[...tables[name].values()].map(clone),getAllKeys:()=>[...tables[name].keys()],
   index:key=>({getAll:value=>[...tables[name].values()].filter(r=>JSON.stringify(key==='byPerson'?[r.account,r.personId]:key==='byGroup'?[r.account,r.groupId]:r.account)===JSON.stringify(value)).map(clone)})
 });
 const db={tables,pk:(a,id)=>JSON.stringify([a,id]),open:async()=>{},request:async r=>r,
   getAllFor:async(s,a)=>store(s).index('account').getAll(a),getAll:async s=>store(s).getAll(),
   getMeta:async key=>store('meta').get(key),putMeta:async row=>store('meta').put(row),
   getPolicy:async a=>({account:a,aaEnabled:false,notifyUnknown:true,notifyKnownTransfers:true,sound:false}),
   transaction:async(names,mode,fn)=>{const before=mode==='readwrite'?clone(tables):null;
     try{return await fn({objectStore:store});}catch(e){if(before)for(const s of names)tables[s]=before[s];throw e;}}
 };return db;
}
function worker(db=database()){
 const listeners={},local={},session={},notices=[],badge={};
 const storage=data=>({get:async key=>({[key]:structuredClone(data[key])}),set:async row=>Object.assign(data,structuredClone(row)),setAccessLevel:async()=>{}});
 const event=name=>({addListener:fn=>listeners[name]=fn});
 const chrome={runtime:{id:'unit',getURL:s=>'chrome-extension://unit/'+s.replace(/^\//,''),onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup'),sendMessage:async()=>({ok:true})},
 storage:{local:storage(local),session:storage(session)},alarms:{onAlarm:event('alarm'),get:async()=>true,create:async()=>{}},
 notifications:{onClicked:event('notification'),create:async(id,opts)=>notices.push({id,...opts})},
 action:{setBadgeBackgroundColor:async v=>badge.color=v.color,setBadgeText:async v=>badge.text=v.text,setTitle:async v=>badge.title=v.title},
 tabs:{query:async()=>[],sendMessage:async()=>({ok:true}),create:async v=>v,update:async()=>{}},windows:{update:async()=>{}},offscreen:{hasDocument:async()=>true}};
 let context;
 context=vm.createContext({console,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,structuredClone,setTimeout,clearTimeout,navigator:{},chrome,
 importScripts:(...files)=>{for(const file of files){if(file==='lib/db.js'){context.TGSDB=db;continue;}
   vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});}}
 });
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
 return {context,db,chrome,session,notices,badge,listeners,
   run:code=>vm.runInContext(code,context),
   message:(msg,sender={id:'unit',url:'chrome-extension://unit/ui/dashboard.html',frameId:0})=>new Promise(resolve=>{
     if(listeners.message(msg,sender,resolve)!==true)resolve(undefined);
   })};
}
module.exports={database,worker,root};
