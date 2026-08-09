#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function type(file) { const ext=path.extname(file).toLowerCase(); if(ext==='.html')return'text/html'; if(ext==='.js'||ext==='.mjs')return'text/javascript'; if(ext==='.css')return'text/css'; if(ext==='.png')return'image/png'; if(ext==='.jpg'||ext==='.jpeg')return'image/jpeg'; if(ext==='.json'||ext==='.webmanifest')return'application/json'; if(ext==='.glb')return'model/gltf-binary'; return'application/octet-stream'; }
function server() { const s=http.createServer((req,res)=>{ const clean=decodeURIComponent(req.url.split('?')[0]); const rel=clean==='/'?'index.html':clean.replace(/^\//,''); const file=path.resolve(ROOT,rel); if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'content-type':type(file),'cache-control':'no-store'}); fs.createReadStream(file).pipe(res);}); return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s))); }
async function onlineProof(browser, base, mobile=false) {
  const context=await browser.newContext(mobile?{viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2,serviceWorkers:'block'}:{viewport:{width:1440,height:900},serviceWorkers:'block'});
  const page=await context.newPage(); const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text());}); page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${base}/rts.html`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('body[data-rts-ready="true"]',{timeout:180000});
  await page.waitForFunction(()=>window.__WESTEROS_RTS_SURFACE__?.status==='ready',null,{timeout:120000});
  await page.waitForTimeout(500);
  const snapshot=await page.evaluate(()=>({surface:{...window.__WESTEROS_RTS_SURFACE__},rts:window.__WESTEROS_RTS__?.getSnapshot?.()}));
  assert(snapshot.surface.sourceWidth===3072&&snapshot.surface.sourceHeight===3072,'source dimensions drifted');
  assert(snapshot.surface.appliedChunks>0,'surface not applied');
  assert(snapshot.surface.uvMode==='world-space-clamped','UV contract drifted');
  assert(snapshot.surface.runtimeTextureSize===(mobile?512:1024),'runtime texture size drifted');
  assert(snapshot.rts.drawCalls<(mobile?500:2500),`draw calls exceeded: ${snapshot.rts.drawCalls}`);
  assert(snapshot.rts.triangles<(mobile?500000:5000000),`triangles exceeded: ${snapshot.rts.triangles}`);
  assert(errors.length===0,`console/page errors: ${errors.join(' | ')}`);
  await context.close(); return snapshot;
}
async function warmOfflineProof(browser, base) {
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'allow'}); const page=await context.newPage(); const pageErrors=[]; const criticalFailures=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('requestfailed',r=>{ const p=decodeURIComponent(new URL(r.url()).pathname); if(['/rts.html','/src/rts/rtsSurfaceTexture.js','/assets/textures/yüzey/overlay/overlay.png'].includes(p)) criticalFailures.push(`${p}:${r.failure()?.errorText}`); });
  await page.goto(`${base}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null,null,{timeout:30000});
  await page.goto(`${base}/rts.html`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('body[data-rts-ready="true"]',{timeout:180000});
  await page.waitForFunction(()=>window.__WESTEROS_RTS_SURFACE__?.status==='ready',null,{timeout:120000});
  await page.waitForFunction(async()=>{const shell=await caches.open('westeros-shell-v11');const media=await caches.open('westeros-media-v4');return Boolean(await shell.match(new URL('./src/rts/rtsSurfaceTexture.js',location.href).href))&&Boolean(await media.match(new URL('./assets/textures/yüzey/overlay/overlay.png',location.href).href));},null,{timeout:30000});
  await context.setOffline(true); pageErrors.length=0; criticalFailures.length=0;
  await page.reload({waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('body[data-rts-ready="true"]',{timeout:180000});
  await page.waitForFunction(()=>window.__WESTEROS_RTS_SURFACE__?.status==='ready',null,{timeout:120000});
  const snapshot=await page.evaluate(()=>({surface:{...window.__WESTEROS_RTS_SURFACE__},rts:window.__WESTEROS_RTS__?.getSnapshot?.(),controlled:navigator.serviceWorker.controller!==null}));
  assert(snapshot.controlled,'offline page not SW controlled'); assert(snapshot.surface.appliedChunks>0,'offline surface not applied'); assert(pageErrors.length===0,`offline page errors: ${pageErrors.join(' | ')}`); assert(criticalFailures.length===0,`offline critical failures: ${criticalFailures.join(' | ')}`);
  await context.setOffline(false); await context.close(); return snapshot;
}
async function main(){const pw=playwrightModule();if(!pw)throw new Error('Playwright unavailable');const s=await server();const browser=await pw.chromium.launch({headless:true});const base=`http://127.0.0.1:${s.address().port}`;try{const desktop=await onlineProof(browser,base,false);const mobile=await onlineProof(browser,base,true);const offline=await warmOfflineProof(browser,base);console.log(`[checkRun210OwnerSurface] PROOF ${JSON.stringify({desktop,mobile,offline})}`);console.log('[checkRun210OwnerSurface] PASS');}finally{await browser.close();await new Promise(resolve=>s.close(resolve));}}
main().catch(error=>{console.error(`[checkRun210OwnerSurface] FAIL: ${error.stack||error}`);process.exitCode=1;});
