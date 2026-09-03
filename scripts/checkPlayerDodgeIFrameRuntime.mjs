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
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function armDamageProbe({ amount, phase }) {
  await page.evaluate(async ({ amount: value, phase: expectedPhase }) => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    window.__dodgeDamageProbe = { armed: true, triggered: false, phase: expectedPhase };
    const onMotion = (event) => {
      const frame = event?.detail;
      if (!frame || frame.state !== 'dodge') return;
      const isTarget = expectedPhase === 'iframe'
        ? frame.isDodgeInvulnerable === true
        : frame.isDodgeInvulnerable === false && frame.dodgeElapsed > 0.28;
      if (!isTarget) return;
      window.removeEventListener('aapw:player-motion', onMotion);
      const before = Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow'));
      const payload = { amount: value, sourceId: `dodge-${expectedPhase}-proof` };
      gameEvents.emit(EVENTS.PLAYER_DAMAGED, payload);
      const after = Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow'));
      window.__dodgeDamageProbe = {
        armed: true,
        triggered: true,
        phase: expectedPhase,
        before,
        after,
        payload: structuredClone(payload),
        frame: structuredClone(frame),
      };
    };
    window.addEventListener('aapw:player-motion', onMotion);
  }, { amount, phase });
}

async function waitProbe(timeout = 5000) {
  const deadline = Date.now() + timeout;
  let proof = null;
  while (Date.now() < deadline) {
    proof = await page.evaluate(() => structuredClone(window.__dodgeDamageProbe ?? null));
    if (proof?.triggered) return proof;
    await sleep(40);
  }
  throw new Error(`[player-dodge-iframes-runtime] timed out; proof=${JSON.stringify(proof)}`);
}

async function waitIdle(timeout = 8000) {
  await page.waitForFunction(() => document.querySelector('.g3d-stamina-bar')?.dataset.state === 'idle', null, { timeout });
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'commit', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await waitIdle(30000);

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => document.querySelector('.g3d-stamina-bar')?.dataset.state === 'sprint', null, { timeout: 15000 });
  await armDamageProbe({ amount: 20, phase: 'iframe' });
  await page.keyboard.press('Space');
  const iframeProof = await waitProbe();
  need(iframeProof.frame.isDodgeInvulnerable === true, `expected i-frame telemetry ${JSON.stringify(iframeProof.frame)}`);
  need(iframeProof.frame.dodgeElapsed >= 0.06 && iframeProof.frame.dodgeElapsed < 0.28, `i-frame outside contract ${iframeProof.frame.dodgeElapsed}`);
  need(iframeProof.before === iframeProof.after, `i-frame should negate health loss ${iframeProof.before} -> ${iframeProof.after}`);
  need(iframeProof.payload.amount === 0 && iframeProof.payload.rawAmount === 20 && iframeProof.payload.blockedAmount === 20 && iframeProof.payload.mitigation === 'dodge', `bad i-frame payload ${JSON.stringify(iframeProof.payload)}`);

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await waitIdle();
  await sleep(900);

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => document.querySelector('.g3d-stamina-bar')?.dataset.state === 'sprint', null, { timeout: 15000 });
  await armDamageProbe({ amount: 7, phase: 'recovery' });
  await page.keyboard.press('Space');
  const recoveryProof = await waitProbe();
  need(recoveryProof.frame.isDodgeInvulnerable === false && recoveryProof.frame.dodgeElapsed > 0.28, `expected punishable recovery ${JSON.stringify(recoveryProof.frame)}`);
  need(recoveryProof.before - recoveryProof.after === 7, `recovery should take full damage ${recoveryProof.before} -> ${recoveryProof.after}`);
  need(recoveryProof.payload.amount === 7 && recoveryProof.payload.mitigation === undefined, `recovery damage must not be rewritten ${JSON.stringify(recoveryProof.payload)}`);

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: path.join(outDir, 'dodge-iframes-runtime.png'), fullPage: false });
  const metrics = { iframeProof, recoveryProof, browserErrors: errors };
  fs.writeFileSync(path.join(outDir, 'dodge-iframes-runtime.json'), JSON.stringify(metrics, null, 2));
  need(errors.length === 0, `browser errors: ${JSON.stringify(errors)}`);
  console.log('PLAYER_DODGE_IFRAMES_RUNTIME_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
