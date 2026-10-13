const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

test('offscreen audio ignores Teams-page messages and other extension IDs',()=>{
  let listener,started=0;
  class AudioContext{
    constructor(){started++;this.currentTime=0;this.destination={};}
    createOscillator(){return {type:'',frequency:{value:0},connect:()=>({connect:()=>{}}),start:()=>{},stop:()=>{}};}
    createGain(){return {gain:{setValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}}};}
    close(){return Promise.resolve();}
  }
  const chrome={runtime:{id:'sentry',getURL:p=>'chrome-extension://sentry/'+p,
    onMessage:{addListener:fn=>listener=fn}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'offscreen/sound.js'),'utf8'),
    {chrome,AudioContext,URL,console,setTimeout:()=>{}});
  const req={action:'PLAY_ALERT_SOUND'};
  listener(req,{id:'sentry',tab:{id:8},url:'https://teams.live.com/v2/'});
  listener(req,{id:'other',url:'chrome-extension://sentry/background.js'});
  listener(req,{id:'sentry',url:'https://teams.live.com/v2/'});
  assert.equal(started,0,'untrusted messages must not produce audio');
  listener(req,{id:'sentry',url:'chrome-extension://sentry/background.js'});
  assert.equal(started,1,'service worker retains sound functionality');
});

test('MV3 extension restricts hosts and blocks remote executable script loading',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.host_permissions,['https://teams.live.com/*']);
  assert.ok(!manifest.permissions.includes('cookies'));
  assert.ok(!manifest.permissions.includes('webRequest'));
  assert.match(manifest.content_security_policy.extension_pages,/script-src 'self'/);
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'self'/);
});
