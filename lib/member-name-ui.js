/* Optional VISIBLE Teams member-name hints, never membership or trust evidence.
 * Bind only an explicit complete MRI and a separate display-name field in the
 * SAME visible member/participant row. Never infer ID/name correspondence from
 * list order, generic chat text, name similarity, or a DOM script message. */
(function(root,factory){const api=factory(root.TGSNames);if(typeof module==='object'&&module.exports)module.exports=api;root.TGSMemberNameUI=api;})(globalThis,(Names)=>{
  const ID_ATTRS=['data-mri','data-person-id','data-user-id','data-member-id','data-member-mri','data-profile-id','data-identity','data-user-mri','data-skype-id','data-contact-id','data-entity-id'];
  const NAME_SELECTOR='[data-tid="participant-name"],[data-tid="member-name"],[data-tid="person-name"],[data-tid="contact-name"],[data-tid="display-name"],[data-testid="participant-name"],[data-testid="member-name"],[data-testid="person-name"],[data-testid="display-name"],[data-tid="persona-primary-text"],[data-testid="persona-primary-text"]';
  const ROW_SELECTOR='[role="listitem"],[role="option"],[data-tid*="participant-item"],[data-tid*="member-item"],[data-tid*="people-list-item"],[data-testid*="participant-item"],[data-testid*="member-item"]';
  const PANEL_SELECTOR='[role="dialog"],[data-tid*="participant-list"],[data-tid*="member-list"],[data-tid*="people-list"],[data-testid*="participant-list"],[data-testid*="member-list"],[data-testid*="people-list"]';
  function visible(el){return !!el?.isConnected&&(!el.getClientRects||el.getClientRects().length>0);}
  function inspect(doc,known){
    if(!Names||!doc?.querySelectorAll||!(known instanceof Set)||!known.size)return [];
    const found=new Map(),conflicts=new Set();let checked=0;
    const idSelector=ID_ATTRS.map(attr=>'['+attr+']').join(',');
    for(const el of [...doc.querySelectorAll(idSelector)].slice(0,1200)){
      if(++checked>1200)break;
      if(!visible(el))continue;
      const ids=ID_ATTRS.map(a=>el.getAttribute(a)).filter(id=>Names.validId(id)&&known.has(id));
      if(ids.length!==1)continue;
      const id=ids[0];
      const row=el.closest?.(ROW_SELECTOR);
      if(!row||!visible(row)||!row.closest?.(PANEL_SELECTOR))continue;
      // Reject any row that has two different explicit identities. A display
      // name in a multi-person container cannot safely be bound to either.
      const rowIds=new Set();
      const entries=[row,...row.querySelectorAll(idSelector)].slice(0,80);
      for(const entry of entries)for(const attr of ID_ATTRS){const value=entry.getAttribute?.(attr);if(Names.validId(value))rowIds.add(value);}
      if(rowIds.size!==1||!rowIds.has(id))continue;
      const labels=[...row.querySelectorAll(NAME_SELECTOR)].filter(visible).slice(0,5)
        .map(node=>Names.cleanName(node.textContent||'',id)).filter(Boolean);
      if(new Set(labels).size!==1)continue;
      const name=labels[0];
      if(found.has(id)&&found.get(id)!==name){found.delete(id);conflicts.add(id);}
      else if(!conflicts.has(id))found.set(id,name);
      if(found.size>=300)break;
    }
    return [...found].map(([id,name])=>({id,name,source:'Teams 当前可见成员名单'}));
  }
  function hasPanel(doc){return !!doc?.querySelector?.(PANEL_SELECTOR);}
  return {inspect,hasPanel};
});
