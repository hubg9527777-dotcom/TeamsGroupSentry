"""Optional real-Chromium IndexedDB integration test.
Run: python tests/recovery.browser.test.py
Needs Playwright Python and locally installed Chromium; no Internet or Teams login.
"""
import functools
import http.server
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)),
)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium',
                                    args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page()
        base = f'http://127.0.0.1:{server.server_port}'
        page.goto(base)
        for script in ('lib/logic.js', 'lib/db.js', 'lib/recovery.js'):
            page.add_script_tag(url=f'{base}/{script}')
        result = page.evaluate('''async () => {
          const db=TGSDB, rec=TGSRecovery;
          const account='verified:'+'a'.repeat(32);
          const gid=i=>'19:'+i+'abcdef@thread.v2';
          const pid=i=>'8:live:cid.'+String(i).padStart(16,'0');
          await db.open();
          const groupId=gid(1), personId=pid(1), person2=pid(2);
          const group={pk:db.pk(account,groupId),account,id:groupId,alias:'原群名',
                       memberIds:[personId,person2],quality:'CACHE_OBSERVED'};
          const person={pk:db.pk(account,personId),account,id:personId,status:'NEW',
                        manualName:'',companyApproved:false};
          const second={pk:db.pk(account,person2),account,id:person2,status:'APPROVED'};
          const edge={pk:db.pk(account,db.pk(groupId,personId)),account,groupId,personId};
          await db.transaction(['groups','people','edges'],'readwrite',tx=>{
            tx.objectStore('groups').put(group);tx.objectStore('people').put(person);
            tx.objectStore('people').put(second);tx.objectStore('edges').put(edge);
          });
          const saved=await rec.capture(db,{version:'3.3.3',label:'升级前'});
          const before=await rec.verifyCheckpoint(saved.id,db,account);
          if(before.missing!==0||before.previousPending!==1||before.priorGroups!==1)throw Error('初始快照不准确');
          const approved={...person,status:'APPROVED',manualName:'员工已确认'};
          await db.transaction(['groups','people','edges'],'readwrite',tx=>{
            tx.objectStore('people').put(approved);
            tx.objectStore('groups').delete(group.pk);
            tx.objectStore('edges').delete(edge.pk);
          });
          const missing=await rec.verifyCheckpoint(saved.id,db,account);
          if(missing.missing!==2)throw Error('缺失记录判断不正确: '+missing.missing);
          const restored=await rec.restoreMissing(saved.id,db,TGSLogic,account);
          const updatedPeople=await db.getAllFor('people',account);
          const selected=updatedPeople.find(p=>p.id===personId);
          const restoredGroup=(await db.getAllFor('groups',account))[0];
          if(restored.added!==2||selected.status!=='APPROVED'||selected.manualName!=='员工已确认'||restoredGroup.alias!=='原群名')
            throw Error('恢复覆盖已审核身份或未恢复群组');
          const after=await rec.verifyCheckpoint(saved.id,db,account);
          if(after.missing!==0)throw Error('恢复后仍有缺失记录');
          const unchanged=await rec.restoreMissing(saved.id,db,TGSLogic,account);
          if(unchanged.added!==0)throw Error('重复恢复不幂等');
          let tampered=false;
          try {await rec.restoreMissing('invalid',db,TGSLogic,account)}catch(e){tampered=true}
          if(!tampered)throw Error('非法恢复点未拒绝');
          return {ok:true,initialNew:before.previousPending,restored:restored.added,
                  missingAfter:after.missing,reviewStatus:selected.status,
                  persistedAlias:restoredGroup.alias,repeatAdded:unchanged.added};
        }''')
        print(json.dumps(result,ensure_ascii=False))
        browser.close()
finally:
    server.shutdown()
