/* Teams UI operation observer. Isolated-world only; it never clicks Teams,
 * reads tokens/network traffic, or assumes a cache-roster delta proves leaving.
 * Teams UI changes may make this intentionally fail closed. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TGSMembershipUI=api;})(globalThis,()=>{
  const PREFIX='title-chat-list-item_';
  const LEAVE=/^(?:退出(?:(?:此|该|這個)?(?:群聊|聊天|群組|群组|对话|對話))?|[離离]開(?:群聊|聊天|群組|群组|对话|對話)?|leave(?:\s+(?:(?:the|this)\s+)?(?:group\s+chat|chat|group|conversation))?|salir\s+(?:del\s+)?(?:chat|grupo)|abandonar\s+(?:el\s+)?(?:chat|grupo)|sair\s+(?:do\s+)?(?:chat|grupo))\s*[.!。！]?$/i;
  // Variants actually used by confirmation actions should not be confused
  // with generic cancellation or account sign-out outside a leave dialog.
  const CONFIRM=/^(?:确[认定](?:退出(?:(?:此|该)?(?:群聊|聊天|群组|群組))?)?|是的[,， ]?退出|yes[,]?\s*leave|confirm(?:\s+leave)?|confirmar|s[ií][,]?\s*salir|sim[,]?\s*sair)\s*[.!。！]?$/i;
  const LEAVE_CONTEXT=/(?:退出(?:此|该|這個)?(?:群聊|聊天|群組|群组|对话|對話)|[離离]開(?:群聊|聊天|群組|群组|对话|對話)|leave\s+(?:(?:the|this)\s+)?(?:group\s+chat|chat|group|conversation)|salir\s+del\s+(?:chat|grupo)|abandonar\s+(?:el\s+)?(?:chat|grupo)|sair\s+do\s+(?:chat|grupo))/i;
  const ERROR=/(?:退出失败|退出失敗|操作失败|操作失敗|无法退出|無法退出|something went wrong|could(?:\s+not|n't)\s+leave|failed to leave|try again|não foi possível sair|no se pudo salir)/i;
  const VALID_ID=id=>typeof id==='string'&&id.length<600&&/^19:[^\s]{1,520}@thread(?:\.[\w-]+)?$/i.test(id);
  function groupFromElement(el){
    for(let node=el,depth=0;node&&depth<12;node=node.parentElement,depth++){
      const id=String(node.id||'');if(id.startsWith(PREFIX)){
        const groupId=id.slice(PREFIX.length);return VALID_ID(groupId)?groupId:'';
      }
    }
    return '';
  }
  function selectedGroup(doc){
    // Must be exactly one selected *group* row. Do not pick the first row or
    // try to guess from chat title/member names.
    const ids=new Set();
    for(const row of doc.querySelectorAll('[id^="'+PREFIX+'"]')){
      const selected=[row,row.parentElement,row.parentElement?.parentElement].some(e=>e&&(
        e.getAttribute?.('aria-selected')==='true'||e.getAttribute?.('data-selected')==='true'||
        ['active','selected'].includes(e.getAttribute?.('data-state'))||
        ['page','true'].includes(e.getAttribute?.('aria-current'))))||
        !!row.querySelector?.('[aria-selected="true"],[aria-current="page"],[data-selected="true"],[data-state="active"],[data-state="selected"]');
      const id=String(row.id||'').slice(PREFIX.length);
      if(selected&&VALID_ID(id))ids.add(id);
    }
    return ids.size===1?[...ids][0]:'';
  }
  function controlFor(target){return target?.closest?.('[role="menuitem"],button,[role="button"]')||null;}
  function labelFor(control){
    if(!control)return '';
    const labels=[control.getAttribute?.('aria-label'),control.getAttribute?.('title'),control.innerText,control.textContent]
      .filter(s=>typeof s==='string').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
    return labels.find(s=>LEAVE.test(s))||labels[0]||'';
  }
  function isVisible(el){return !!el?.isConnected && (!el.getClientRects||el.getClientRects().length>0);}
  function leaveMenu(control){
    if(!control||!LEAVE.test(labelFor(control)))return false;
    return control.getAttribute?.('role')==='menuitem'||!!control.closest?.('[role="menu"]')||
      /leave.*(?:chat|thread)|(?:chat|thread).*leave/i.test(control.getAttribute?.('data-testid')||'');
  }
  function leaveDialog(control){
    if(!control||!(LEAVE.test(labelFor(control))||CONFIRM.test(labelFor(control))))return null;
    const dialog=control.closest?.('[role="dialog"],[role="alertdialog"]');
    if(!dialog||!isVisible(dialog))return null;
    // Avoid mistaking another dialog's generic "Exit" for leaving a group.
    const context=[dialog.getAttribute?.('aria-label'),dialog.textContent].filter(Boolean).join(' ');
    return LEAVE_CONTEXT.test(context)?dialog:null;
  }
  function visibleError(doc){
    for(const el of doc.querySelectorAll('[role="alert"],[aria-live="assertive"]')){
      if(isVisible(el)&&ERROR.test(String(el.textContent||'').slice(0,400)))return true;
    }
    return false;
  }
  function start(doc,onLeave,opts={}){
    const now=opts.now||Date.now;
    const later=opts.later||setTimeout;
    const cancel=opts.cancel||clearTimeout;
    const settleMs=Number.isInteger(opts.settleMs)?opts.settleMs:5000;
    let context={id:'',at:0},pending=null,stopped=false,waiters=new Set();
    function clearPending(){pending?.watcher?.disconnect?.();pending=null;for(const timer of waiters)cancel(timer);waiters.clear();}
    function watchSettled(event){
      const operation=pending;
      operation.errorSeen=visibleError(doc);
      // Short-lived failures can disappear before the settle timeout. Watch
      // visible failure toasts during the whole confirmation window.
      if(typeof MutationObserver==='function'&&doc.documentElement){
        try{const watcher=new MutationObserver(()=>{if(visibleError(doc))operation.errorSeen=true;});
          watcher.observe(doc.documentElement,{childList:true,subtree:true,characterData:true});
          operation.watcher=watcher;
        }catch{}
      }
      const timer=later(()=>{
        waiters.delete(timer);
        if(stopped||pending!==operation)return;
        operation.watcher?.disconnect?.();pending=null;
        // A visible confirmation window or an error means operation was not
        // independently observed as settled; do not subtract the count.
        if(operation.errorSeen||isVisible(event.dialog)||visibleError(doc))return;
        onLeave({chatId:operation.chatId,kind:'LEFT',observedAt:now(),evidence:'DIALOG_DISMISSED_AFTER_CONFIRM'});
      },settleMs);
      waiters.add(timer);
    }
    function onContext(e){if(e.isTrusted===false)return;
      const id=groupFromElement(e.target);if(id)context={id,at:now()};}
    function onClick(e){
      if(e.isTrusted===false||stopped)return;
      const ctl=controlFor(e.target);if(!ctl)return;
      if(pending){
        const dialog=leaveDialog(ctl);
        if(dialog&&now()-pending.at<40000){
          pending.dialog=dialog;
          watchSettled({dialog});return;
        }
      }
      if(!leaveMenu(ctl)){
        const id=groupFromElement(e.target);if(id)context={id,at:now()};
        return;
      }
      const id=groupFromElement(e.target)||(now()-context.at<15000?context.id:'')||selectedGroup(doc);
      if(!VALID_ID(id)){clearPending();try{opts.onUnresolved?.('NO_EXACT_GROUP_ID');}catch{}return;}
      clearPending();pending={chatId:id,at:now()};
    }
    doc.addEventListener('contextmenu',onContext,true);
    doc.addEventListener('click',onClick,true);
    return {stop(){stopped=true;clearPending();doc.removeEventListener('contextmenu',onContext,true);doc.removeEventListener('click',onClick,true);}};
  }
  return {start,selectedGroup,groupFromElement,labelFor,leaveMenu,leaveDialog,visibleError};
});
