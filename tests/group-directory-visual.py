from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1400,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 html=(root/'ui/dashboard.html').read_text();import re
 html=re.sub(r'<script[^>]*></script>','',html)
 html=re.sub(r'<link[^>]*rel="stylesheet"[^>]*>','',html)
 page.set_content(html,wait_until='load')
 page.add_style_tag(content=(root/'ui/dashboard.css').read_text())
 stubs='''
 const account='verified:'+'a'.repeat(32),now=Date.now();
 const p=[{id:'8:live:a',name:'张小明',status:'APPROVED'},{id:'8:live:b',name:'李秀',status:'APPROVED'},
  {id:'8:live:c',name:'陈文华',status:'NEW'},{id:'8:live:d',name:'周雨',status:'LEGACY'}].map(x=>({...x,account}));
 const groups=[{id:'19:alpha@thread.v2',title:'墨西哥家庭交流',account,memberIds:[p[0].id,p[1].id],level:'STANDARD',lastObservedAt:now},
 {id:'19:beta@thread.v2',title:'西语练习群',account,memberIds:[p[0].id,p[2].id],level:'STANDARD',lastObservedAt:now,ambiguous:true,
 pendingRosterIds:[p[0].id,p[3].id],pendingRevision:'x',pendingSnapshotAt:now,ambiguousReason:'名单出现减少或替换'},
 {id:'19:gamma@thread.v2',title:'工作讨论群',account,memberIds:[p[0].id,p[3].id],level:'QUIET',lastObservedAt:now}];
 const events=[{id:'ev1',groupId:groups[0].id,account,at:now-10*86400000,type:'ROSTER_CHANGE_OBSERVED',addedIds:[p[0].id],removedIds:[p[2].id]},
 {id:'ev2',groupId:groups[0].id,account,at:now-45*86400000,type:'ROSTER_CHANGE_OBSERVED',addedIds:[p[1].id],removedIds:[]}];
 globalThis.TGSDB={getMeta:async key=>({account,at:now}),getAllFor:async (kind,_account)=>({groups,people:p,edges:[],events}[kind]||[]),getPolicy:async()=>({})};
 globalThis.chrome={runtime:{sendMessage:async req=>req.action==='SUMMARY'?{ok:true,featureBuild:'group-history-2026-11-01-r9',guard:{mode:'WRITE',account},status:{level:'NORMAL'}}:{ok:true}},tabs:{create:async()=>({})}};
 '''
 page.add_script_tag(content='history.replaceState = function(){};')
 page.add_script_tag(content=stubs)
 for filename in ('lib/logic.js','lib/name-core.js','lib/contact-risk.js','lib/group-review.js','lib/group-history.js','lib/group-directory.js','ui/dashboard.js'):
  page.add_script_tag(content=(root/filename).read_text())
 page.get_by_role('button',name='群组管理').click()
 
 try: page.locator('.group-item').first.wait_for(timeout=5000)
 except Exception:
  print('ERRORS',errors); print('MAIN:',page.locator('#main').inner_text()[:1600]); raise
 assert page.get_by_role('heading',name='群组管理').count()==1
 assert page.locator('.group-item').count()==3
 assert page.locator('.group-snapshot-grid').count()==2
 assert '张小明' in page.locator('.group-item').filter(has_text='墨西哥家庭交流').inner_text()
 assert '陈文华' in page.locator('.group-item').filter(has_text='墨西哥家庭交流').inner_text()
 assert page.locator('.group-item').filter(has_text='墨西哥家庭交流').locator('.group-technical:not([open])').count()==1
 assert page.locator('.group-item').filter(has_text='工作讨论群').locator('.group-snapshot-grid').count()==0
 pending=page.locator('.group-item').filter(has_text='西语练习群')
 assert pending.locator('.group-pending-label').count()==2
 assert '周雨' in pending.inner_text() and '陈文华' in pending.inner_text()
 assert pending.locator('.group-snapshot-time').count()==2
 assert pending.locator('.group-technical').get_attribute('open') is None
 assert page.locator('.group-bulk').count()==0
 print('Directory order:',page.locator('.group-title').all_inner_texts())
 page.screenshot(path=str(root.parent/'group-directory-preview-desktop.png'),full_page=False)
 search=page.get_by_role('searchbox',name='按群名搜索');search.fill('西语')
 assert page.locator('.group-item').count()==1
 assert page.locator('.group-item').first.locator('.group-title').inner_text()=='西语练习群'
 page.get_by_role('button',name='清空搜索').click()
 page.locator('.group-item').filter(has_text='墨西哥家庭交流').locator('.group-title').click()
 panel=page.locator('.group-history-panel')
 assert panel.locator('select').input_value()=='60'
 assert page.locator('.group-history-entry').count()==2
 assert '陈文华' in panel.inner_text()
 panel.locator('select').select_option('30')
 assert page.locator('.group-history-entry').count()==1
 page.get_by_role('button',name='关闭',exact=True).click()
 page.get_by_role('button',name='批量处理群聊').click()
 assert page.locator('.group-bulk').count()==1
 page.locator('.group-checkbox').first.check()
 assert '已勾选 1 群' in page.locator('.group-bulk').inner_text()
 page.get_by_role('button',name='完成批量处理').click()
 assert page.locator('.group-bulk').count()==0
 page.set_viewport_size({'width':720,'height':850})
 assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.screenshot(path=str(root.parent/'group-directory-preview-720.png'),full_page=False)
 print('Browser UI PASS: name search, all directory, 60 days, 30 days, batch toggle, narrow width')
 print('JS errors:',errors)
 assert not errors,errors
 browser.close()
