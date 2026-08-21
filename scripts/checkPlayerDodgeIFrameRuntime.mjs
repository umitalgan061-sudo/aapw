#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-dodge-iframes');
const need = (ok, message) => { if (!ok) throw new Error(`[player-dodge-iframes-runtime] ${message}`); };
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

await page.addInitScript(() => {
  window.__iframeMotion = [];
  window.__iframeProof = { activeHit: null, recoveryHit: null };
  window.addEventListener('aapw:player-motion', (event) => {
    window.__iframeMotion.push(structuredClone(event.detail));
    if (window.__iframeMotion.length > 900) window.__iframeMotion.shift();
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readHealth = () => page.evaluate(() => Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow')));
const readMotion = () => page.evaluate(() => structuredClone(window.__iframeMotion ?? []));
async function waitFor(read, predicate, label, timeout = 8000, interval = 30) {
  const deadline = Date.now() + timeout; let last = null;
  while (Date.now() < deadline) {
    last = await read();
    const evidence = predicate(last);
    if (evidence) return evidence;
    await sleep(interval);
  }
  throw new Error(`[player-dodge-iframes-runtime] timed out waiting for ${label}; last=${JSON.stringify(last?.slice?.(-12) ?? last)}`);
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await waitFor(readMotion, (frames) => frames.at(-1)?.state === 'idle' ? frames.at(-1) : null, 'grounded idle baseline', 30000);

  const healthBefore = await readHealth();
  need(healthBefore > 40, `unexpected baseline health ${healthBefore}`);

  await page.evaluate(async () => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    let activeSent = false;
    let recoverySent = false;
    const onMotion = (event) => {
      const frame = event?.detail;
      if (!frame || frame.state !== 'dodge') return;
      if (!activeSent && frame.dodgeInvulnerable) {
        activeSent = true;
        const payload = { amount: 20, sourceId: 'iframe-active-proof' };
        gameEvents.emit(EVENTS.PLAYER_DAMAGED, payload);
        window.__iframeProof.activeHit = { frame: structuredClone(frame), payload: structuredClone(payload) };
        return;
      }
      if (activeSent && !recoverySent && !frame.dodgeInvulnerable && frame.dodgeElapsedSeconds >= 0.24 && frame.dodgeRemaining > 0) {
        recoverySent = true;
        const payload = { amount: 20, sourceId: 'iframe-recovery-proof' };
        gameEvents.emit(EVENTS.PLAYER_DAMAGED, payload);
        window.__iframeProof.recoveryHit = { frame: structuredClone(frame), payload: structuredClone(payload) };
        window.removeEventListener('aapw:player-motion', onMotion);
      }
    };
    window.addEventListener('aapw:player-motion', onMotion);
  });

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitFor(readMotion, (frames) => frames.at(-1)?.state === 'sprint' ? frames.at(-1) : null, 'sprint before dodge');
  await page.keyboard.press('Space');

  const proof = await waitFor(
    () => page.evaluate(() => structuredClone(window.__iframeProof)),
    (value) => value?.activeHit && value?.recoveryHit ? value : null,
    'active and recovery dodge impacts',
    6000,
    20,
  );
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  const healthAfter = await readHealth();

  need(proof.activeHit.frame.dodgeInvulnerable === true, `active proof missed iframe ${JSON.stringify(proof.activeHit)}`);
  need(proof.activeHit.frame.dodgeElapsedSeconds >= 0.06 && proof.activeHit.frame.dodgeElapsedSeconds < 0.24, `active iframe timing out of bounds ${JSON.stringify(proof.activeHit.frame)}`);
  need(proof.activeHit.payload.mitigation === 'dodge' && proof.activeHit.payload.amount === 0 && proof.activeHit.payload.blockedAmount === 20, `active dodge did not negate damage ${JSON.stringify(proof.activeHit.payload)}`);
  need(proof.recoveryHit.frame.dodgeInvulnerable === false && proof.recoveryHit.frame.dodgeRemaining > 0, `recovery proof must remain inside dodge but outside iframes ${JSON.stringify(proof.recoveryHit.frame)}`);
  need(proof.recoveryHit.payload.mitigation === undefined && proof.recoveryHit.payload.amount === 20, `recovery damage must remain vulnerable ${JSON.stringify(proof.recoveryHit.payload)}`);
  need(healthBefore - healthAfter === 20, `exactly one 20-damage hit must apply: ${healthBefore} -> ${healthAfter}`);
  need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);

  const metrics = {
    ok: true,
    health: { before: healthBefore, after: healthAfter },
    active: proof.activeHit,
    recovery: proof.recoveryHit,
    browserErrors: errors,
  };
  fs.writeFileSync(path.join(outDir, 'dodge-iframes-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  await page.screenshot({ path: path.join(outDir, 'dodge-iframes-runtime.png'), fullPage: true });
  console.log(`PLAYER_DODGE_IFRAMES_RUNTIME_OK ${JSON.stringify({ activeElapsed: proof.activeHit.frame.dodgeElapsedSeconds, recoveryElapsed: proof.recoveryHit.frame.dodgeElapsedSeconds, healthBefore, healthAfter })}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
