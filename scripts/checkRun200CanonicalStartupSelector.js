#!/usr/bin/env node
/** Run200: explicit startup-source selection + reversible fallback preflight. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run200-canonical-startup-selector');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function server() {
  const html = '<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"./src/3d/vendor/three/three.module.js","three/addons/":"./src/3d/vendor/three/addons/"}}</script></head><body></body></html>';
  const s = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/' || clean === '/run200.html') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(html); return; }
    const file = path.join(ROOT, clean.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file); const type = ext === '.js' || ext === '.mjs' ? 'text/javascript; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, {'content-type':type}); fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}
async function main() {
  const playwright = playwrightModule(); if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, {recursive:true}); const s = await server(); const browser = await playwright.chromium.launch({headless:true}); const errors=[];
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}}); page.on('console', m => { if (m.type()==='error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${s.address().port}/run200.html`, {waitUntil:'domcontentloaded', timeout:15000});
    const proof = await page.evaluate(async () => {
      window.matchMedia = (query) => ({matches:query.includes('pointer: coarse'),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}});
      const { createScene } = await import('/src/3d/sceneManager.js');
      const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
      const { RUN200_STARTUP_POLICY, resolveRun200StartupSource, createRun200StartupSelector } = await import('/scripts/run200CanonicalStartupSelectorShadow.mjs');
      if (resolveRun200StartupSource('') !== RUN200_STARTUP_POLICY.current) throw new Error('default source must remain current');
      if (resolveRun200StartupSource('?worldSource=canonical-dev') !== RUN200_STARTUP_POLICY.canonical) throw new Error('explicit opt-in not resolved');
      if (resolveRun200StartupSource('?worldSource=canonical') !== RUN200_STARTUP_POLICY.current) throw new Error('unknown value must not guess canonical');
      const makeState = () => { const canvas=document.createElement('canvas'); document.body.appendChild(canvas); const state=createScene(canvas); state.renderer.setPixelRatio(1); state.renderer.setSize(800,500,false); return {state,canvas}; };
      const target = buildClippedBridgeOwnershipTargets().slice().sort((a,b)=>a.bridgeId.localeCompare(b.bridgeId))[0];
      const first = makeState(); const currentCollider = first.state.groundCollider;
      const canonical = createRun200StartupSelector({state:first.state, search:'?worldSource=canonical-dev', bridgeId:target.bridgeId, profile:'mobile'});
      if (canonical.requestedSource !== 'canonical' || canonical.getActiveSource() !== 'canonical') throw new Error('canonical source not active before simulation handoff');
      if (canonical.getGroundCollider() === currentCollider) throw new Error('canonical collider ownership not selected');
      first.state.renderer.render(first.state.scene, first.state.camera); const budget={calls:first.state.renderer.info.render.calls,triangles:first.state.renderer.info.render.triangles};
      if (budget.calls >= 500 || budget.triangles >= 500000) throw new Error(`canonical startup budget exceeded ${JSON.stringify(budget)}`);
      const rollback = canonical.rollbackToCurrent(); if (!rollback?.canonicalDisposed?.disposed || canonical.getActiveSource() !== 'current' || canonical.getGroundCollider() !== currentCollider) throw new Error('rollback failed');
      canonical.dispose(); if (!canonical.isDisposed()) throw new Error('selector dispose failed'); first.state.controls.dispose(); first.state.freeCamera.dispose(); first.state.chunkManager.disposeAll(); first.state.renderer.dispose(); first.canvas.remove();
      const second = makeState(); const secondCollider = second.state.groundCollider;
      const fallback = createRun200StartupSelector({state:second.state, search:'?worldSource=canonical-dev', bridgeId:'run200-invalid-bridge', profile:'mobile'});
      if (fallback.requestedSource !== 'canonical' || fallback.getActiveSource() !== 'current' || !fallback.fallbackReason || fallback.getGroundCollider() !== secondCollider) throw new Error('failed canonical request did not preserve current fallback');
      fallback.dispose(); second.state.controls.dispose(); second.state.freeCamera.dispose(); second.state.chunkManager.disposeAll(); second.state.renderer.dispose(); second.canvas.remove();
      const third = makeState(); const explicitCurrent = createRun200StartupSelector({state:third.state, search:'', bridgeId:target.bridgeId, profile:'mobile'});
      if (explicitCurrent.requestedSource !== 'current' || explicitCurrent.getActiveSource() !== 'current') throw new Error('default startup drifted');
      explicitCurrent.dispose(); third.state.controls.dispose(); third.state.freeCamera.dispose(); third.state.chunkManager.disposeAll(); third.state.renderer.dispose(); third.canvas.remove();
      return {policy:RUN200_STARTUP_POLICY.key,targetBridgeId:target.bridgeId,budget,fallbackReason:fallback.fallbackReason,canvasCount:document.querySelectorAll('canvas').length};
    });
    assert(proof.canvasCount===0, `canvas leak ${proof.canvasCount}`); assert(errors.length===0, `console/page errors: ${errors.join(' | ')}`);
    fs.writeFileSync(path.join(OUT,'proof.json'), JSON.stringify({...proof,consoleErrors:errors.length},null,2)+'\n');
    console.log(`[checkRun200CanonicalStartupSelector] PROOF: ${JSON.stringify(proof)}`);
    console.log(`[checkRun200CanonicalStartupSelector] PASS: explicitOptIn=true defaultCurrent=true invalidFallback=current rollback=true consoleErrors=${errors.length}`);
  } finally { await browser.close(); await new Promise(r=>s.close(r)); }
}
main().catch((error)=>{ console.error(`[checkRun200CanonicalStartupSelector] FAIL: ${error.stack||error}`); process.exitCode=1; });
