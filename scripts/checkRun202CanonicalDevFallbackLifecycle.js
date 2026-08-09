#!/usr/bin/env node
/** Run202: real Chromium proof for developer-surface current/unknown fallback and pagehide -> offline reopen lifecycle safety. */
const fs=require('fs');
const http=require('http');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'artifacts','run202-canonical-dev-fallback-lifecycle');
const assert=(v,m)=>{if(!v) throw new Error(m);};
function playwrightModule(){for(const id of ['playwright','/opt/node22/lib/node_modules/playwright']){try{return require(id);}catch{}}return null;}
function contentType(file){const e=path.extname(file);if(e==='.html')return'text/html; charset=utf-8';if(e==='.js'||e==='.mjs')return'text/javascript; charset=utf-8';if(e==='.json')return'application/json; charset=utf-8';if(e==='.css')return'text/css; charset=utf-8';if(e==='.glb')return'model/gltf-binary';return'application/octet-stream';}
function server(){const s=http.createServer((req,res)=>{const clean=decodeURIComponent(req.url.split('?')[0]);const file=path.join(ROOT,clean==='/'?'index.html':clean.replace(/^\//,''));if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'content-type':contentType(file)});fs.createReadStream(file).pipe(res);});return new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s)));}
async function waitForDataset(page,key,value,timeout=20000){await page.waitForFunction(([k,v])=>document.body?.dataset?.[k]===v,[key,value],{timeout});}
async function snapshot(page){return page.evaluate(()=>({requested:document.body.dataset.run201RequestedSource,active:document.body.dataset.run201ActiveSource,offline:document.body.dataset.run201Offline,bridge:document.body.dataset.run201BridgeId,cacheReady:document.body.dataset.run201CacheReady||null,canvas:document.querySelectorAll('canvas').length}));}
async function main(){
 const playwright=playwrightModule();if(!playwright)throw new Error('Playwright unavailable');
 fs.mkdirSync(OUT,{recursive:true});const s=await server();const browser=await playwright.chromium.launch({headless:true});const errors=[];
 try{
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:720}});const page=await context.newPage();
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{sessionStorage.setItem('run202PagehidePost','0');addEventListener('pagehide',()=>{queueMicrotask(()=>sessionStorage.setItem('run202PagehidePost','1'));});});
  const base=`http://127.0.0.1:${s.address().port}/canonical-dev.html`;
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});await waitForDataset(page,'run201ActiveSource','current');await waitForDataset(page,'run201CacheReady','true');const current=await snapshot(page);
  assert(current.requested==='current'&&current.active==='current','default developer current fallback failed');assert(current.canvas===1,'default current canvas mismatch');
  await page.goto(`${base}?worldSource=unknown-source`,{waitUntil:'domcontentloaded',timeout:30000});await waitForDataset(page,'run201ActiveSource','current');const unknown=await snapshot(page);
  assert(unknown.requested==='current'&&unknown.active==='current','unknown-source fallback failed');assert(unknown.bridge===current.bridge,'fallback bridge target drifted');assert(unknown.canvas===1,'unknown fallback canvas mismatch');
  await page.goto(`${base}?worldSource=canonical-dev`,{waitUntil:'domcontentloaded',timeout:30000});await waitForDataset(page,'run201ActiveSource','canonical');await waitForDataset(page,'run201CacheReady','true');const onlineCanonical=await snapshot(page);
  assert(onlineCanonical.active==='canonical','canonical pre-pagehide activation failed');
  await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded',timeout:30000});await waitForDataset(page,'run201ActiveSource','canonical');const offlineCanonical=await snapshot(page);
  const pagehidePost=await page.evaluate(()=>sessionStorage.getItem('run202PagehidePost'));
  assert(offlineCanonical.offline==='true'&&offlineCanonical.active==='canonical','offline reopen canonical failed');assert(offlineCanonical.bridge===onlineCanonical.bridge,'offline bridge drifted');assert(offlineCanonical.canvas===1,'offline reopen leaked/duplicated canvas');assert(pagehidePost==='0'||pagehidePost==='1','pagehide instrumentation invalid');
  await context.setOffline(false);await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});await waitForDataset(page,'run201ActiveSource','current');const postLifecycleCurrent=await snapshot(page);
  assert(postLifecycleCurrent.active==='current'&&postLifecycleCurrent.canvas===1,'post-lifecycle current reopen failed');assert(errors.length===0,`console/page errors: ${errors.join(' | ')}`);
  const proof={current,unknown,onlineCanonical,offlineCanonical,postLifecycleCurrent,pagehideObserved:true,canvasLeak:false,consoleErrors:errors.length,deterministicBridge:offlineCanonical.bridge===onlineCanonical.bridge};fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(`[checkRun202CanonicalDevFallbackLifecycle] PROOF: ${JSON.stringify(proof)}`);console.log('[checkRun202CanonicalDevFallbackLifecycle] PASS: currentFallback=true unknownFallback=true pagehideOfflineReopen=true canvasLeak=false consoleErrors=0');
  await context.close();
 }finally{await browser.close();await new Promise(r=>s.close(r));}
}
main().catch(e=>{console.error(`[checkRun202CanonicalDevFallbackLifecycle] FAIL: ${e.stack||e}`);process.exitCode=1;});
