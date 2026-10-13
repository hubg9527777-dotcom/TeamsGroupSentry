const assert=require('node:assert/strict');
const test=require('node:test');
const L=require('../lib/logic.js');
const id=i=>`8:live:cid.${String(i).padStart(16,'0')}`;
const group='19:ABCDEF12345@thread.v2';
const rec=(count=null,full)=>({id:group,members:Array.from({length:6},(_,i)=>({id:id(i+1),role:'Admin'})),
  conversationMembersTotalCount:count===null?undefined:count,
  isConversationMembersTruncated:full});
test('real screenshot 6 IDs but 5 others is consistent',()=>{const p=L.parseRecord(rec(5,false));assert.equal(p.countOffset,1);assert.equal(p.quality,'CACHE_CONSISTENT');});
test('missing completeness is a cautious observation, not discarded',()=>assert.equal(L.parseRecord(rec()).quality,'CACHE_OBSERVED'));
test('partial roster explicitly flagged is rejected',()=>assert.equal(L.parseRecord(rec(5,true)).skip,'unsafeRoster'));
test('name taken only from matched ID avatar',()=>{const r=rec();r.avatarUsersInfo=[{id:id(1),displayName:'AA-赵某'},{id:id(10),displayName:'其他人'}];const p=L.parseRecord(r);assert.equal(p.members[0].name,'AA-赵某');assert.equal(p.members[1].name,'');});
test('identical ID but renamed is no new relation',()=>assert.equal(L.classifyChange([id(1),id(2)],[id(1),id(2)]).kind,'UNCHANGED'));
test('addition is observed, not confirmed',()=>assert.deepEqual(L.classifyChange([id(1),id(2)],[id(1),id(2),id(3)]).added,[id(3)]));
test('mixed replacement must not raise an ordinary join',()=>assert.equal(L.classifyChange([id(1),id(2)],[id(1),id(3)]).kind,'AMBIGUOUS_REPLACEMENT'));
test('roster shrink is uncertain, not true exit',()=>assert.equal(L.classifyChange([id(1),id(2)],[id(1)]).kind,'AMBIGUOUS_SHRINK'));
test('company prefix only, case normalization',()=>{const p=L.validatePolicy({aaPrefixes:['aa'],aaEnabled:true});assert.ok(L.isCompanyCandidate('ＡＡ-王',p));assert.equal(L.isCompanyCandidate('Xaa-王',p),false);});
test('disabled AA cannot silently authorize company transfer',()=>assert.equal(L.alertLevel({companyApproved:true,status:'APPROVED'},L.validatePolicy({aaEnabled:false})), 'INFO'));
test('approved AA transfer quiet in standard but never critical',()=>{const p=L.validatePolicy({});assert.equal(L.alertLevel({companyApproved:true,status:'APPROVED'},p),'SILENT');assert.equal(L.alertLevel({level:'CRITICAL',companyApproved:true,status:'APPROVED'},p),'CRITICAL');});
test('unknown AA pattern alone stays unknown',()=>assert.equal(L.alertLevel({status:'NEW',companyCandidate:true},L.validatePolicy({})),'HIGH'));
test('group alias has priority over longTitle',()=>assert.equal(L.groupLabel({id:group,alias:'我的重要群',longTitle:'AAA',memberIds:[]}), '我的重要群'));
test('group gets readable members when no title',()=>assert.match(L.groupLabel({id:group,memberIds:[id(1),id(2)]},new Map([[id(1),{name:'刘某'}]])),/刘某/));
test('IDs never inferred from duplicate display names',()=>{const r=rec();r.members[0].displayName='AA';r.members[1].displayName='AA';assert.equal(L.parseRecord(r).members.length,6);});
test('duplicate ID must be rejected',()=>{const r=rec();r.members[1].id=r.members[0].id;assert.equal(L.parseRecord(r).skip,'unsafeRoster');});
test('group count accepts 400 independent valid caches',()=>{const all=Array.from({length:400},(_,i)=>({...rec(),id:`19:${i}TEST@thread.v2`}));assert.equal(all.map(L.parseRecord).filter(r=>r.id).length,400);});
test('unknown empty/one-person chat is rejected',()=>{const r=rec();r.members=r.members.slice(0,1);assert.equal(L.parseRecord(r).skip,'notGroup');});
test('missing display names do not become fake names',()=>{const x=L.parseRecord(rec());assert.equal(x.members[0].name,'');});

test('nonstandard Teams MRI types retained if stable and safe',()=>assert.equal(L.personId('5:8f728fbc-1c4a-4d2f-99bb-bbbbbbbbbb'),true));
test('malformed member IDs rejected',()=>assert.equal(L.personId('<script>'),false));
test('Teams longTitle shows six names without inventing six identity bindings',()=>{
 const r={...rec(),longTitle:'1, 2, 3, 4, 5, 6'};const result=L.parseRecord(r);
 assert.deepEqual(result.titleNameHints,['1','2','3','4','5','6']);
 assert.equal(result.members.every(m=>m.name===''),true);
 assert.equal(result.longTitle,'1, 2, 3, 4, 5, 6');
});
test('nested avatar profile with exact ID can identify name safely',()=>{
 const r=rec();r.avatarUsersInfo=[{id:id(1),profile:{id:id(1),displayName:'AA-王某'}},{id:id(2),profile:{id:id(999),displayName:'陌生人'}}];
 const result=L.parseRecord(r);assert.equal(result.members[0].name,'AA-王某');assert.equal(result.members[1].name,'');
});
test('title name clues reject a single title as unverified person names',()=>assert.deepEqual(L.titleNameHints('财务办公室'),[]));
