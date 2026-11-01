const {test}=require('node:test'),assert=require('node:assert/strict');
const UI=require('../lib/membership-ui.js');
const GROUP='19:team-test@thread.v2';
function element({id='',role='',label='',text=label,parent=null,visible=true,selected=false,testid=''}={}){
  const o={id,parentElement:parent,isConnected:true,innerText:text,textContent:text,
    getClientRects:()=>visible?[{width:1}]:[],getAttribute:key=>({role,'aria-label':label,
      'data-testid':testid,'aria-selected':selected?'true':null})[key]||null};
  o.closest=selector=>{
    for(let e=o;e;e=e.parentElement){if(selector.includes('[role="dialog"]')&&['dialog','alertdialog'].includes(e.getAttribute('role')))return e;
      if(selector.includes('[role="menu"]')&&e.getAttribute('role')==='menu')return e;
      if(selector.includes('[role="menuitem"]')&&e.getAttribute('role')==='menuitem')return e;
      if(selector.includes('button')&&e.getAttribute('role')==='button')return e;}
    return null;
  };return o;
}
function fixture(){
  const listeners={},timers=[],messages=[],rows=[],alerts=[];
  const doc={addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:()=>{},
    querySelectorAll:selector=>selector.startsWith('[id^=')?rows:alerts};
  let t=100000;
  UI.start(doc,d=>messages.push(d),{now:()=>t,later:fn=>(timers.push(fn),fn),cancel:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},settleMs:3000});
  const click=(target,trust=true)=>listeners.click({target,isTrusted:trust});
  const context=(target,trust=true)=>listeners.contextmenu({target,isTrusted:trust});
  const complete=()=>{for(const f of timers.splice(0))f();};
  const row=element({id:'title-chat-list-item_'+GROUP});rows.push(row);
  const menu=element({role:'menu'}),leave=element({role:'menuitem',label:'退出群聊',parent:menu});
  const dialog=element({role:'dialog',text:'确定退出群聊？'});
  const confirm=element({role:'button',label:'退出',parent:dialog});
  return {click,context,complete,rows,alerts,messages,row,leave,dialog,confirm,
    setTime:v=>t=v,withSelected:()=>{rows[0]=element({id:'title-chat-list-item_'+GROUP,selected:true});},
    build:element};
}
test('先打开指定群菜单再确认退群，窗口消失后仅回报精确会话ID',()=>{
  const x=fixture();x.context(x.row);x.click(x.leave);x.click(x.confirm);
  assert.equal(x.messages.length,0);
  x.dialog.isConnected=false;x.complete();
  assert.equal(x.messages.length,1);
  assert.equal(x.messages[0].chatId,GROUP);
  assert.equal(x.messages[0].evidence,'DIALOG_DISMISSED_AFTER_CONFIRM');
});
test('只点击菜单但取消确认，绝不扣除群组',()=>{
  const x=fixture();x.context(x.row);x.click(x.leave);x.dialog.isConnected=false;x.complete();
  assert.equal(x.messages.length,0);
});
test('退群操作失败且确认窗口未关闭，绝不回报成功',()=>{
  const x=fixture();x.context(x.row);x.click(x.leave);x.click(x.confirm);x.complete();
  assert.equal(x.messages.length,0);
});
test('退群操作失败时显示错误提示，窗口关闭也不得标记退群',()=>{
  const x=fixture();x.context(x.row);x.click(x.leave);x.click(x.confirm);
  x.dialog.isConnected=false;x.alerts.push(element({role:'alert',text:'退出失败，请重试'}));x.complete();
  assert.equal(x.messages.length,0);
});
test('禁止合成点击触发退群；缺少精确聊天ID时不猜测',()=>{
  const x=fixture();x.context(x.row,false);x.click(x.leave,false);x.click(x.confirm,false);
  x.dialog.isConnected=false;x.complete();assert.equal(x.messages.length,0);
  x.click(x.leave);x.click(x.confirm);x.complete();assert.equal(x.messages.length,0);
});
test('侧栏没有菜单锚点时仅允许唯一选中的群组',()=>{
  const x=fixture();x.withSelected();x.click(x.leave);x.click(x.confirm);
  x.dialog.isConnected=false;x.complete();assert.equal(x.messages.length,1);
});
test('菜单、确认按钮均须为退群操作，拒绝退出账户等无关功能',()=>{
  const x=fixture();x.context(x.row);x.click(x.build({role:'menuitem',label:'退出账号'}));
  x.click(x.confirm);x.dialog.isConnected=false;x.complete();assert.equal(x.messages.length,0);
});

test('官方确认按钮为“确定退出”或“确认”时，在确切退群对话框内才计数',()=>{
  for(const label of ['确定退出','确认','确认退出']){
    const x=fixture();x.context(x.row);x.click(x.leave);
    const yes=x.build({role:'button',label,parent:x.dialog});x.click(yes);
    x.dialog.isConnected=false;x.complete();
    assert.equal(x.messages.length,1,label);
  }
});
test('不把账号退出弹窗视为群聊退出；也不接受取消按钮',()=>{
  const x=fixture();x.context(x.row);x.click(x.leave);
  const logout=x.build({role:'dialog',text:'确定退出账号？'});
  x.click(x.build({role:'button',label:'确认',parent:logout}));
  logout.isConnected=false;x.complete();assert.equal(x.messages.length,0);
  const y=fixture();y.context(y.row);y.click(y.leave);
  y.click(y.build({role:'button',label:'取消',parent:y.dialog}));
  y.dialog.isConnected=false;y.complete();assert.equal(y.messages.length,0);
});
test('在菜单中选择“退出此群聊”同样可以安全匹配',()=>{
  const x=fixture();x.context(x.row);
  const menu=x.build({role:'menu'});
  x.click(x.build({role:'menuitem',label:'退出此群聊',parent:menu}));
  x.click(x.confirm);x.dialog.isConnected=false;x.complete();
  assert.equal(x.messages.length,1);
});
test('激活群行使用 aria-current=page 时仅定位唯一群ID',()=>{
  const row=element({id:'title-chat-list-item_'+GROUP});
  row.getAttribute=key=>key==='aria-current'?'page':null;
  const doc={querySelectorAll:()=>[row]};
  assert.equal(UI.selectedGroup(doc),GROUP);
  const other=element({id:'title-chat-list-item_19:other@thread.v2'});
  other.getAttribute=key=>key==='aria-current'?'page':null;
  assert.equal(UI.selectedGroup({querySelectorAll:()=>[row,other]}),'');
});
test('退出菜单缺少准确群 ID 时记录原因，但不调用退群回调',()=>{
  const x=fixture();const issues=[];
  const handlers={};const doc={addEventListener:(name,fn)=>handlers[name]=fn,
    removeEventListener:()=>{},querySelectorAll:()=>[]};
  UI.start(doc,()=>assert.fail('绝不自动修改群组'),{onUnresolved:code=>issues.push(code)});
  handlers.click({target:x.leave,isTrusted:true});
  assert.deepEqual(issues,['NO_EXACT_GROUP_ID']);
});
