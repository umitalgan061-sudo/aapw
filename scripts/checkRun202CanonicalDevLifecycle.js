#!/usr/bin/env node
/** Run202: developer-only fallback matrix plus pagehide -> offline canonical reopen lifecycle proof. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run202-canonical-dev-lifecycle');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext=path.extname(file); if(ext==='.html') return 'text/html; charset=utf-8'; if(ext==='.js'||ext==='.mjs') return 'text/javascript; charset=utf-8'; if(ext==='.json') return 'application/json; charset=utf-8'; if(ext==='.css') return 'text/css; charset=utf-8'; if(ext==='.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s=http.createServer((req,res)=>{ const clean=decodeURIComponent(req.url.split('?')[0]); const file=path.join(ROOT, clean==='/'?'index.html':clean.replace(/^\//,'')); if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'content-type':contentType(file)}); fs.createReadStream(file).pipe(res); }); return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s))); }
async function waitForDataset(page,key,value,timeout=20000){ await page.waitForFunction(([k,v])=>document.body?.dataset?.[k]===v,[key,value],{timeout}); }
async function snapshot(page){ return page.evaluate(()=>({requested:document.body.dataset.run201RequestedSource,active:document.body.dataset.run201ActiveSource,offline:document.body.dataset.run201Offline,bridge:document.body.dataset.run201BridgeId,cacheReady:document.body.dataset.run201CacheReady||null,canvas:document.querySelectorAll('canvas').length,pagehideCount:Number(localStorage.getItem('run202-pagehide-count')||0)})); }
async function main(){
  const playwright=playwrightModule(); if(!playwright) throw new Error('Playwright unavailable');
  const bootSource=fs.readFileSync(path.join(ROOT,'scripts','run201CanonicalDevBoot.mjs'),'utf8');
  assert(bootSource.includes("addEventListener('pagehide'"),'Run201 pagehide lifecycle hook missing');
  for (const token of ['selector.rollbackToCurrent()','selector.dispose()','state.controls.dispose()','state.freeCamera.dispose()','state.chunkManager.disposeAll()','state.renderer.dispose()']) assert(bootSource.includes(token),`Run201 lifecycle disposal token missing: ${token}`);
  fs.mkdirSync(OUT,{recursive:true}); const s=await server(); const browser=await playwright.chromium.launch({headless:true}); const errors=[];
  try{
    const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:720}});
    await context.addInitScript(() => {
      const timers={timeouts:new Set(),intervals:new Set(),rafs:new Set()};
      const st=window.setTimeout.bind(window), ct=window.clearTimeout.bind(window), si=window.setInterval.bind(window), ci=window.clearInterval.bind(window), raf=window.requestAnimationFrame.bind(window), caf=window.cancelAnimationFrame.bind(window);
      window.setTimeout=(fn,delay,...args)=>{ let id; id=st((...cbArgs)=>{timers.timeouts.delete(id); if(typeof fn==='function') fn(...cbArgs);},delay,...args); timers.timeouts.add(id); return id; };
      window.clearTimeout=(id)=>{timers.timeouts.delete(id); return ct(id);};
      window.setInterval=(fn,delay,...args)=>{const id=si(fn,delay,...args); timers.intervals.add(id); return id;};
      window.clearInterval=(id)=>{timers.intervals.delete(id); return ci(id);};
      window.requestAnimationFrame=(fn)=>{let id; id=raf((time)=>{timers.rafs.delete(id); fn(time);}); timers.rafs.add(id); return id;};
      window.cancelAnimationFrame=(id)=>{timers.rafs.delete(id); return caf(id);};
      window.__run202TimerSnapshot=()=>({timeouts:timers.timeouts.size,intervals:timers.intervals.size,rafs:timers.rafs.size});
      addEventListener('pagehide',()=>{try{localStorage.setItem('run202-pagehide-count',String(Number(localStorage.getItem('run202-pagehide-count')||0)+1));}catch{}},{capture:true});
    });
    const page=await context.newPage(); const cdp=await context.newCDPSession(page);
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());}); page.on('pageerror',e=>errors.push(String(e)));
    const base=`http://127.0.0.1:${s.address().port}/canonical-dev.html`;
    const fallbackCases=[['default',''],['explicit-current','?worldSource=current'],['unknown','?worldSource=run202-unknown']]; const fallbacks=[];
    for (const [name,query] of fallbackCases){
      await page.goto(base+query,{waitUntil:'domcontentloaded',timeout:30000}); await waitForDataset(page,'run201ActiveSource','current');
      const state=await snapshot(page); assert(state.requested==='current'&&state.active==='current',`${name} did not preserve current fallback`); assert(state.canvas===1,`${name} canvas mismatch`); fallbacks.push({name,...state});
    }
    await page.goto(base+'?worldSource=canonical-dev',{waitUntil:'domcontentloaded',timeout:30000}); await waitForDataset(page,'run201ActiveSource','canonical'); await waitForDataset(page,'run201CacheReady','true');
    const onlineCanonical=await snapshot(page); assert(onlineCanonical.active==='canonical'&&onlineCanonical.canvas===1,'online canonical preparation failed');
    await page.evaluate(()=>{ addEventListener('pagehide',()=>{localStorage.setItem('run202-last-pagehide-timers',JSON.stringify(window.__run202TimerSnapshot()));},{once:true}); });
    await context.setOffline(true);
    const cycles=[];
    for(let cycle=1;cycle<=3;cycle++){
      await page.goto(base+'?worldSource=canonical-dev',{waitUntil:'domcontentloaded',timeout:30000}); await waitForDataset(page,'run201ActiveSource','canonical');
      const state=await snapshot(page); assert(state.offline==='true',`cycle ${cycle} offline signal missing`); assert(state.bridge===onlineCanonical.bridge,`cycle ${cycle} deterministic bridge drift`); assert(state.canvas===1,`cycle ${cycle} canvas mismatch`);
      const priorTimers=await page.evaluate(()=>JSON.parse(localStorage.getItem('run202-last-pagehide-timers')||'{"timeouts":0,"intervals":0,"rafs":0}'));
      assert(priorTimers.timeouts===0&&priorTimers.intervals===0&&priorTimers.rafs===0,`cycle ${cycle} pagehide timer leak: ${JSON.stringify(priorTimers)}`);
      await cdp.send('HeapProfiler.collectGarbage'); const dom=await cdp.send('Memory.getDOMCounters'); cycles.push({cycle,...state,dom,priorTimers});
      await page.evaluate(()=>{ addEventListener('pagehide',()=>{localStorage.setItem('run202-last-pagehide-timers',JSON.stringify(window.__run202TimerSnapshot()));},{once:true}); });
    }
    assert(cycles[0].pagehideCount>=4,'expected fallback/canonical pagehide transitions were not observed');
    const first=cycles[0].dom,last=cycles[cycles.length-1].dom;
    assert(last.documents<=first.documents+1,`document retention grew: ${first.documents} -> ${last.documents}`);
    assert(last.nodes<=first.nodes+80,`DOM node retention grew: ${first.nodes} -> ${last.nodes}`);
    assert(last.jsEventListeners<=first.jsEventListeners+10,`listener retention grew: ${first.jsEventListeners} -> ${last.jsEventListeners}`);
    assert(errors.length===0,`console/page errors: ${errors.join(' | ')}`);
    const proof={fallbacks,onlineCanonical,cycles,consoleErrors:errors.length,lifecycleDisposalTokens:true,retentionBounded:true}; fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(`[checkRun202CanonicalDevLifecycle] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun202CanonicalDevLifecycle] PASS: fallbackMatrix=true pagehideOfflineReopen=true timers=0 canvas=1 retentionBounded=true consoleErrors=0');
    await context.close();
  } finally { await browser.close(); await new Promise(r=>s.close(r)); }
}
main().catch(error=>{console.error(`[checkRun202CanonicalDevLifecycle] FAIL: ${error.stack||error}`);process.exitCode=1;});