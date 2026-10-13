const {test}=require('node:test');
const assert=require('node:assert/strict');
const envelope=require('../lib/backup-envelope.js');
function valid(){return {format:'TGS3_ENCRYPTED',version:1,iterations:250000,
  kdf:'PBKDF2-SHA256',cipher:'AES-256-GCM',salt:Buffer.alloc(16).toString('base64'),
  iv:Buffer.alloc(12).toString('base64'),data:Buffer.alloc(32).toString('base64')};}
test('encrypted envelope validates valid legacy export with compatible metadata',()=>{
  assert.equal(envelope.validate(valid()).format,'TGS3_ENCRYPTED');
});
test('reject nonobject and invalid algorithm negotiation',()=>{
  for(const d of [null,[],{}, {...valid(),iterations:1},{...valid(),cipher:'AES-CTR'}])
    assert.throws(()=>envelope.validate(d));
});
test('reject malformed base64 and wrong salt/IV lengths before decoding',()=>{
  assert.throws(()=>envelope.validate({...valid(),salt:'not base64'}));
  assert.throws(()=>envelope.validate({...valid(),iv:Buffer.alloc(13).toString('base64')}));
  assert.throws(()=>envelope.validate({...valid(),data:'!!!!'}));
});
test('reject nonstring and excessive ciphertext fields without decoding',()=>{
  assert.throws(()=>envelope.validate({...valid(),data:{large:true}}));
  assert.throws(()=>envelope.validate({...valid(),data:'A'.repeat(Math.ceil(envelope.MAX_INPUT_BYTES/3)*4+8)}));
});
test('ciphertext shorter than GCM authentication tag rejected',()=>{
  assert.throws(()=>envelope.validate({...valid(),data:Buffer.alloc(8).toString('base64')}));
});
