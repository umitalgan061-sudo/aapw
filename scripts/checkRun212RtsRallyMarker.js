#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run212');
const assert = (value, message) => { if (!value) throw new Error(message); };
const playwright = (() => { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; })();

function type(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.gltf':'model/gltf+json'})[ext] || 'application/octet-stream';
}

function serve() {
  const s = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const rel = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'content-type': type(file), 'cache-control': 'no-store'});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s)));
}

async function prove(browser, base, mobile, errors) {
  const context = await browser.newContext(mobile ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2} : {viewport:{width:1440,height:900}});
  const page = await context.newPage();
  const label = mobile ? 'mobile' : 'desktop';
  page.on('console', m => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${label} pageerror: ${String(e)}`));
  try {
    await page.goto(`${base}/rts.html`, {waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForSelector('body[data-rts-ready="true"]', {timeout:180000});
    await page.waitForFunction(() => window.__WESTEROS_RTS_RALLY__?.getSnapshot && window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, {timeout:60000});
    const box = await page.locator('#rts-canvas').boundingBox();
    assert(box, `${label} canvas missing`);
    await page.mouse.click(box.x + box.width * 0.61, box.y + box.height * 0.57, {button:'right'});
    await page.waitForFunction(() => window.__WESTEROS_RTS_RALLY__.getSnapshot().visible === true, null, {timeout:10000});
    const active = await page.evaluate(() => ({marker:window.__WESTEROS_RTS_RALLY__.getSnapshot(),rts:window.__WESTEROS_RTS__.getSnapshot(),status:document.getElementById('rts-status')?.textContent || ''}));
    assert(active.marker.opacity > 0.1, `${label} marker opacity too low`);
    assert(Number.isFinite(active.marker.position.y), `${label} marker Y non-finite`);
    assert(active.status.includes('asker hedefe ilerliyor'), `${label} command ownership/status drifted`);
    assert(active.rts.selectedCount === 48, `${label} selection drifted`);
    assert(active.rts.drawCalls < (mobile ? 500 : 2500), `${label} draw calls exceeded`);
    assert(active.rts.triangles < (mobile ? 500000 : 5000000), `${label} triangles exceeded`);
    await page.screenshot({path:path.join(ARTIFACT_DIR, `${label}-rally-marker.png`), fullPage:true});
    await page.waitForTimeout(1900);
    const expired = await page.evaluate(() => window.__WESTEROS_RTS_RALLY__.getSnapshot());
    assert(expired.visible === false, `${label} marker did not expire`);
    return {active, expired};
  } finally { await context.close(); }
}

(async () => {
  if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, {recursive:true});
  const server = await serve();
  const browser = await playwright.chromium.launch({headless:true});
  const errors = [];
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const desktop = await prove(browser, base, false, errors);
    const mobile = await prove(browser, base, true, errors);
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    const proof = {desktop,mobile,errors,visualEvidence:['desktop-rally-marker.png','mobile-rally-marker.png']};
    fs.writeFileSync(path.join(ARTIFACT_DIR,'proof.json'), JSON.stringify(proof,null,2));
    console.log(`[checkRun212RtsRallyMarker] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun212RtsRallyMarker] PASS: bounded world-space rally marker preserves command ownership, desktop/mobile budgets and zero console/page errors');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(`[checkRun212RtsRallyMarker] FAIL: ${error.stack || error}`); process.exitCode = 1; });
