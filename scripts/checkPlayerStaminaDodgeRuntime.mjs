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
  staminaState: document.querySelector('.g3d-stamina-bar')?.dataset.state,
  staminaNow: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-valuenow'),
  staminaLabel: document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-label'),
  poiseState: document.querySelector('.g3d-poise-bar')?.dataset.state,
  poiseNow: document.querySelector('.g3d-poise-bar')?.getAttribute('aria-valuenow'),
  poiseLabel: document.querySelector('.g3d-poise-bar')?.getAttribute('aria-label'),
}));
const readHealth = () => page.evaluate(() => Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow')));
async function emitPlayerDamage(amount, sourceId) {
  await page.evaluate(async ({ amount: value, source }) => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    gameEvents.emit(EVENTS.PLAYER_DAMAGED, { amount: value, sourceId: source });
  }, { amount, source: sourceId });
}
async function emitPlayerDamageBurst(amount, count, sourcePrefix) {
  await page.evaluate(async ({ amount: value, count: total, sourcePrefix: prefix }) => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    for (let index = 0; index < total; index += 1) {
      gameEvents.emit(EVENTS.PLAYER_DAMAGED, { amount: value, sourceId: `${prefix}-${index}` });
    }
  }, { amount, count, sourcePrefix });
}
async function armDamageOnActiveParry(amount, sourceId) {
  await page.evaluate(async ({ amount: value, source }) => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    window.__parryProof = { armed: true, triggered: false, frame: null };
    const onMotion = (event) => {
      const frame = event?.detail;
      if (!frame || frame.state !== 'guard' || !frame.guarding || !(frame.parryWindowRemaining > 0)) return;
      window.removeEventListener('aapw:player-motion', onMotion);
      window.__parryProof.triggered = true;
      window.__parryProof.frame = structuredClone(frame);
      gameEvents.emit(EVENTS.PLAYER_DAMAGED, { amount: value, sourceId: source });
    };
    window.addEventListener('aapw:player-motion', onMotion);
  }, { amount, source: sourceId });
}
async function waitForHistoryEvidence(findEvidence, { timeout = 5000, interval = 100, label = 'motion evidence' } = {}) {
  const deadline = Date.now() + timeout; let lastFrames = [];
  while (Date.now() < deadline) { lastFrames = await history(); const evidence = findEvidence(lastFrames); if (evidence) return evidence; await sleep(interval); }
  throw new Error(`[player-stamina-dodge-runtime] timed out waiting for ${label}; tail=${JSON.stringify(lastFrames.slice(-12))}`);
}
const waitState = (state, timeout = 5000) => waitForHistoryEvidence((frames) => frames.at(-1)?.state === state ? frames.at(-1) : null, { timeout, interval: 100, label: `latest state=${state}` });
async function waitVitalsState(state, timeout = 3000) {
  const deadline = Date.now() + timeout; let last = null;
  while (Date.now() < deadline) { last = await readVitals(); if (last.staminaState === state) return last; await sleep(100); }
  throw new Error(`[player-stamina-dodge-runtime] timed out waiting for HUD state=${state}; last=${JSON.stringify(last)}`);
}
function findSprintEvidence(frames) {
  const origin = frames.find((frame) => frame?.state === 'sprint' && frame.speedMps > 6); if (!origin) return null;
  const displaced = [...frames].reverse().find((frame) => frame?.state === 'sprint' && frame.speedMps > 6 && frame.stamina < origin.stamina && Math.hypot(frame.position.x - origin.position.x, frame.position.z - origin.position.z) > 1.5);
  return displaced ? [origin, displaced] : null;
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await waitForHistoryEvidence((frames) => frames.length > 0 ? frames.at(-1) : null, { timeout: 15000, label: 'first player motion frame' });
  const baseline = await latest();
  need(baseline.state === 'idle', `expected idle baseline, got ${baseline.state}`);
  need(baseline.stamina === 100 && baseline.poise === 100 && baseline.isGrounded && baseline.canDodge, `bad baseline ${JSON.stringify(baseline)}`);

  await page.evaluate(() => { window.__playerMotionFrames.length = 0; });
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await waitState('sprint');
  const [sprintA, sprintB] = await waitForHistoryEvidence(findSprintEvidence, { timeout: 5000, interval: 100, label: 'sprint speed, stamina drain and >1.5m displacement' });
  need(sprintB.stamina < sprintA.stamina, 'sprint telemetry/drain missing'); need(distance(sprintA, sprintB) > 1.5 && sprintB.speedMps > 6, 'sprint displacement/speed too low');
  const beforeRunJumpDodge = await latest(); await page.keyboard.press('Space'); await waitState('dodge', 4000);
  const vitals = await waitVitalsState('dodge', 3000); need(vitals.staminaLabel === 'Dayanıklılık' && vitals.staminaNow && vitals.poiseLabel === 'Denge' && vitals.poiseNow, `HUD not synchronized ${JSON.stringify(vitals)}`);
  const runJumpDodge = await waitForHistoryEvidence((frames) => [...frames].reverse().find((candidate) => candidate?.state === 'dodge' && candidate.isGrounded && Math.hypot(candidate.position.x - beforeRunJumpDodge.position.x, candidate.position.z - beforeRunJumpDodge.position.z) > 0.3) ?? null, { timeout: 4000, interval: 100, label: 'grounded run+jump dodge displacement' });
  need(beforeRunJumpDodge.stamina - runJumpDodge.stamina >= 27.5, 'run+jump dodge stamina cost missing'); need(runJumpDodge.isGrounded && !runJumpDodge.canDodge, 'run+jump dodge must remain grounded and enter cooldown');
  await page.keyboard.up('ShiftLeft'); await waitState('walk', 4500); await sleep(700); await page.evaluate(() => { window.__playerMotionFrames.length = 0; }); await page.keyboard.press('Space');
  const airborneFrames = await waitForHistoryEvidence((frames) => { const airborne = frames.filter((frame) => frame && !frame.isGrounded); return airborne.length > 0 ? airborne : null; }, { timeout: 4500, interval: 100, label: 'plain jump airborne telemetry' });
  need(airborneFrames.every((frame) => frame.state !== 'dodge'), 'plain jump incorrectly became dodge without run intent');
  await page.keyboard.up('KeyW'); await waitState('idle', 6000); const recoveryStart = await latest();
  const recoveryEnd = await waitForHistoryEvidence((frames) => { const frame = frames.at(-1); return frame?.state === 'idle' && frame.stamina > recoveryStart.stamina ? frame : null; }, { timeout: 6000, interval: 100, label: 'idle stamina recovery after regen delay' });

  await page.keyboard.down('KeyQ');
  const guardReady = await waitForHistoryEvidence((frames) => { const frame = frames.at(-1); return frame?.state === 'guard' && frame.guarding && frame.parryWindowRemaining === 0 ? frame : null; }, { timeout: 12000, interval: 100, label: 'held guard after simulation-time parry window' });
  const guardHealthBefore = await readHealth();
  await emitPlayerDamage(20, 'guard-proof');
  const guardImpact = await waitForHistoryEvidence((frames) => [...frames].reverse().find((frame) => frame?.defenseResult === 'guard') ?? null, { timeout: 4000, interval: 50, label: 'guard damage mitigation telemetry' });
  const guardHealthAfter = await readHealth();
  need(guardHealthBefore - guardHealthAfter === 8, `guard should reduce 20 damage to 8, got health ${guardHealthBefore} -> ${guardHealthAfter}`);
  need(guardImpact.stamina < guardReady.stamina && guardImpact.poise < guardReady.poise, 'guard impact must spend stamina and poise');
  await page.keyboard.up('KeyQ'); await waitState('idle', 6000);

  await page.evaluate(() => { window.__playerMotionFrames.length = 0; });
  const parryHealthBefore = await readHealth();
  await armDamageOnActiveParry(20, 'parry-proof');
  await page.keyboard.down('KeyQ');
  const parryReady = await waitForHistoryEvidence((frames) => frames.find((frame) => frame?.state === 'guard' && frame.guarding && frame.parryWindowRemaining > 0) ?? null, { timeout: 6000, interval: 30, label: 'fresh parry window' });
  const parryImpact = await waitForHistoryEvidence((frames) => frames.find((frame) => frame?.defenseResult === 'parry') ?? null, { timeout: 4000, interval: 30, label: 'parry mitigation telemetry' });
  const parryProof = await page.evaluate(() => structuredClone(window.__parryProof));
  const parryHealthAfter = await readHealth();
  need(parryProof?.triggered && parryProof.frame?.parryWindowRemaining > 0, `parry damage must fire inside active window ${JSON.stringify(parryProof)}`);
  need(parryHealthAfter === parryHealthBefore, `parry must negate damage, got health ${parryHealthBefore} -> ${parryHealthAfter}`);
  need(parryReady.stamina - parryImpact.stamina >= 7.5 && parryImpact.poise === parryReady.poise, 'parry must cost stamina without poise damage');
  await page.keyboard.up('KeyQ'); await waitState('idle', 6000);

  // Isolate guard-break pressure from the earlier guard/parry poise spend without requiring a
  // wall-clock wait for a completely refilled stamina bar. Seven guarded 20-point impacts spend
  // 29.4 stamina in production; a >=40 stamina baseline is a real, bounded budget once the burst
  // is emitted synchronously inside one browser task, so render cadence cannot add unrelated guard drain.
  const pressureBaseline = await waitForHistoryEvidence((frames) => {
    const frame = frames.at(-1);
    return frame?.state === 'idle'
      && frame.guardBreakRemaining === 0
      && frame.stamina >= 40
      && frame.poise >= 99.5
      ? frame
      : null;
  }, { timeout: 20000, interval: 100, label: 'full poise and bounded stamina budget before guard-break pressure' });
  need(pressureBaseline.canDodge && !pressureBaseline.guarding, `pressure baseline must restore locomotion ${JSON.stringify(pressureBaseline)}`);
  await page.evaluate(() => { window.__playerMotionFrames.length = 0; });

  // Each real 20-point guarded hit blocks 12 damage, spends 4.2 stamina and removes 15 poise.
  // Emit all seven through the shipped EventBus in one browser task: production still publishes
  // one telemetry frame per impact, while headless render cadence cannot consume guard stamina
  // between otherwise independent assertion round-trips.
  await page.keyboard.down('KeyQ');
  const pressureReady = await waitForHistoryEvidence((frames) => { const frame = frames.at(-1); return frame?.state === 'guard' && frame.guarding && frame.parryWindowRemaining === 0 ? frame : null; }, { timeout: 12000, interval: 100, label: 'guard ready for poise pressure' });
  need(pressureReady.stamina >= 35 && pressureReady.poise >= 99.5, `poise pressure must start with the measured seven-hit resource budget ${JSON.stringify(pressureReady)}`);
  const breakHealthBefore = await readHealth();
  const marker = (await history()).length;
  await emitPlayerDamageBurst(20, 7, 'poise-break');
  const pressureImpacts = await waitForHistoryEvidence((frames) => {
    const impacts = frames.slice(marker).filter((frame) => frame?.defenseResult === 'guard' || frame?.state === 'guard-break');
    return impacts.length >= 7 && impacts.some((frame) => frame.state === 'guard-break' && frame.poise === 0) ? impacts.slice(0, 7) : null;
  }, { timeout: 4000, interval: 40, label: 'seven synchronous real poise-pressure impacts' });
  const breakFrame = pressureImpacts.find((frame) => frame.state === 'guard-break') ?? null;
  need(pressureImpacts.length === 7, `expected seven real guarded pressure impacts, got ${pressureImpacts.length}`);
  for (let hit = 0; hit < 6; hit += 1) {
    const impact = pressureImpacts[hit];
    need(impact?.defenseResult === 'guard', `pressure hit ${hit + 1} must be a guarded impact ${JSON.stringify(impact)}`);
    need(impact.poise <= pressureReady.poise - (14.5 * (hit + 1)), `pressure hit ${hit + 1} missing poise loss ${JSON.stringify(impact)}`);
  }
  need(breakFrame?.state === 'guard-break' && breakFrame.poise === 0 && breakFrame.guardBreakRemaining > 0, `guard break missing ${JSON.stringify(breakFrame)}`);
  need(!breakFrame.guarding && !breakFrame.canDodge, 'guard break must lock guard/dodge');
  const breakVitals = await readVitals();
  need(breakVitals.poiseState === 'guard-break' && breakVitals.poiseLabel === 'Denge', `poise HUD must show break ${JSON.stringify(breakVitals)}`);
  const breakHealthAfter = await readHealth();
  need(breakHealthBefore - breakHealthAfter === 56, `pressure sequence must apply seven real mitigated hits (expected 56 health), got ${breakHealthBefore} -> ${breakHealthAfter}`);
  await page.keyboard.up('KeyQ');
  const recoveredPoise = await waitForHistoryEvidence((frames) => { const frame = frames.at(-1); return frame?.guardBreakRemaining === 0 && frame.poise > 0 && frame.state !== 'guard-break' ? frame : null; }, { timeout: 10000, interval: 100, label: 'guard-break recovery and poise regeneration' });
  need(recoveredPoise.poise > 0 && recoveredPoise.canDodge, 'poise recovery must restore locomotion eligibility');

  const canvas = page.locator('#game3d-canvas');
  const canvasBox = await canvas.boundingBox();
  need(canvasBox && canvasBox.width > 100 && canvasBox.height > 100, `bad canvas bounds ${JSON.stringify(canvasBox)}`);
  const canvasPng = await page.screenshot({ clip: canvasBox, timeout: 20000 });
  need(canvasPng.length > 1024, `canvas proof too small (${canvasPng.length} bytes)`);
  fs.writeFileSync(path.join(outDir, 'player-runtime.png'), canvasPng);
  fs.writeFileSync(path.join(outDir, 'metrics.json'), `${JSON.stringify({
    baseline, sprintA, sprintB, beforeRunJumpDodge, runJumpDodge, airborneFrames: airborneFrames.slice(0, 8), recoveryStart, recoveryEnd, vitals,
    guard: { ready: guardReady, impact: guardImpact, healthBefore: guardHealthBefore, healthAfter: guardHealthAfter },
    parry: { ready: parryReady, impact: parryImpact, trigger: parryProof?.frame ?? null, healthBefore: parryHealthBefore, healthAfter: parryHealthAfter },
    poise: { baseline: pressureBaseline, ready: pressureReady, impacts: pressureImpacts, break: breakFrame, recovered: recoveredPoise, healthBefore: breakHealthBefore, healthAfter: breakHealthAfter, hud: breakVitals },
    canvas: { width: canvasBox.width, height: canvasBox.height, pngBytes: canvasPng.length }, browserErrors: errors,
  }, null, 2)}\n`);
  need(errors.length === 0, errors.join(' | '));
  console.log('PLAYER_STAMINA_DODGE_GUARD_PARRY_POISE_RUNTIME_OK');
} catch (error) {
  const frames = await history().catch(() => []);
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors, recentFrames: frames.slice(-50) }, null, 2)}\n`);
  throw error;
} finally {
  await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
}