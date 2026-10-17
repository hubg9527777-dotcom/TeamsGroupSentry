// Synthetic local-only browser fixtures. This is NOT a general-purpose file server.
// Never expose developer secrets, repository metadata, browser profiles or backups.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),realRoot=fs.realpathSync(root);
const TYPES=Object.freeze({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json'});
const ROOT_FILES=new Set(['background.js','content.js','page-reader.js','manifest.json']);
const DIRS=Object.freeze({tests:new Set(['.html','.js']),lib:new Set(['.js']),
  ui:new Set(['.html','.js','.css']),popup:new Set(['.html','.js','.css']),
  overlay:new Set(['.js','.css']),icons:new Set(['.png']),offscreen:new Set(['.html','.js'])});
function permittedPath(url){
  let pathname;
  try{pathname=decodeURIComponent(new URL(url,'http://127.0.0.1').pathname);}catch{return null;}
  if(pathname==='/' )pathname='/tests/browser.html';
  if(!pathname.startsWith('/')||/[\\\u0000-\u001f\u007f]/.test(pathname))return null;
  const segments=pathname.slice(1).split('/');
  if(segments.some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))return null;
  const relative=segments.join('/'),ext=path.extname(relative);
  if(segments.length===1){if(!ROOT_FILES.has(relative))return null;}
  else if(segments.length!==2||!DIRS[segments[0]]?.has(ext))return null;
  if(!TYPES[ext])return null;
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))return null;
  return file;
}
function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
  const file=permittedPath(req.url);
  if(!file){res.writeHead(403);res.end('Forbidden');return;}
  // Test-only adaptations are confined to exact paths and never change release files.
  if(file===path.join(root,'tests/overlay-under-test.js')){
    const source=fs.readFileSync(path.join(root,'overlay/overlay.js'),'utf8');
    const guard="if(window!==window.top||location.origin!=='https://teams.live.com')return;";
    if(!source.includes(guard)){res.writeHead(500);res.end('Test guard mismatch');return;}
    res.setHeader('Content-Type',TYPES['.js']);res.end(source.replace(guard,"if(location.hostname!=='127.0.0.1')return;"));return;
  }
  if(file===path.join(root,'tests/popup-under-test.html')){
    const source=fs.readFileSync(path.join(root,'popup/popup.html'),'utf8');
    res.setHeader('Content-Type',TYPES['.html']);
    res.end(source.replace('<head>','<head><base href="/popup/"><script src="/lib/contact-risk.js"></script><script src="/lib/request-notice.js"></script><script src="/tests/surface-fixture.js"></script>'));return;
  }
  // Symlinks in any path component must not escape the project root.
  fs.realpath(file,(err,real)=>{
    if(err||!(real===realRoot||real.startsWith(realRoot+path.sep))){res.writeHead(err?.code==='ENOENT'?404:403);res.end();return;}
    fs.stat(real,(statErr,st)=>{
      if(statErr||!st.isFile()){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',TYPES[path.extname(real)]);
      fs.createReadStream(real).on('error',()=>{if(!res.headersSent)res.writeHead(500);res.end();}).pipe(res);
    });
  });
}
if(require.main===module)http.createServer(handler).listen(8765,'127.0.0.1',()=>
  console.log('Synthetic tests: http://127.0.0.1:8765/tests/browser.html'));
module.exports={permittedPath,handler};
