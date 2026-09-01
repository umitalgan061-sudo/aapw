#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-touch-combat-runtime');
const need = (ok, message) => { if (!ok) throw new Error(`[player-touch-combat-runtime] ${message}`); };
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
await page.addInitScript(() => {
  window.__touchMotion = [];
  window.__touchInputs = [];
  window.__touchWindows = [];
  window.__touchLocks = [];
  window.addEventListener('aapw:player-motion', (event) => window.__touchMotion.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-combat-input', (event) => window.__touchInputs.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-attack-window', (event) => window.__touchWindows.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-lock-on', (event) => window.__touchLocks.push(structuredClone(event.detail)));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read, predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(read);
    const found = predicate(last);
    if (found) return found;
    await sleep(40);
  }
  throw new Error(`[player-touch-combat-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}
const motions = () => structuredClone(window.__touchMotion);
const inputs = () => structuredClone(window.__touchInputs);
const windows = () => structuredClone(window.__touchWindows);
const locks = () => structuredClone(window.__touchLocks);

try {
  const gameUrl = `http://127.0.0.1:${server.address().port}/game3d.html`;
  await page.goto(gameUrl, { waitUntil: 'commit', timeout: 30000 });
  const entryButton = page.locator('#run266-entry-enter');
  await entryButton.waitFor({ state: 'visible', timeout: 30000 });
  await entryButton.click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  const baseline = await waitFor(motions, (history) => [...history].reverse().find((frame) => frame?.state === 'idle' && frame?.isGrounded && frame?.attackKind === 'none') ?? null, 'grounded mobile idle', 20000);

  const guardButton = page.locator('.g3d-touch-guard-button');
  const lightButton = page.locator('.g3d-touch-light-attack-button');
  const heavyButton = page.locator('.g3d-touch-heavy-attack-button');
  const lockButton = page.locator('.g3d-touch-lock-on-button');
  for (const [label, button] of [['guard', guardButton], ['light', lightButton], ['heavy', heavyButton], ['lock-on', lockButton]]) {
    await button.waitFor({ state: 'visible', timeout: 10000 });
    need(await button.isEnabled(), `${label} touch control disabled`);
  }

  await guardButton.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, buttons: 1 });
  const guarded = await waitFor(motions, (history) => [...history].reverse().find((frame) => frame?.state === 'guard' && frame?.guarding && frame?.isGrounded) ?? null, 'touch guard state');
  need(await guardButton.getAttribute('aria-pressed') === 'true', 'touch guard aria state did not become pressed');

  const blockedWindowCount = (await page.evaluate(windows)).length;
  const blockedInputCount = (await page.evaluate(inputs)).length;
  await lightButton.dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: true, buttons: 1 });
  const blockedIntent = await waitFor(
    inputs,
    (history) => history.length > blockedInputCount
      ? [...history].reverse().find((event) => event?.kind === 'light' && event?.source === 'touch') ?? null
      : null,
    'touch light intent while guarding',
  );
  await sleep(120);
  need((await page.evaluate(windows)).length === blockedWindowCount, 'guarded touch light opened an attack window');

  await guardButton.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch', isPrimary: true, buttons: 0 });
  const released = await waitFor(motions, (history) => [...history].reverse().find((frame) => !frame?.guarding && frame?.isGrounded) ?? null, 'touch guard release');
  need(await guardButton.getAttribute('aria-pressed') === 'false', 'touch guard aria state did not release');
  await sleep(360);
  need((await page.evaluate(windows)).length === blockedWindowCount, 'blocked touch intent survived guard release');

  await lightButton.dispatchEvent('pointerdown', { pointerId: 43, pointerType: 'touch', isPrimary: true, buttons: 1 });
  const lightStart = await waitFor(windows, (history) => [...history].reverse().find((event) => event?.phase === 'start' && event?.kind === 'light') ?? null, 'eligible touch light attack');
  need(lightStart.comboStep === 1, `touch light must start fresh combo: ${JSON.stringify(lightStart)}`);

  const lockCount = (await page.evaluate(locks)).length;
  await lockButton.dispatchEvent('pointerdown', { pointerId: 44, pointerType: 'touch', isPrimary: true, buttons: 1 });
  const lockEvent = await waitFor(locks, (history) => history.length > lockCount ? history.at(-1) : null, 'touch lock-on response');
  need(typeof lockEvent?.locked === 'boolean', `invalid touch lock-on event: ${JSON.stringify(lockEvent)}`);

  const canvas = page.locator('#game3d-canvas');
  const box = await canvas.boundingBox();
  need(box && box.width > 100 && box.height > 100, 'invalid mobile shipped canvas bounds');
  await page.screenshot({ path: path.join(outDir, 'touch-combat-runtime.png'), clip: box });
  need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
  const metrics = { baseline, guarded, blockedIntent, released, lightStart, lockEvent, browserErrors: errors };
  fs.writeFileSync(path.join(outDir, 'touch-combat-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`PLAYER_TOUCH_COMBAT_RUNTIME_OK ${JSON.stringify({ source: blockedIntent.source, lightComboStep: lightStart.comboStep, lockState: lockEvent.locked, errors: errors.length })}`);
} catch (error) {
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
