#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-guard-impact-exhaustion-runtime');
const need = (ok, message) => { if (!ok) throw new Error(`[player-guard-impact-runtime] ${message}`); };
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
  window.__guardImpactFrames = [];
  window.addEventListener('aapw:player-motion', (event) => {
    window.__guardImpactFrames.push(structuredClone(event.detail));
    if (window.__guardImpactFrames.length > 720) window.__guardImpactFrames.shift();
  });
});
const history = () => page.evaluate(() => structuredClone(window.__guardImpactFrames ?? []));
const readHealth = () => page.evaluate(() => Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow')));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitEvidence(findEvidence, { timeout = 10000, interval = 50, label = 'evidence' } = {}) {
  const deadline = Date.now() + timeout;
  let frames = [];
  while (Date.now() < deadline) {
    frames = await history();
    const evidence = findEvidence(frames);
    if (evidence) return evidence;
    await sleep(interval);
  }
  frames = await history();
  const boundaryEvidence = findEvidence(frames);
  if (boundaryEvidence) return boundaryEvidence;
  throw new Error(`[player-guard-impact-runtime] timed out waiting for ${label}; tail=${JSON.stringify(frames.slice(-12))}`);
}
async function waitHealth(expected, { timeout = 3000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  let health = await readHealth();
  while (Date.now() < deadline) {
    if (health === expected) return health;
    await sleep(interval);
    health = await readHealth();
  }
  throw new Error(`[player-guard-impact-runtime] timed out waiting for health=${expected}; current=${health}`);
}
async function isolateDamageSource(sourceId) {
  await page.evaluate(async (allowedSourceId) => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    if (window.__guardImpactOriginalEmit) return;
    const originalEmit = gameEvents.emit.bind(gameEvents);
    window.__guardImpactOriginalEmit = originalEmit;
    gameEvents.emit = (eventName, payload) => {
      if (eventName === EVENTS.PLAYER_DAMAGED && payload?.sourceId !== allowedSourceId) return undefined;
      return originalEmit(eventName, payload);
    };
  }, sourceId);
}
async function armDamageOnGuard(amount, sourceId, maxGuardStamina) {
  await page.evaluate(async ({ amount: value, source, maxStamina }) => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    window.__guardImpactArmed = true;
    const onMotion = (event) => {
      const frame = event?.detail;
      if (!window.__guardImpactArmed || frame?.state !== 'guard' || !frame.guarding || frame.parryWindowRemaining !== 0) return;
      if (!(frame.stamina > 0 && frame.stamina <= maxStamina && frame.poise > 20)) return;
      window.__guardImpactArmed = false;
      window.removeEventListener('aapw:player-motion', onMotion);
      gameEvents.emit(EVENTS.PLAYER_DAMAGED, { amount: value, sourceId: source });
    };
    window.addEventListener('aapw:player-motion', onMotion);
  }, { amount, source: sourceId, maxStamina: maxGuardStamina });
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await isolateDamageSource('stamina-only-impact-break');
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  const baseline = await waitEvidence((frames) => {
    const frame = frames.at(-1);
    return frame?.state === 'idle' && frame.stamina === 100 && frame.poise === 100 && frame.isGrounded && frame.guardBreakRemaining === 0 ? frame : null;
  }, { timeout: 15000, interval: 100, label: 'full idle baseline' });
  need(baseline.stamina === 100 && baseline.poise === 100, `bad baseline ${JSON.stringify(baseline)}`);

  await page.evaluate(() => { window.__guardImpactFrames.length = 0; });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await waitEvidence((frames) => frames.at(-1)?.state === 'sprint' ? frames.at(-1) : null,
    { timeout: 5000, interval: 30, label: 'initial real sprint input' });

  // Headless Chromium advances the shipped simulation substantially slower than wall time on shared
  // runners. Spend stamina through two existing real run+jump dodges, then use sustained real sprint
  // for the final low-stamina approach. Each setup dodge must return to authored grounded/canDodge
  // eligibility before the next Space press; an airborne sprint telemetry frame is not a valid re-arm.
  const setupDodges = [];
  for (let index = 0; index < 2; index += 1) {
    await waitEvidence((frames) => [...frames].reverse().find((frame) => frame?.state === 'sprint' && frame.isGrounded && frame.canDodge) ?? null,
      { timeout: 7000, interval: 30, label: `grounded dodge-ready sprint before setup dodge ${index + 1}` });
    await page.evaluate(() => { window.__guardImpactFrames.length = 0; });
    await page.keyboard.press('Space');
    const dodge = await waitEvidence((frames) => frames.at(-1)?.state === 'dodge' ? frames.at(-1) : null,
      { timeout: 5000, interval: 30, label: `setup dodge ${index + 1}` });
    setupDodges.push(dodge);
    await waitEvidence((frames) => {
      const lastDodgeIndex = frames.findLastIndex((frame) => frame?.state === 'dodge');
      return lastDodgeIndex >= 0
        ? frames.slice(lastDodgeIndex + 1).find((frame) => frame?.state === 'sprint' && frame.isGrounded && frame.canDodge) ?? null
        : null;
    }, { timeout: 7000, interval: 30, label: `grounded dodge-ready sprint after setup dodge ${index + 1}` });
  }
  need(setupDodges.length === 2 && setupDodges.every((frame) => frame.isGrounded && frame.stamina >= 0), `setup dodges must stay on the shipped grounded dodge path ${JSON.stringify(setupDodges)}`);

  const lowSprint = await waitEvidence((frames) => [...frames].reverse().find((frame) => frame?.state === 'sprint' && frame.stamina > 5 && frame.stamina < 8 && frame.poise > 20) ?? null,
    { timeout: 24000, interval: 30, label: 'low-stamina sprint with enough poise to survive the guarded impact' });
  need(lowSprint.poise > 20, `sprint setup must retain enough poise for a stamina-only break ${JSON.stringify(lowSprint)}`);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');

  await page.evaluate(() => { window.__guardImpactFrames.length = 0; });
  const healthBefore = await readHealth();
  need(Number.isFinite(healthBefore), `health HUD unavailable before impact: ${healthBefore}`);
  // A 20-damage guarded hit blocks 12 damage and therefore spends 4.2 stamina. Arm the hit inside
  // the shipped telemetry callback so it lands on the first real guard frame at/below that budget,
  // before the next frame's authored 11/s hold-drain can independently exhaust guard.
  await armDamageOnGuard(20, 'stamina-only-impact-break', 4.2);
  await page.keyboard.down('KeyQ');
  const guardReady = await waitEvidence((frames) => [...frames].reverse().find((frame) => frame?.state === 'guard' && frame.guarding && frame.parryWindowRemaining === 0 && frame.stamina > 0 && frame.stamina <= 4.2 && frame.poise > 20) ?? null,
    { timeout: 2500, interval: 20, label: 'impact-armed low-stamina guard with positive post-impact poise budget' });
  const guardBreak = await waitEvidence((frames) => [...frames].reverse().find((frame) => frame?.state === 'guard-break' && frame.defenseResult === 'guard-break' && frame.guardBreakRemaining > 0) ?? null,
    { timeout: 3000, interval: 20, label: 'stamina-only guard-break result' });
  const expectedHealth = healthBefore - 8;
  const healthAfter = await waitHealth(expectedHealth);
  await page.keyboard.up('KeyQ');

  need(healthBefore - healthAfter === 8, `breaking guarded hit must still apply mitigated 20 -> 8 damage, got ${healthBefore} -> ${healthAfter}`);
  need(guardBreak.stamina === 0, `impact must exhaust stamina ${JSON.stringify(guardBreak)}`);
  need(guardBreak.poise > 0, `guard break must be stamina-only while poise remains positive ${JSON.stringify(guardBreak)}`);
  need(guardBreak.poise < guardReady.poise, `guarded impact must still spend poise ${JSON.stringify({ guardReady, guardBreak })}`);
  need(!guardBreak.guarding && guardBreak.parryWindowRemaining === 0, `guard break must drop guard/parry ${JSON.stringify(guardBreak)}`);
  need(errors.length === 0, `browser errors: ${errors.join(' | ')}`);

  const metrics = {
    ok: true,
    contract: 'player-guard-impact-exhaustion-runtime',
    isolatedDamageSource: 'stamina-only-impact-break',
    baseline,
    setupDodges,
    lowSprint,
    guardReady,
    guardBreak,
    health: { before: healthBefore, after: healthAfter, applied: healthBefore - healthAfter },
    browserErrors: errors,
  };
  fs.writeFileSync(path.join(outDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  await page.screenshot({ path: path.join(outDir, 'player-runtime.png'), fullPage: false });
  console.log(JSON.stringify(metrics, null, 2));
} catch (error) {
  let motionTail = [];
  let health = null;
  try { motionTail = (await history()).slice(-24); } catch {}
  try { health = await readHealth(); } catch {}
  try { await page.screenshot({ path: path.join(outDir, 'failure.png'), fullPage: false }); } catch {}
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({
    error: String(error?.stack ?? error),
    health,
    motionTail,
    browserErrors: errors,
  }, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
