(function(root){
  function render(container,notice,options={}){
    const doc=container.ownerDocument;
    const add=(parent,tag,cls,text)=>{const e=doc.createElement(tag);e.className=cls;e.textContent=text;parent.append(e);return e;};
    container.replaceChildren();
    const details=Array.isArray(notice.details)?notice.details:[];
    if(!details.length){add(container,'p','request-empty','请求详情暂不可得，请在 Teams「请求」中查看。');return;}
    details.forEach((d,i)=>{
      const card=add(container,'section','request-item','');
      add(card,'span','request-kind',`${i+1}. ${d.kind==='MEETING'?'会议邀请':'聊天请求'}`);
      add(card,'strong','request-item-name',d.kind==='MEETING'?(d.title||'会议名称待获取'):(d.name||d.title||'姓名待获取'));
      if(d.kind==='MEETING')add(card,'span','request-inviter',d.name?`邀请者：${d.name}`:'邀请者待核实');
      const shown=options.latestOnly?(d.latestMessage?[d.latestMessage]:(d.messages||[]).slice(-1)):(d.messages||[]);
      if(shown.length)for(const m of shown){
        const line=add(card,'p','request-message','');
        add(line,'strong','message-author',m.author+'：');add(line,'span','message-body','“'+m.text+'”');
      }else add(card,'p','request-no-body','正文暂不可得，请先预览。');
      if((d.messages||[]).length>1)add(card,'small','message-coverage',options.latestOnly?'更多已获取消息，请点击扩展图标查看':`已取得 ${d.messages.length} 条文字（最多 10 条，非完整历史）`);
    });
    if(Number.isInteger(notice.count)&&notice.count>details.length)
      add(container,'p','request-empty',`${details.length+1}${notice.count>details.length+1?'–'+notice.count:''}. 请求详情暂不可得，请在 Teams「请求」中查看。`);
  }
  root.TGSRequestView={render};
})(globalThis);
