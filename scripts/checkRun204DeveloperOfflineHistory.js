#!/usr/bin/env node
/** Run204: prove developer launcher Current/Canonical history boundaries remain single-owner and restorable while Chromium is offline. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run204-developer-offline-history');
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext = path.extname(file); if (ext === '.html') return 'text/html; charset=utf-8'; if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8'; if (ext === '.json') return 'application/json; charset=utf-8'; if (ext === '.css') return 'text/css; charset=utf-8'; if (ext === '.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s = http.createServer((req, res) => { const clean = decodeURIComponent(req.url.split('?')[0]); const file = path.join(ROOT, clean === '/' ? 'index.html' : clean.replace(/^\//, '')); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'content-type': contentType(file) }); fs.createReadStream(file).pipe(res); }); return new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s))); }
async function waitActive(page, value, timeout = 20000) { await page.waitForFunction(v => document.body?.dataset?.run201ActiveSource === v, value, { timeout }); }
async function runtimeSnapshot(page) { return page.evaluate(() => ({ surface: document.body.dataset.run201Surface || null, requested: document.body.dataset.run201RequestedSource || null, active: document.body.dataset.run201ActiveSource || null, bridge: document.body.dataset.run201BridgeId || null, canvas: document.querySelectorAll('canvas').length, href: location.href })); }
async function runChoice(context, base, choiceId, expectedSource) {
  const errors = [];
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}/canonical-dev-launcher.html`, { waitUntil: 'domcontentloaded' });
  assert(await page.locator('canvas').count() === 0, `${expectedSource}: launcher owns canvas`);
  await page.click(choiceId);
  await waitActive(page, expectedSource);
  const online = await runtimeSnapshot(page);
  assert(online.canvas === 1, `${expectedSource}: online runtime canvas mismatch`);
  await context.setOffline(true);
  const back = await page.goBack({ waitUntil: 'domcontentloaded' });
  assert(back, `${expectedSource}: offline history back returned no response`);
  assert(page.url().includes('/canonical-dev-launcher.html'), `${expectedSource}: offline back did not return launcher`);
  assert(await page.locator('canvas').count() === 0, `${expectedSource}: launcher retained runtime canvas after offline back`);
  const pagehideTimers = await page.evaluate(() => JSON.parse(sessionStorage.getItem('run204-last-pagehide-timers') || '{"timeouts":0,"intervals":0,"rafs":0}'));
  assert(pagehideTimers.timeouts === 0 && pagehideTimers.intervals === 0 && pagehideTimers.rafs === 0, `${expectedSource}: pagehide timer leak ${JSON.stringify(pagehideTimers)}`);
  const forward = await page.goForward({ waitUntil: 'domcontentloaded' });
  assert(forward, `${expectedSource}: offline history forward returned no response`);
  await waitActive(page, expectedSource);
  const offlineForward = await runtimeSnapshot(page);
  assert(offlineForward.canvas === 1, `${expectedSource}: offline forward runtime canvas mismatch`);
  assert(offlineForward.bridge === online.bridge, `${expectedSource}: deterministic bridge drifted across offline history restore`);
  assert(errors.length === 0, `${expectedSource}: console/page errors ${errors.join(' | ')}`);
  await context.setOffline(false);
  await page.close();
  return { online, offlineForward, pagehideTimers, consoleErrors: errors.length };
}
async function main() {
  const playwright = playwrightModule(); if (!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const s = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      const timers = { timeouts: new Set(), intervals: new Set(), rafs: new Set() };
      const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window), si = window.setInterval.bind(window), ci = window.clearInterval.bind(window), raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
      window.setTimeout = (fn, delay, ...args) => { let id; id = st((...cb) => { timers.timeouts.delete(id); if (typeof fn === 'function') fn(...cb); }, delay, ...args); timers.timeouts.add(id); return id; };
      window.clearTimeout = id => { timers.timeouts.delete(id); return ct(id); };
      window.setInterval = (fn, delay, ...args) => { const id = si(fn, delay, ...args); timers.intervals.add(id); return id; };
      window.clearInterval = id => { timers.intervals.delete(id); return ci(id); };
      window.requestAnimationFrame = fn => { let id; id = raf(time => { timers.rafs.delete(id); fn(time); }); timers.rafs.add(id); return id; };
      window.cancelAnimationFrame = id => { timers.rafs.delete(id); return caf(id); };
      window.__run204TimerSnapshot = () => ({ timeouts: timers.timeouts.size, intervals: timers.intervals.size, rafs: timers.rafs.size });
      addEventListener('pagehide', () => { try { sessionStorage.setItem('run204-last-pagehide-timers', JSON.stringify(window.__run204TimerSnapshot())); } catch {} }, { capture: true });
    });
    const base = `http://127.0.0.1:${s.address().port}`;
    const current = await runChoice(context, base, '#run203-current', 'current');
    const canonical = await runChoice(context, base, '#run203-canonical', 'canonical');
    assert(current.online.bridge === canonical.online.bridge, 'current/canonical deterministic bridge identity mismatch');
    const proof = { current, canonical, launcherCanvas: 0, runtimeCanvas: 1, deterministicBridge: canonical.online.bridge, offlineHistoryBackForward: true, consoleErrors: current.consoleErrors + canonical.consoleErrors };
    fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(`[checkRun204DeveloperOfflineHistory] PROOF: ${JSON.stringify(proof)}`);
    console.log('[checkRun204DeveloperOfflineHistory] PASS: currentOfflineHistory=true canonicalOfflineHistory=true launcherCanvas=0 runtimeCanvas=1 pagehideTimers=0 consoleErrors=0');
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => s.close(resolve));
  }
}
main().catch(error => { console.error(`[checkRun204DeveloperOfflineHistory] FAIL: ${error.stack || error}`); process.exitCode = 1; });
