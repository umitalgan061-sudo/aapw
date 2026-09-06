#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-recovery-attack-buffer-runtime');
const need = (ok, message) => { if (!ok) throw new Error(`[player-recovery-attack-buffer-runtime] ${message}`); };
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
  window.__recoveryBufferMotion = [];
  window.__recoveryBufferWindows = [];
  window.__recoveryBufferInputs = [];
  window.addEventListener('aapw:player-motion', (event) => window.__recoveryBufferMotion.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-attack-window', (event) => window.__recoveryBufferWindows.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-combat-input', (event) => window.__recoveryBufferInputs.push(structuredClone(event.detail)));
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
  throw new Error(`[player-recovery-attack-buffer-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}
const motions = () => structuredClone(window.__recoveryBufferMotion);
const windows = () => structuredClone(window.__recoveryBufferWindows);
const inputs = () => structuredClone(window.__recoveryBufferInputs);

try {
  const gameUrl = `http://127.0.0.1:${server.address().port}/game3d.html`;
  await page.goto(gameUrl, { waitUntil: 'commit', timeout: 30000 });
  const entryButton = page.locator('#run266-entry-enter');
  await entryButton.waitFor({ state: 'visible', timeout: 30000 });
  await entryButton.click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  const baseline = await waitFor(motions, (history) => [...history].reverse().find((frame) => frame?.state === 'idle' && frame?.isGrounded && frame?.attackKind === 'none') ?? null, 'grounded idle baseline', 20000);

  const windowsBeforeInteraction = (await page.evaluate(windows)).length;
  const inputsBeforeInteraction = (await page.evaluate(inputs)).length;
  await page.keyboard.press('KeyE');
  await sleep(100);
  const windowsAfterInteraction = (await page.evaluate(windows)).length;
  const inputsAfterInteraction = (await page.evaluate(inputs)).length;
  need(inputsAfterInteraction === inputsBeforeInteraction, `reserved interaction key emitted combat input; before=${inputsBeforeInteraction} after=${inputsAfterInteraction}`);
  need(windowsAfterInteraction === windowsBeforeInteraction, `reserved interaction key opened an attack window; before=${windowsBeforeInteraction} after=${windowsAfterInteraction}`);

  await page.keyboard.down('KeyQ');
  const guarded = await waitFor(motions, (history) => [...history].reverse().find((frame) => frame?.state === 'guard' && frame?.guarding && frame?.attackKind === 'none') ?? null, 'held guard');
  const windowsBeforeBlockedIntent = (await page.evaluate(windows)).length;
  const inputsBeforeBlockedIntent = (await page.evaluate(inputs)).length;

  await page.keyboard.press('KeyC');
  await waitFor(inputs, (history) => history.length > inputsBeforeBlockedIntent && [...history].reverse().find((event) => event?.kind === 'light' && event?.source === 'keyboard'), 'blocked light combat intent');
  await sleep(80);
  await page.keyboard.up('KeyQ');
  const released = await waitFor(motions, (history) => [...history].reverse().find((frame) => !frame?.guarding && frame?.isGrounded) ?? null, 'guard release');

  await sleep(360);
  const windowsAfterBlockedIntent = await page.evaluate(windows);
  const afterBlockedIntent = await page.evaluate(() => structuredClone(window.__recoveryBufferMotion.at(-1)));
  need(windowsAfterBlockedIntent.length === windowsBeforeBlockedIntent, `guard-blocked attack intent must not survive release; before=${windowsBeforeBlockedIntent} after=${windowsAfterBlockedIntent.length}`);
  need(afterBlockedIntent?.attackKind === 'none' && afterBlockedIntent?.attackPhase === 'none', `guard-blocked input created a ghost attack ${JSON.stringify(afterBlockedIntent)}`);

  await page.keyboard.press('KeyC');
  const eligibleStart = await waitFor(windows, (history) => [...history].reverse().find((event) => event?.phase === 'start' && event?.kind === 'light') ?? null, 'eligible post-guard light attack');
  need(eligibleStart.comboStep === 1, `post-guard eligible attack must start a fresh combo ${JSON.stringify(eligibleStart)}`);

  const canvas = page.locator('#game3d-canvas');
  const box = await canvas.boundingBox();
  need(box && box.width > 100 && box.height > 100, 'invalid shipped canvas bounds');
  await page.screenshot({ path: path.join(outDir, 'recovery-attack-buffer-runtime.png'), clip: box });
  need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
  const metrics = {
    baseline,
    interactionReservation: {
      inputsBefore: inputsBeforeInteraction,
      inputsAfter: inputsAfterInteraction,
      windowsBefore: windowsBeforeInteraction,
      windowsAfter: windowsAfterInteraction,
    },
    guarded,
    released,
    afterBlockedIntent,
    eligibleStart,
    browserErrors: errors,
  };
  fs.writeFileSync(path.join(outDir, 'recovery-attack-buffer-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`PLAYER_RECOVERY_ATTACK_BUFFER_RUNTIME_OK ${JSON.stringify({ interactionCombatInputs: inputsAfterInteraction - inputsBeforeInteraction, blockedWindows: windowsAfterBlockedIntent.length - windowsBeforeBlockedIntent, eligibleSerial: eligibleStart.serial, errors: errors.length })}`);
} catch (error) {
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
