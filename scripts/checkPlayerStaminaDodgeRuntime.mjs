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
const waitState = (state, timeout = 5000) => page.waitForFunction(
  (expected) => window.__playerMotionFrames?.at(-1)?.state === expected,
  state,
  { timeout },
);
const distance = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await page.waitForFunction(() => window.__playerMotionFrames?.length > 0, null, { timeout: 15000 });

  const baseline = await latest();
  need(baseline.state === 'idle', `expected idle baseline, got ${baseline.state}`);
  need(baseline.stamina === 100 && baseline.isGrounded && baseline.canDodge, `bad baseline ${JSON.stringify(baseline)}`);

  const sprintMarker = await page.evaluate(() => window.__playerMotionFrames.length);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitState('sprint');
  await page.waitForFunction((start) => {
    const frames = window.__playerMotionFrames?.slice(start) ?? [];
    const origin = frames.find((frame) => frame?.state === 'sprint' && frame.speedMps > 6);
    if (!origin) return false;
    return frames.some((frame) => frame?.state === 'sprint'
      && frame.speedMps > 6
      && frame.stamina < origin.stamina
      && Math.hypot(frame.position.x - origin.position.x, frame.position.z - origin.position.z) > 1.5);
  }, sprintMarker, { timeout: 3000 });
  const [sprintA, sprintB] = await page.evaluate((start) => {
    const frames = window.__playerMotionFrames?.slice(start) ?? [];
    const origin = frames.find((frame) => frame?.state === 'sprint' && frame.speedMps > 6);
    const displaced = [...frames].reverse().find((frame) => frame?.state === 'sprint'
      && frame.speedMps > 6
      && frame.stamina < origin.stamina
      && Math.hypot(frame.position.x - origin.position.x, frame.position.z - origin.position.z) > 1.5);
    return [structuredClone(origin), structuredClone(displaced)];
  }, sprintMarker);
  need(sprintA && sprintB && sprintB.stamina < sprintA.stamina, 'sprint telemetry/drain missing');
  need(distance(sprintA, sprintB) > 1.5 && sprintB.speedMps > 6, 'sprint displacement/speed too low');

  const beforeRunJumpDodge = await latest();
  await page.keyboard.press('Space');
  await waitState('dodge', 2500);
  await page.waitForFunction((origin) => {
    const frame = window.__playerMotionFrames?.at(-1);
    return frame?.state === 'dodge'
      && frame.isGrounded
      && Math.hypot(frame.position.x - origin.x, frame.position.z - origin.z) > 0.3;
  }, beforeRunJumpDodge.position, { timeout: 2500 });
  const runJumpDodge = await latest();
  need(beforeRunJumpDodge.stamina - runJumpDodge.stamina >= 27.5, 'run+jump dodge stamina cost missing');
  need(runJumpDodge.isGrounded && !runJumpDodge.canDodge, 'run+jump dodge must remain grounded and enter cooldown');

  const vitals = await page.evaluate(() => ({
    state: document.querySelector('.g3d-stamina-bar')?.dataset.state,
    now: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-valuenow'),
    label: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-label'),
  }));
  need(vitals.state === 'dodge' && vitals.label === 'Dayanıklılık' && vitals.now, `HUD not synchronized ${JSON.stringify(vitals)}`);

  await page.keyboard.up('ShiftLeft');
  await waitState('walk', 3000);
  await page.waitForTimeout(700);
  const jumpMarker = await page.evaluate(() => window.__playerMotionFrames.length);
  await page.keyboard.press('Space');
  await page.waitForFunction((start) => (window.__playerMotionFrames?.slice(start) ?? []).some((frame) => frame && !frame.isGrounded), jumpMarker, { timeout: 2500 });
  const airborneFrames = await page.evaluate((start) => window.__playerMotionFrames.slice(start).filter((frame) => frame && !frame.isGrounded), jumpMarker);
  need(airborneFrames.length > 0, 'plain jump did not become airborne');
  need(airborneFrames.every((frame) => frame.state !== 'dodge'), 'plain jump incorrectly became dodge without run intent');

  await page.keyboard.up('KeyW');
  await waitState('idle', 4000);
  const recoveryStart = await latest();
  await page.waitForTimeout(1000);
  const recoveryEnd = await latest();
  need(recoveryEnd.stamina > recoveryStart.stamina, 'idle stamina recovery failed');

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
  const frames = await page.evaluate(() => structuredClone(window.__playerMotionFrames ?? [])).catch(() => []);
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors, recentFrames: frames.slice(-50) }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
