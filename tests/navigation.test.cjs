const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {root}=require('./worker-harness.cjs');
const L=require('../lib/logic.js');
function content({rendered=[],lookup={ok:true,chatId:'19:direct@thread.v2'}}={}){
 let handler,clicks=[];const nodes=new Map(rendered.map(id=>[id,{isConnected:true,getClientRects:()=>[{}],click:()=>clicks.push(id)}]));
 const window={addEventListener(){},postMessage(){}};window.top=window;
 const document={visibilityState:'visible',hasFocus:()=>true,addEventListener(){},getElementById:id=>nodes.get(id.replace('title-chat-list-item_','')),querySelectorAll:()=>[]};
 const context=vm.createContext({window,document,location:{origin:'https://teams.live.com'},crypto:require('node:crypto').webcrypto,TGSLogic:L,TGSIsolatedReader:{findDirectChat:async()=>lookup},
 setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,MutationObserver:class{observe(){}},chrome:{runtime:{onMessage:{addListener:fn=>handler=fn},sendMessage:async()=>({ok:true})}}});
 vm.runInContext(fs.readFileSync(path.join(root,'content.js'),'utf8'),context);
 return {clicks,navigate:msg=>new Promise(resolve=>handler({action:'NAVIGATE_TEAMS_CHAT',...msg},{},resolve))};
}
test('原群聊跳转按精确群 ID，不能按同名选择其他群',async()=>{const c=content({rendered:['19:correct@thread.v2','19:other@thread.v2']});const r=await c.navigate({kind:'group',chatId:'19:correct@thread.v2'});assert.equal(r.opened,true);assert.deepEqual(c.clicks,['19:correct@thread.v2']);});
test('原个人聊天跳转只打开经精确双方 ID 核对的已有会话',async()=>{const c=content({rendered:['19:direct@thread.v2']});const r=await c.navigate({kind:'person',personId:'8:a',selfId:'8:self'});assert.equal(r.opened,true);assert.deepEqual(c.clicks,['19:direct@thread.v2']);});
test('手选会话不属于该联系人时拒绝跳转',async()=>{const c=content({rendered:['19:wrong@thread.v2']});const r=await c.navigate({kind:'person',personId:'8:a',selfId:'8:self',chatId:'19:wrong@thread.v2'});assert.equal(r.code,'INVALID_CHAT_SELECTION');assert.equal(c.clicks.length,0);});
test('双人群或缓存不完整时不自动点击姓名结果',async()=>{const c=content({lookup:{ok:false,code:'UNVERIFIED_CHAT_TYPE'},rendered:['19:group@thread.v2']});const r=await c.navigate({kind:'person',personId:'8:a',selfId:'8:self',searchText:''});assert.equal(r.code,'NO_SEARCH_NAME');assert.equal(c.clicks.length,0);});
test('原混合增减名单保持不确定状态，不能认定确定加入',()=>{const r=L.classifyChange(['8:a','8:b'],['8:a','8:c']);assert.equal(r.kind,'AMBIGUOUS_REPLACEMENT');assert.deepEqual(r.added,['8:c']);});
test('原群成员名不能按群标题姓名顺序猜测 ID',()=>{const r=L.parseRecord({id:'19:g@thread.v2',isGroup:true,longTitle:'张三、李四',members:[{id:'8:a'},{id:'8:b'}]});assert.equal(r.members[0].name,'');assert.deepEqual(r.titleNameHints,['张三','李四']);});
test('原 AA 名称特征不会自动批准陌生身份',()=>{assert.equal(L.isCompanyCandidate('AA王五',{aaEnabled:true,aaPrefixes:['AA']}),true);assert.equal(L.alertLevel({status:'NEW',companyCandidate:true,level:'STANDARD'},{}),'HIGH');});
