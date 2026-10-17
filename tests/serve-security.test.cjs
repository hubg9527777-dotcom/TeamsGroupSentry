const {test}=require('node:test'),assert=require('node:assert/strict');
const {permittedPath}=require('./serve.cjs');
test('测试服务器仅能提供需要的静态测试资源',()=>{
  for(const route of ['/', '/tests/browser.html','/tests/browser-worker.js','/lib/request-ui.js',
    '/popup/popup.html','/overlay/overlay.css','/ui/dashboard.css','/icons/icon48.png',
    '/background.js','/manifest.json'])assert(permittedPath(route),route);
});
test('测试服务器不能暴露密钥、备份、目录穿越或源代码配置',()=>{
  for(const route of ['/.env','/.git/config','/.gitignore','/package.json','/README.md',
    '/docs/交付报告.md','/tests/serve.cjs','/profiles/User%20Data/Local%20Storage',
    '/tests/%2e%2e/.env','/%2e%2e/.env','/tests/%00oops.js','/tests/%ZZ',
    '/tests/secret.encrypted.json','/tests/secret.zip','/node_modules/file.js',
    '/tests/backup.key'])assert.equal(permittedPath(route),null,route);
});
