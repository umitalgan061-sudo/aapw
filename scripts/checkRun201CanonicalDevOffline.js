#!/usr/bin/env node
/** Run201: real Chromium online warm -> offline reload proof for the opt-in canonical developer surface. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run201-canonical-dev-offline');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext=path.extname(file); if(ext==='.html') return 'text/html; charset=utf-8'; if(ext==='.js'||ext==='.mjs') return 'text/javascript; charset=utf-8'; if(ext==='.json') return 'application/json; charset=utf-8'; if(ext==='.css') return 'text/css; charset=utf-8'; if(ext==='.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s=http.createServer((req,res)=>{ const clean=decodeURIComponent(req.url.split('?')[0]); const file=path.join(ROOT, clean==='/'?'index.html':clean.replace(/^\//,'')); if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'content-type':contentType(file)}); fs.createReadStream(file).pipe(res); }); return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s))); }
async function waitForDataset(page,key,value,timeout=20000){ await page.waitForFunction(([k,v])=>document.body?.dataset?.[k]===v,[key,value],{timeout}); }
async function main(){
  const playwright=playwrightModule(); if(!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT,{recursive:true}); const s=await server(); const browser=await playwright.chromium.launch({headless:true}); const errors=[];
  try{
    const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:720}}); const page=await context.newPage();
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());}); page.on('pageerror',e=>errors.push(String(e)));
    const url=`http://127.0.0.1:${s.address().port}/canonical-dev.html?worldSource=canonical-dev`;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await waitForDataset(page,'run201ActiveSource','canonical');
    await waitForDataset(page,'run201CacheReady','true');
    const online=await page.evaluate(()=>({requested:document.body.dataset.run201RequestedSource,active:document.body.dataset.run201ActiveSource,offline:document.body.dataset.run201Offline,bridge:document.body.dataset.run201BridgeId,cacheReady:document.body.dataset.run201CacheReady,canvas:document.querySelectorAll('canvas').length}));
    assert(online.requested==='canonical'&&online.active==='canonical','online canonical opt-in failed'); assert(online.cacheReady==='true','dev surface cache not warmed'); assert(online.canvas===1,'online canvas mismatch');
    await context.setOffline(true); await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await waitForDataset(page,'run201ActiveSource','canonical');
    const offline=await page.evaluate(()=>({requested:document.body.dataset.run201RequestedSource,active:document.body.dataset.run201ActiveSource,offline:document.body.dataset.run201Offline,bridge:document.body.dataset.run201BridgeId,canvas:document.querySelectorAll('canvas').length}));
    assert(offline.requested==='canonical'&&offline.active==='canonical','offline canonical boot failed'); assert(offline.offline==='true','offline signal missing'); assert(offline.bridge===online.bridge,'deterministic bridge target drifted'); assert(offline.canvas===1,'offline canvas mismatch');
    assert(errors.length===0,`console/page errors: ${errors.join(' | ')}`);
    const proof={online,offline,consoleErrors:errors.length,deterministicBridge:offline.bridge===online.bridge}; fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(`[checkRun201CanonicalDevOffline] PROOF: ${JSON.stringify(proof)}`); console.log('[checkRun201CanonicalDevOffline] PASS: optInOnly=true onlineCanonical=true offlineCanonical=true deterministicBridge=true consoleErrors=0');
    await context.close();
  } finally { await browser.close(); await new Promise(r=>s.close(r)); }
}
main().catch(error=>{console.error(`[checkRun201CanonicalDevOffline] FAIL: ${error.stack||error}`);process.exitCode=1;});
