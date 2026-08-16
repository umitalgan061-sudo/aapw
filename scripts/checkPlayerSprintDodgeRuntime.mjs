#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-sprint-dodge');
const need = (ok, message) => { if (!ok) throw new Error(`[player-sprint-dodge] ${message}`); };

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
    if (window.__playerMotionFrames.length > 600) window.__playerMotionFrames.shift();
  });
});

const latest = () => page.evaluate(() => structuredClone(window.__playerMotionFrames.at(-1)));
const waitState = (state, timeout = 5000) => page.waitForFunction((expected) => window.__playerMotionFrames?.at(-1)?.state === expected, state, { timeout });
const distance = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await page.waitForFunction(() => window.__playerMotionFrames?.length > 0, null, { timeout: 15000 });

  const baseline = await latest();
  need(baseline.state === 'idle' && baseline.stamina === 100 && baseline.canDodge, `bad baseline ${JSON.stringify(baseline)}`);

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitState('sprint');
  const sprintA = await latest();
  await page.waitForTimeout(500);
  const sprintB = await latest();
  need(sprintB.stamina < sprintA.stamina, 'sprint did not drain stamina');
  need(sprintB.speedMps > 6 && distance(sprintB, sprintA) > 1.5, 'sprint displacement/speed too low');

  await page.keyboard.up('ShiftLeft');
  await waitState('walk');
  await page.keyboard.down('ShiftLeft');
  await waitState('sprint');
  await page.keyboard.up('ShiftLeft');
  await waitState('walk');
  const beforeDodge = await latest();
  await page.keyboard.down('ShiftLeft');
  await waitState('dodge');
  await page.waitForFunction((origin) => {
    const frame = window.__playerMotionFrames?.at(-1);
    return frame?.state === 'dodge' && Math.hypot(frame.position.x - origin.x, frame.position.z - origin.z) > 0.35;
  }, beforeDodge.position, { timeout: 2500 });
  const dodge = await latest();
  need(beforeDodge.stamina - dodge.stamina >= 27.8, 'dodge stamina cost missing');
  need(!dodge.canDodge && distance(dodge, beforeDodge) > 0.35, 'dodge readiness/displacement invalid');

  const vitals = await page.evaluate(() => ({
    state: document.querySelector('.g3d-stamina-bar')?.dataset.state,
    now: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-valuenow'),
    label: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-label'),
  }));
  need(vitals.state === 'dodge' && vitals.label === 'Dayanıklılık', `HUD not synchronized ${JSON.stringify(vitals)}`);

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await waitState('idle');
  const recoveryStart = await latest();
  await page.waitForTimeout(1000);
  const recoveryEnd = await latest();
  need(recoveryEnd.stamina > recoveryStart.stamina, 'idle stamina recovery failed');

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitState('sprint');
  const marker = await page.evaluate(() => window.__playerMotionFrames.length);
  await page.keyboard.press('Space');
  await waitState('airborne', 2500);
  await waitState('sprint', 2500);
  const airborne = await page.evaluate((start) => window.__playerMotionFrames.slice(start).filter((frame) => !frame.isGrounded), marker);
  need(airborne.length > 0, 'no airborne telemetry');
  for (let i = 1; i < airborne.length; i += 1) need(airborne[i].stamina <= airborne[i - 1].stamina + 0.01, 'airborne stamina regenerated under held run intent');

  await waitState('exhausted', 7000);
  const exhausted = await latest();
  need(exhausted.stamina === 0 && exhausted.sprintExhausted && exhausted.speedMps <= 4.2, `bad exhausted state ${JSON.stringify(exhausted)}`);
  await page.waitForTimeout(400);
  need((await latest()).stamina === 0, 'held run intent regenerated at zero stamina');

  await page.keyboard.up('ShiftLeft');
  await page.waitForFunction(() => {
    const frame = window.__playerMotionFrames?.at(-1);
    return frame?.stamina >= 20 && frame?.sprintExhausted === false;
  }, null, { timeout: 5000 });
  await page.keyboard.down('ShiftLeft');
  await waitState('sprint');
  const restarted = await latest();
  need(restarted.speedMps > 6, 'sprint did not restart after recovery threshold');

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  const canvasPng = await page.locator('#game3d-canvas').screenshot();
  fs.writeFileSync(path.join(outDir, 'player-runtime.png'), canvasPng);
  fs.writeFileSync(path.join(outDir, 'metrics.json'), `${JSON.stringify({ baseline, sprintA, sprintB, beforeDodge, dodge, recoveryEnd, exhausted, restarted, browserErrors: errors }, null, 2)}\n`);
  need(errors.length === 0, errors.join(' | '));
  console.log('PLAYER_SPRINT_DODGE_RUNTIME_OK');
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
