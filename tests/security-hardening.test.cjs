const {test}=require('node:test');
const assert=require('node:assert/strict');
const Logic=require('../lib/logic.js');
const Names=require('../lib/name-core.js');

test('不可见 Unicode 控制符不得进入人员 ID 或群组 ID',()=>{
  const invisible=['\u200b','\u200e','\u202e','\u2066','\u2069','\ufeff','\u00ad','\u009d'];
  for(const mark of invisible){
    assert.equal(Logic.personId('8:live:cid.a'+mark+'b'),false,`person ${mark.codePointAt(0)}`);
    assert.equal(Names.validId('8:live:cid.a'+mark+'b'),false);
    assert.equal(Logic.threadId('19:a'+mark+'b@thread.v2'),false);
  }
  assert.equal(Logic.personId('8:live:cid.abc'),true);
  assert.equal(Logic.threadId('19:valid@thread.v2'),true);
});

test('姓名仅清理伪装显示的不可见字符，不更改审核 ID',()=>{
  const id='8:live:cid.person';
  assert.equal(Names.cleanName('张\u202e三\u200b',id),'张 三');
  assert.equal(Logic.goodName('Ana\u2066 Maria'), 'Ana  Maria');
  const pairs=Names.extract({id,displayName:'Alice\u202e Example'},'',new Set([id]));
  assert.deepEqual(pairs,[{id,name:'Alice  Example'}]);
});

test('大量群员与头像姓名按 ID 匹配；重复头像取第一个有效姓名',()=>{
  const members=Array.from({length:3000},(_,i)=>({id:`8:live:cid.user${i}`}));
  const avatars=members.map((m,i)=>({id:m.id,displayName:`成员${i}`}));
  avatars[7].displayName='';
  avatars.push({id:members[7].id,displayName:'后来补充'}); // beyond 3000 budget is ignored
  const parsed=Logic.parseRecord({id:'19:large@thread.v2',isGroupChat:true,members,
    avatarUsersInfo:avatars,conversationMembersTotalCount:3000,isConversationMembersTruncated:false});
  assert.equal(parsed.quality,'CACHE_CONSISTENT');
  assert.equal(parsed.members.length,3000);
  assert.equal(parsed.members[0].name,'成员0');
  assert.equal(parsed.members[7].name,'');
  assert.equal(parsed.members[2999].name,'成员2999');
  assert.equal(parsed.members[108].nameSource,'avatarUsersInfo');
  const duplicated=Logic.parseRecord({id:'19:dup@thread.v2',isGroupChat:true,
    members:members.slice(0,3),avatarUsersInfo:[{id:members[0].id,displayName:''},
      {id:members[0].id,displayName:'正确姓名'},
      {id:members[0].id,displayName:'不同姓名'}]});
  assert.equal(duplicated.members[0].name,'正确姓名');
});

test('缓存内跨身份嵌套头像不能为错误人员借用姓名',()=>{
  const r=Logic.parseRecord({id:'19:cross@thread.v2',isGroupChat:true,
    members:[{id:'8:live:cid.a'},{id:'8:live:cid.b'},{id:'8:live:cid.c'}],
    avatarUsersInfo:[{id:'8:live:cid.b',profile:{id:'8:live:cid.c',displayName:'冒用者姓名'}}]});
  assert.equal(r.members[1].name,'');
});
