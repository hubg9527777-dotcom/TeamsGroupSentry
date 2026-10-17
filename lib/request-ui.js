/* Conservative passive DOM adapter; no Teams cache request schema is assumed.
 * Only visible, explicitly request-labelled UI regions with paired official
 * Accept/Block controls qualify. Message text, unknown IDs and chat lists do not.
 * This adapter has synthetic fixtures only; unsupported Teams layouts fail closed. */
(function(root,factory){const v=factory(root.TGSContactRisk);if(typeof module==='object'&&module.exports)module.exports=v;root.TGSRequestUI=v;})(globalThis,R=>{
  const REQUEST=/^(?:chat request|message request|contact request|friend request|chat invitation|聊天请求|聊天請求|消息请求|訊息要求|交谈请求|交談要求|好友请求|好友請求|联系人请求|聯絡人邀請|聊天邀请|聊天邀請)$/i;
  const ACCEPT=/^(?:accept|accept request|接受|接受请求|接受請求|同意)$/i;
  const BLOCK=/^(?:block|decline|reject|封锁|封鎖|阻止|拒绝|拒絕)$/i;
  const label=e=>(e?.getAttribute?.('aria-label')||e?.textContent||'').trim();
  const visible=e=>!!e?.isConnected&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"]')&&
    globalThis.getComputedStyle?.(e)?.visibility!=='hidden'&&
    (typeof e.checkVisibility!=='function'||e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
  function inspect(doc){
    const observations=[];let candidates=0;
    // Labels/headings must belong to the UI region itself, not chat content.
    for(const panel of [...doc.querySelectorAll('[role="dialog"],[role="region"],section')].slice(0,600)){
      if(!visible(panel)||panel.closest('#tgs-v31-status-host'))continue;
      const heading=[...panel.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible)
        .filter(h=>h.closest('[role="dialog"],[role="region"],section')===panel);
      const regionLabel=panel.getAttribute('aria-label')||'';
      const requestLabel=REQUEST.test(regionLabel.trim())?regionLabel.trim():heading.map(label).find(t=>REQUEST.test(t))||'';
      if(!REQUEST.test(regionLabel.trim())&&!heading.some(h=>REQUEST.test(label(h))))continue;
      const controls=[...panel.querySelectorAll('button,[role="button"]')].filter(visible)
        .filter(e=>e.closest('[role="dialog"],[role="region"],section')===panel&&!e.disabled);
      if(!controls.some(e=>ACCEPT.test(label(e)))||!controls.some(e=>BLOCK.test(label(e))))continue;
      candidates++;
      // Only an explicit ID-bound identity node within that same request panel.
      // Never harvest arbitrary IDs from body text, avatars, or display names.
      const identityNodes=[...panel.querySelectorAll('[data-mri],[data-person-id],a[href]')].slice(0,100)
        .filter(visible).filter(e=>e.closest('[role="dialog"],[role="region"],section')===panel);
      const identities=[];
      for(const e of identityNodes){
        const ids=[e.getAttribute('data-mri'),e.getAttribute('data-person-id')].filter(Boolean);
        if(e.tagName==='A')try{const u=new URL(e.getAttribute('href'),doc.location?.href||'https://teams.live.com/');
          if(u.origin==='https://teams.live.com'&&u.pathname==='/l/chat/0/0'){
            const users=u.searchParams.get('users');if(R.validMRI(users))ids.push(users);
          }
        }catch{}
        const unique=[...new Set(ids)];
        if(unique.length===1&&R.validMRI(unique[0]))identities.push({personId:unique[0],name:label(e).slice(0,120)});
        else if(unique.length)identities.push({personId:'',name:''});
      }
      const unique=[...new Set(identities.map(e=>e.personId))];
      const identity=unique.length===1&&unique[0]?identities.find(e=>e.personId===unique[0]):null;
      // A thread ID can deduplicate an unresolved panel but can NEVER become a person ID.
      const rawThread=panel.getAttribute('data-thread-id')||'';
      const context=/^19:[^\s<>]{1,520}@thread(?:\.[\w-]+)?$/i.test(rawThread)?rawThread:'visible-request';
      observations.push({kind:/^(?:contact request|friend request|好友请求|好友請求|联系人请求|聯絡人邀請)$/i.test(requestLabel)?'CONTACT':'CHAT',personId:identity?.personId||'',name:identity?.name||'',context,
        evidence:identity?'请求标题 + 接受/拒绝控件 + 同一区域唯一显式人员 ID':'请求标题 + 接受/拒绝控件；人员 ID 缺失或冲突'});
      if(observations.length>=50)break;
    }
    return {adapter:'VISIBLE_REQUEST_V1',coverage:'LIMITED_UI',candidates,observations};
  }
  // Attributes observed in the personal Teams v2 Requests UI, 2026-10-16.
  // Only read UI evidence. A title/thread/temporary avatar ID is never a person.
  function inspectSignal(doc){
    const entry=doc.querySelector('[data-testid="list-item-REQUESTS"][role="treeitem"]');
    let badge=null;
    if(visible(entry)){
      const aside=entry.querySelector('.fui-TreeItemLayout__aside');
      // aria-hidden badges still carry a visible count; inspect rendering rather
      // than accessibility visibility for this exact structural badge slot.
      if(aside?.isConnected&&aside.getClientRects().length&&globalThis.getComputedStyle?.(aside)?.visibility!=='hidden'){
        const value=(aside.textContent||'').trim();
        if(/^[1-9]\d{0,3}$/.test(value))badge=Number(value);
      }
    }
    const lists=[...doc.querySelectorAll('[data-testid="message-slice-list-vl2-viewport"][role="treegrid"]')]
      .filter(visible).filter(e=>/^(?:请求|請求|requests|chat requests)$/i.test(e.getAttribute('aria-label')||''));
    const rows=lists.flatMap(list=>[...list.querySelectorAll('[data-testid="message-slice-card-requests"][role="row"]')].filter(visible)).slice(0,200);
    const keys=[...new Set(rows.map(e=>e.id).filter(id=>/^message-slice-card-requests-RequestsSliceCardItem\|19:[^\s<>]{1,520}@thread(?:\.[\w-]+)?$/i.test(id)))].sort();
    const panel=[...doc.querySelectorAll('[data-tid="accept-block-container"]')].filter(visible).find(e=>{
      const title=e.querySelector('[data-test-id="regular-block-title"]');
      const buttons=[...e.querySelectorAll('button,[role="button"]')].filter(visible).filter(b=>!b.disabled);
      return visible(title)&&buttons.some(b=>ACCEPT.test(label(b)))&&buttons.some(b=>BLOCK.test(label(b)));
    });
    const observed=badge!==null||keys.length>0||!!panel;
    // Keys remain thread identifiers only; bounded display excerpts are separate evidence, never identity proof.
    const source=badge!==null?'BADGE':keys.length?'VISIBLE_ROWS':panel?'PANEL':'NONE';
    return {observed,source,count:badge??(keys.length||(!panel?0:null)),
      meeting:keys.some(id=>/\|19:meeting_/i.test(id)),keys,details:requestDetails(doc,rows.filter(e=>keys.includes(e.id)))};
  }
  // These exact Teams v2 nodes were verified in the official pre-accept preview.
  // No preview, accept, block, links or list rows are clicked by this reader.
  const clean=(s,n=120)=>String(s||'').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
  function requestDetails(doc,rows){
    const details=rows.map(e=>({key:e.id,title:clean([...e.querySelectorAll('[role="gridcell"]')].filter(visible).map(c=>c.innerText||c.textContent).find(t=>clean(t))||''),
      kind:/\|19:meeting_/i.test(e.id)?'MEETING':'CHAT',name:'',messages:[],previewAvailable:false}));
    const selected=rows.filter(e=>e.getAttribute('aria-selected')==='true');
    if(selected.length!==1)return details;
    const item=details.find(d=>d.key===selected[0].id);if(!item)return details;
    const panels=[...doc.querySelectorAll('[data-tid="accept-block-container"],#vertical-flex')].filter(visible).filter(e=>{
      const controls=[...e.querySelectorAll('button,[role="button"]')].filter(visible).filter(b=>!b.disabled);
      return controls.some(b=>ACCEPT.test(label(b)))&&controls.some(b=>BLOCK.test(label(b)));
    });
    if(panels.length!==1)return details;
    const panel=panels[0],title=panel.querySelector('[data-test-id="regular-block-title"]');
    const line=clean(visible(title)?title.innerText||title.textContent:(panel.innerText||'').split('\n')[0],240);
    const match=line.match(/^(.+?)\s*(?:想和你聊天|想與您聊天|想與你聊天|wants to chat with you)$/i)||
      line.match(/^(.+?)\s*(?:已将你添加到会议聊天|已將您新增至會議聊天|已將你新增至會議聊天|has added you to (?:a |the )?meeting chat)$/i);
    if(!match)return details;
    const meeting=/会议聊天|會議聊天|meeting chat/i.test(line);
    // A single-chat row title must match the official sender title. Switching
    // requests mid-render must never attach one person's preview to another.
    const name=clean(match[1]);
    if(!meeting&&item.title&&name!==item.title)return details;
    if(meeting!==(item.kind==='MEETING'))return details;
    if(meeting&&item.title&&![...doc.querySelectorAll('h1,h2,[role=heading]')].filter(visible).some(h=>!h.closest('[role=treegrid]')&&!panel.contains(h)&&clean(h.innerText||h.textContent)===item.title))return details;
    item.name=name;item.officialWarning=true;
    item.previewAvailable=[...panel.querySelectorAll('button,[role="button"]')].filter(visible).some(b=>/^(?:预览他们的消息[。.]?|預覽他們的訊息[。.]?|preview (?:their )?messages[。.]?)$/i.test(label(b))&&!b.disabled);
    // Before preview, read neither another chat nor a hidden/off-screen cache.
    if(item.previewAvailable)return details;
    const lists=[...doc.querySelectorAll('[data-tid="message-pane-list-runway"]')].filter(visible);
    if(lists.length!==1)return details;
    let common=panel.parentElement;
    for(let i=0;i<12&&common&&!common.contains(lists[0]);i++)common=common.parentElement;
    if(!common||!common.contains(lists[0])||common.contains(selected[0]))return details;
    const messages=[];
    for(const e of [...lists[0].querySelectorAll('[data-tid="chat-pane-message"]')].filter(visible).slice(-100)){
      const ids=(e.getAttribute('aria-labelledby')||'').split(/\s+/);
      const content=ids.filter(id=>/^content-\d+$/.test(id)),authors=ids.filter(id=>/^author-\d+$/.test(id));
      if(content.length!==1||authors.length!==1)continue;
      const body=doc.getElementById(content[0]),author=doc.getElementById(authors[0]);
      if(!visible(body)||!visible(author)||!e.contains(body)||!lists[0].contains(author)||author.getAttribute('data-tid')!=='message-author-name')continue;
      const who=clean(author.innerText||author.textContent),text=clean(body.innerText||body.textContent,300);
      // A meeting may have many authors. Preserve attribution, never imply all
      // preview messages were sent by its inviter. Single-chat mismatch fails closed.
      if(!who||!text||(!meeting&&who!==name))continue;
      messages.push({author:who,text});
    }
    item.messages=messages.slice(-10);return details;
  }
  return {inspect,inspectSignal,requestDetails,REQUEST,ACCEPT,BLOCK};
});
