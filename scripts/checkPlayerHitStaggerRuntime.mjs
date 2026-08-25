#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-hit-stagger');
const need = (ok, message) => { if (!ok) throw new Error(`[player-hit-stagger-runtime] ${message}`); };
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
  window.__hitStaggerMotion = [];
  window.__hitStaggerAttack = [];
  window.__hitStaggerFeedback = [];
  window.addEventListener('aapw:player-motion', (event) => window.__hitStaggerMotion.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-attack-window', (event) => window.__hitStaggerAttack.push(structuredClone(event.detail)));
  window.addEventListener('aapw:player-combat-feedback', (event) => window.__hitStaggerFeedback.push(structuredClone(event.detail)));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(find, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const evidence = await page.evaluate(find);
    if (evidence) return evidence;
    await sleep(50);
  }
  throw new Error(`[player-hit-stagger-runtime] timed out waiting for ${label}`);
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  const baseline = await waitFor(() => {
    const frame = window.__hitStaggerMotion.at(-1);
    return frame?.state === 'idle' && frame?.isGrounded && frame?.poise >= 99.5 ? structuredClone(frame) : null;
  }, 'grounded full-poise idle baseline', 20000);
  await page.evaluate(() => {
    window.__hitStaggerMotion.length = 0;
    window.__hitStaggerAttack.length = 0;
    window.__hitStaggerFeedback.length = 0;
    window.dispatchEvent(new CustomEvent('aapw:player-combat-input', { detail: { kind: 'light' } }));
  });
  const active = await waitFor(() => {
    const frame = window.__hitStaggerMotion.find((item) => item?.state === 'attack-light' && item?.attackPhase === 'active');
    return frame ? structuredClone(frame) : null;
  }, 'active light attack');
  await page.evaluate(async () => {
    const [{ gameEvents }, { EVENTS }] = await Promise.all([import('./src/3d/eventBus.js'), import('./src/3d/config.js')]);
    for (let index = 0; index < 4; index += 1) gameEvents.emit(EVENTS.PLAYER_DAMAGED, { amount: 25, sourceId: `hit-stagger-proof-${index}` });
  });
  const proof = await waitFor(() => {
    const staggerIndex = window.__hitStaggerMotion.findIndex((item) => item?.state === 'hit-stagger' && item?.defenseResult === 'hit-stagger');
    const stagger = staggerIndex >= 0 ? window.__hitStaggerMotion[staggerIndex] : null;
    const respawn = staggerIndex >= 0
      ? window.__hitStaggerMotion.slice(staggerIndex + 1).find((item) => item?.state === 'idle' && item?.stamina === 100 && item?.poise === 100 && item?.hitStaggerRemaining === 0 && item?.guardBreakRemaining === 0)
      : null;
    const interrupted = window.__hitStaggerAttack.find((item) => item?.phase === 'interrupted');
    const lethalFeedback = [...window.__hitStaggerFeedback].reverse().find((item) => item?.outcome === 'hit-stagger' && item?.appliedAmount > 0);
    return stagger && respawn && interrupted && lethalFeedback
      ? {
          stagger: structuredClone(stagger),
          respawn: structuredClone(respawn),
          interrupted: structuredClone(interrupted),
          lethalFeedback: structuredClone(lethalFeedback),
          motions: structuredClone(window.__hitStaggerMotion),
          attacks: structuredClone(window.__hitStaggerAttack),
          feedback: structuredClone(window.__hitStaggerFeedback),
        }
      : null;
  }, 'hit stagger, lethal feedback, interrupted attack and defeat reset');
  need(proof.stagger.poise === 35, `expected authored poise recovery 35 before respawn, got ${proof.stagger.poise}`);
  need(proof.stagger.hitStaggerRemaining > 0 && proof.stagger.hitStaggerRemaining <= 0.32, `bad stagger duration ${proof.stagger.hitStaggerRemaining}`);
  need(proof.stagger.attackKind === 'none' && proof.stagger.attackRemaining === 0 && proof.stagger.attackComboStep === 0, 'stagger must clear attack state');
  need(proof.stagger.canDodge === false && proof.stagger.guarding === false, 'stagger must lock dodge and guard');
  need(proof.interrupted.kind === 'light' && proof.interrupted.active === false, 'interruption must terminate the active light attack');
  need(proof.lethalFeedback.appliedAmount === 25, `lethal feedback must report the final clamped 25 health removed, got ${proof.lethalFeedback.appliedAmount}`);
  need(proof.lethalFeedback.state === 'hit-stagger' && proof.lethalFeedback.poise === 35, `deferred lethal feedback must preserve impact-time state instead of respawn state ${JSON.stringify(proof.lethalFeedback)}`);
  need(proof.respawn.state === 'idle' && proof.respawn.stamina === 100 && proof.respawn.poise === 100, `respawn must restore full transient vitals ${JSON.stringify(proof.respawn)}`);
  need(proof.respawn.attackKind === 'none' && proof.respawn.attackRemaining === 0 && proof.respawn.attackComboStep === 0 && proof.respawn.attackActive === false, 'respawn must not carry an attack/combo window');
  need(proof.respawn.guardBreakRemaining === 0 && proof.respawn.hitStaggerRemaining === 0 && proof.respawn.dodgeRemaining === 0, 'respawn must clear stagger/break/dodge timers');
  need(proof.respawn.guarding === false && proof.respawn.isDodgeInvulnerable === false && proof.respawn.isGrounded === true && proof.respawn.canDodge === true, 'respawn must return to a grounded actionable state');
  const healthAfterRespawn = await page.evaluate(() => ({
    now: Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow')),
    max: Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuemax')),
  }));
  need(Number.isFinite(healthAfterRespawn.now) && healthAfterRespawn.now === healthAfterRespawn.max, `shipped respawn must restore authoritative health ${JSON.stringify(healthAfterRespawn)}`);
  const recovered = await waitFor(() => {
    const frame = window.__hitStaggerMotion.at(-1);
    return frame?.state === 'idle' && frame?.hitStaggerRemaining === 0 && frame?.stamina === 100 && frame?.poise === 100 ? structuredClone(frame) : null;
  }, 'post-defeat idle recovery');
  const canvas = page.locator('#game3d-canvas');
  const box = await canvas.boundingBox();
  need(box && box.width > 100 && box.height > 100, 'invalid shipped canvas bounds');
  const png = await page.screenshot({ clip: box });
  fs.writeFileSync(path.join(outDir, 'hit-stagger-runtime.png'), png);
  fs.writeFileSync(path.join(outDir, 'hit-stagger-runtime.json'), `${JSON.stringify({ baseline, active, stagger: proof.stagger, interrupted: proof.interrupted, lethalFeedback: proof.lethalFeedback, respawn: proof.respawn, healthAfterRespawn, recovered, browserErrors: errors }, null, 2)}\n`);
  need(errors.length === 0, errors.join(' | '));
  console.log('PLAYER_HIT_STAGGER_RUNTIME_OK');
} catch (error) {
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
