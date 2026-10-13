const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../lib/backup-diff.js');
const ACCOUNT='verified:'+'a'.repeat(32);
const group=id=>`19:${id}@thread.v2`;
const person=id=>`8:live:cid.${id}`;
const old={format:'TGS3_BACKUP',version:1,at:'2026-10-12T12:00:00.000Z',account:ACCOUNT,
 tables:{groups:[{account:ACCOUNT,id:group('old'),memberIds:[person('1'),person('2'),person('3')]}],
 people:[1,2,3].map(id=>({account:ACCOUNT,id:person(id)}))}};
const currGroups=[{account:ACCOUNT,id:group('old'),memberIds:[person('1'),person('2'),person('3'),person('4')]},
{account:ACCOUNT,id:group('new'),memberIds:[person('1'),person('5')]}];
const currPeople=[1,2,3,4,5].map(i=>({account:ACCOUNT,id:person(i),name:`员工${i}`}));
test('old backup vs today detects two unique people without changing old group status',()=>{
 const oldCopy=JSON.stringify(old),nowCopy=JSON.stringify(currGroups);
 const result=B.compare(old,currGroups,currPeople,ACCOUNT);
 assert.equal(result.newPeopleCount,2);
 assert.equal(result.newGroupCount,1);
 assert.equal(result.oldGroupNewRelations,1);
 assert.equal(result.oldGroupMissingRelations,0);
 assert.deepEqual(result.people.map(p=>p.id),[person('4'),person('5')]);
 assert.equal(result.people[1].inPreviouslyKnownGroup,false);
 assert.equal(JSON.stringify(old),oldCopy);assert.equal(JSON.stringify(currGroups),nowCopy);
});
test('same snapshot has no false positives',()=>{
 const result=B.compare(old,old.tables.groups,old.tables.people,ACCOUNT);
 assert.equal(result.newPeopleCount,0);assert.equal(result.oldGroupNewRelations,0);
});
test('cross-account backups, corrupt roster and duplicates are rejected before diff',()=>{
 assert.throws(()=>B.compare(old,currGroups,currPeople,'verified:'+'b'.repeat(32)),/账号/);
 const x=JSON.parse(JSON.stringify(old));x.tables.groups[0].memberIds.push(person('1'));
 assert.throws(()=>B.compare(x,currGroups,currPeople,ACCOUNT),/异常/);
 const y=JSON.parse(JSON.stringify(old));y.tables.people[0].account='verified:'+'b'.repeat(32);
 assert.throws(()=>B.compare(y,currGroups,currPeople,ACCOUNT),/异常/);
});
test('new group alone never counts as old group admission event',()=>{
 const result=B.compare(old,[...old.tables.groups,currGroups[1]],currPeople,ACCOUNT);
 assert.equal(result.newGroupCount,1);assert.equal(result.oldGroupNewRelations,0);
 assert.equal(result.newPeopleCount,2);
});
test('missing member is a cache absence, not proof that someone left',()=>{
 const result=B.compare(old,[{account:ACCOUNT,id:group('old'),memberIds:[person('1')]}],old.tables.people,ACCOUNT);
 assert.equal(result.oldGroupMissingRelations,2);
 assert.equal(result.newPeopleCount,0);
});
