#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-stamina-dodge');
const need = (ok, message) => { if (!ok) throw new Error(`[player-stamina-dodge-runtime] ${message}`); };
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
  window.__playerMotionFrames = [];
  window.addEventListener('aapw:player-motion', (event) => {
    window.__playerMotionFrames.push(structuredClone(event.detail));
    if (window.__playerMotionFrames.length > 720) window.__playerMotionFrames.shift();
  });
});

const latest = () => page.evaluate(() => structuredClone(window.__playerMotionFrames.at(-1)));
const history = () => page.evaluate(() => structuredClone(window.__playerMotionFrames ?? []));
const distance = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readVitals = () => page.evaluate(() => ({
  state: document.querySelector('.g3d-stamina-bar')?.dataset.state,
  now: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-valuenow'),
  label: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-label'),
}));

async function waitForHistoryEvidence(findEvidence, { timeout = 5000, interval = 100, label = 'motion evidence' } = {}) {
  const deadline = Date.now() + timeout;
  let lastFrames = [];
  while (Date.now() < deadline) {
    lastFrames = await history();
    const evidence = findEvidence(lastFrames);
    if (evidence) return evidence;
    await sleep(interval);
  }
  throw new Error(`[player-stamina-dodge-runtime] timed out waiting for ${label}; tail=${JSON.stringify(lastFrames.slice(-12))}`);
}

const waitState = (state, timeout = 5000) => waitForHistoryEvidence((frames) => {
  const frame = frames.at(-1);
  return frame?.state === state ? frame : null;
}, { timeout, interval: 100, label: `latest state=${state}` });

async function waitVitalsState(state, timeout = 3000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await readVitals();
    if (last.state === state) return last;
    await sleep(100);
  }
  throw new Error(`[player-stamina-dodge-runtime] timed out waiting for HUD state=${state}; last=${JSON.stringify(last)}`);
}

function findSprintEvidence(frames) {
  const origin = frames.find((frame) => frame?.state === 'sprint' && frame.speedMps > 6);
  if (!origin) return null;
  const displaced = [...frames].reverse().find((frame) => frame?.state === 'sprint'
    && frame.speedMps > 6
    && frame.stamina < origin.stamina
    && Math.hypot(frame.position.x - origin.position.x, frame.position.z - origin.position.z) > 1.5);
  return displaced ? [origin, displaced] : null;
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await waitForHistoryEvidence((frames) => frames.length > 0 ? frames.at(-1) : null, { timeout: 15000, label: 'first player motion frame' });

  const baseline = await latest();
  need(baseline.state === 'idle', `expected idle baseline, got ${baseline.state}`);
  need(baseline.stamina === 100 && baseline.isGrounded && baseline.canDodge, `bad baseline ${JSON.stringify(baseline)}`);

  await page.evaluate(() => { window.__playerMotionFrames.length = 0; });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitState('sprint');
  const [sprintA, sprintB] = await waitForHistoryEvidence(findSprintEvidence, {
    timeout: 5000,
    interval: 100,
    label: 'sprint speed, stamina drain and >1.5m displacement',
  });
  need(sprintB.stamina < sprintA.stamina, 'sprint telemetry/drain missing');
  need(distance(sprintA, sprintB) > 1.5 && sprintB.speedMps > 6, 'sprint displacement/speed too low');

  const beforeRunJumpDodge = await latest();
  await page.keyboard.press('Space');
  await waitState('dodge', 4000);
  const vitals = await waitVitalsState('dodge', 3000);
  need(vitals.label === 'Dayanıklılık' && vitals.now, `HUD not synchronized ${JSON.stringify(vitals)}`);
  const runJumpDodge = await waitForHistoryEvidence((frames) => {
    const frame = [...frames].reverse().find((candidate) => candidate?.state === 'dodge'
      && candidate.isGrounded
      && Math.hypot(candidate.position.x - beforeRunJumpDodge.position.x, candidate.position.z - beforeRunJumpDodge.position.z) > 0.3);
    return frame ?? null;
  }, { timeout: 4000, interval: 100, label: 'grounded run+jump dodge displacement' });
  need(beforeRunJumpDodge.stamina - runJumpDodge.stamina >= 27.5, 'run+jump dodge stamina cost missing');
  need(runJumpDodge.isGrounded && !runJumpDodge.canDodge, 'run+jump dodge must remain grounded and enter cooldown');

  await page.keyboard.up('ShiftLeft');
  await waitState('walk', 4500);
  await sleep(700);
  await page.evaluate(() => { window.__playerMotionFrames.length = 0; });
  await page.keyboard.press('Space');
  const airborneFrames = await waitForHistoryEvidence((frames) => {
    const airborne = frames.filter((frame) => frame && !frame.isGrounded);
    return airborne.length > 0 ? airborne : null;
  }, { timeout: 4500, interval: 100, label: 'plain jump airborne telemetry' });
  need(airborneFrames.every((frame) => frame.state !== 'dodge'), 'plain jump incorrectly became dodge without run intent');

  await page.keyboard.up('KeyW');
  await waitState('idle', 6000);
  const recoveryStart = await latest();
  const recoveryEnd = await waitForHistoryEvidence((frames) => {
    const frame = frames.at(-1);
    return frame?.state === 'idle' && frame.stamina > recoveryStart.stamina ? frame : null;
  }, { timeout: 6000, interval: 100, label: 'idle stamina recovery after regen delay' });

  const canvasPng = await page.locator('#game3d-canvas').screenshot();
  fs.writeFileSync(path.join(outDir, 'player-runtime.png'), canvasPng);
  fs.writeFileSync(path.join(outDir, 'metrics.json'), `${JSON.stringify({
    baseline,
    sprintA,
    sprintB,
    beforeRunJumpDodge,
    runJumpDodge,
    airborneFrames: airborneFrames.slice(0, 8),
    recoveryStart,
    recoveryEnd,
    vitals,
    browserErrors: errors,
  }, null, 2)}\n`);
  need(errors.length === 0, errors.join(' | '));
  console.log('PLAYER_STAMINA_DODGE_RUNTIME_OK');
} catch (error) {
  const frames = await history().catch(() => []);
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors, recentFrames: frames.slice(-50) }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
