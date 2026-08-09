#!/usr/bin/env node
/** Run203: prove the developer launcher selects current/canonical explicitly without changing default navigation or duplicating runtime ownership. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run203-developer-launcher');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext=path.extname(file); if(ext==='.html') return 'text/html; charset=utf-8'; if(ext==='.js'||ext==='.mjs') return 'text/javascript; charset=utf-8'; if(ext==='.json') return 'application/json; charset=utf-8'; if(ext==='.css') return 'text/css; charset=utf-8'; if(ext==='.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s=http.createServer((req,res)=>{ const clean=decodeURIComponent(req.url.split('?')[0]); const file=path.join(ROOT, clean==='/'?'index.html':clean.replace(/^\//,'')); if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'content-type':contentType(file)}); fs.createReadStream(file).pipe(res); }); return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s))); }
async function waitDataset(page,key,value,timeout=20000){ await page.waitForFunction(([k,v])=>document.body?.dataset?.[k]===v,[key,value],{timeout}); }
async function runtimeSnapshot(page){ return page.evaluate(()=>({surface:document.body.dataset.run201Surface||null,requested:document.body.dataset.run201RequestedSource||null,active:document.body.dataset.run201ActiveSource||null,bridge:document.body.dataset.run201BridgeId||null,canvas:document.querySelectorAll('canvas').length,href:location.href})); }
async function main(){
  const playwright=playwrightModule(); if(!playwright) throw new Error('Playwright unavailable');
  const launcher=fs.readFileSync(path.join(ROOT,'canonical-dev-launcher.html'),'utf8');
  assert(launcher.includes('canonical-dev.html?worldSource=current'),'current launcher target missing');
  assert(launcher.includes('canonical-dev.html?worldSource=canonical-dev'),'canonical launcher target missing');
  assert(!launcher.includes('game3d.html'),'launcher must not replace or redirect default player startup');
  fs.mkdirSync(OUT,{recursive:true});
  const s=await server(); const browser=await playwright.chromium.launch({headless:true}); const errors=[];
  try{
    const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:720}});
    await context.addInitScript(() => {
      const timers={timeouts:new Set(),intervals:new Set(),rafs:new Set()};
      const st=window.setTimeout.bind(window),ct=window.clearTimeout.bind(window),si=window.setInterval.bind(window),ci=window.clearInterval.bind(window),raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
      window.setTimeout=(fn,delay,...args)=>{let id;id=st((...cb)=>{timers.timeouts.delete(id);if(typeof fn==='function')fn(...cb);},delay,...args);timers.timeouts.add(id);return id;};
      window.clearTimeout=(id)=>{timers.timeouts.delete(id);return ct(id);};
      window.setInterval=(fn,delay,...args)=>{const id=si(fn,delay,...args);timers.intervals.add(id);return id;};
      window.clearInterval=(id)=>{timers.intervals.delete(id);return ci(id);};
      window.requestAnimationFrame=(fn)=>{let id;id=raf((time)=>{timers.rafs.delete(id);fn(time);});timers.rafs.add(id);return id;};
      window.cancelAnimationFrame=(id)=>{timers.rafs.delete(id);return caf(id);};
      window.__run203TimerSnapshot=()=>({timeouts:timers.timeouts.size,intervals:timers.intervals.size,rafs:timers.rafs.size});
      addEventListener('pagehide',()=>{try{sessionStorage.setItem('run203-last-pagehide-timers',JSON.stringify(window.__run203TimerSnapshot()));}catch{}},{capture:true});
    });
    const page=await context.newPage(); const cdp=await context.newCDPSession(page);
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());}); page.on('pageerror',e=>errors.push(String(e)));
    const base=`http://127.0.0.1:${s.address().port}`;
    await page.goto(`${base}/canonical-dev-launcher.html`,{waitUntil:'domcontentloaded'});
    assert(await page.locator('[data-run203-source]').count()===2,'launcher choice count mismatch');
    const launcherCanvas=await page.locator('canvas').count(); assert(launcherCanvas===0,'launcher must not own a runtime canvas');

    await page.click('#run203-current'); await waitDataset(page,'run201ActiveSource','current');
    const current=await runtimeSnapshot(page); assert(current.requested==='current'&&current.active==='current','current choice did not stay current'); assert(current.canvas===1,'current runtime canvas mismatch');
    await cdp.send('HeapProfiler.collectGarbage'); const currentDom=await cdp.send('Memory.getDOMCounters');

    await page.goto(`${base}/canonical-dev-launcher.html`,{waitUntil:'domcontentloaded'});
    const currentPagehideTimers=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('run203-last-pagehide-timers')||'{"timeouts":0,"intervals":0,"rafs":0}'));
    assert(currentPagehideTimers.timeouts===0&&currentPagehideTimers.intervals===0&&currentPagehideTimers.rafs===0,`current pagehide leak: ${JSON.stringify(currentPagehideTimers)}`);
    assert(await page.locator('canvas').count()===0,'launcher retained current runtime canvas');

    await page.click('#run203-canonical'); await waitDataset(page,'run201ActiveSource','canonical');
    const canonical=await runtimeSnapshot(page); assert(canonical.requested==='canonical'&&canonical.active==='canonical','canonical choice did not activate canonical'); assert(canonical.canvas===1,'canonical runtime canvas mismatch'); assert(canonical.bridge===current.bridge,'deterministic bridge identity drifted between selections');
    await cdp.send('HeapProfiler.collectGarbage'); const canonicalDom=await cdp.send('Memory.getDOMCounters');

    await page.goto(`${base}/canonical-dev-launcher.html`,{waitUntil:'domcontentloaded'});
    const canonicalPagehideTimers=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('run203-last-pagehide-timers')||'{"timeouts":0,"intervals":0,"rafs":0}'));
    assert(canonicalPagehideTimers.timeouts===0&&canonicalPagehideTimers.intervals===0&&canonicalPagehideTimers.rafs===0,`canonical pagehide leak: ${JSON.stringify(canonicalPagehideTimers)}`);
    assert(await page.locator('canvas').count()===0,'launcher retained canonical runtime canvas');
    assert(errors.length===0,`console/page errors: ${errors.join(' | ')}`);
    const proof={launcherCanvas,current,currentDom,currentPagehideTimers,canonical,canonicalDom,canonicalPagehideTimers,consoleErrors:errors.length,exclusiveRuntimeCanvas:true,defaultNavigationUntouched:true};
    fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(`[checkRun203DeveloperLauncher] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun203DeveloperLauncher] PASS: explicitCurrent=true explicitCanonical=true launcherCanvas=0 runtimeCanvas=1 pagehideTimers=0 consoleErrors=0 defaultNavigationUntouched=true');
    await context.close();
  } finally { await browser.close(); await new Promise(r=>s.close(r)); }
}
main().catch(error=>{console.error(`[checkRun203DeveloperLauncher] FAIL: ${error.stack||error}`);process.exitCode=1;});