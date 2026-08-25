#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-parry-riposte');
const need = (ok, message) => { if (!ok) throw new Error(`[player-parry-riposte-runtime] ${message}`); };
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
  window.__riposteMotion = [];
  window.__riposteCounters = [];
  window.__riposteWindows = [];
  window.__riposteHudSamples = [];
  window.__riposteParryProof = null;
  window.addEventListener('aapw:player-motion', (event) => {
    window.__riposteMotion.push(structuredClone(event.detail));
    if (window.__riposteMotion.length > 900) window.__riposteMotion.shift();
  });
  window.addEventListener('aapw:player-counter-window', (event) => {
    window.__riposteCounters.push(structuredClone(event.detail));
  });
  window.addEventListener('aapw:player-attack-window', (event) => {
    const detail = structuredClone(event.detail);
    window.__riposteWindows.push(detail);
    queueMicrotask(() => {
      const hud = document.querySelector('.g3d-combat-status');
      window.__riposteHudSamples.push({
        serial: detail.serial,
        phase: detail.phase,
        counter: detail.counter,
        counterSource: detail.counterSource,
        text: hud?.textContent ?? '',
        state: hud?.dataset.state ?? '',
      });
    });
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readMotion = () => page.evaluate(() => structuredClone(window.__riposteMotion ?? []));
const readCounters = () => page.evaluate(() => structuredClone(window.__riposteCounters ?? []));
const readWindows = () => page.evaluate(() => structuredClone(window.__riposteWindows ?? []));
const readHudSamples = () => page.evaluate(() => structuredClone(window.__riposteHudSamples ?? []));
const readHealth = () => page.evaluate(() => Number(document.querySelector('.g3d-health-bar')?.getAttribute('aria-valuenow')));
const readHud = () => page.evaluate(() => { const el = document.querySelector('.g3d-combat-status'); return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' }; });

async function waitFor(read, find, label, timeout = 10000, interval = 40) {
  const deadline = Date.now() + timeout; let last = null;
  while (Date.now() < deadline) {
    last = await read();
    const found = find(last);
    if (found) return found;
    await sleep(interval);
  }
  throw new Error(`[player-parry-riposte-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}
const waitMotion = (find, label, timeout) => waitFor(readMotion, (frames) => [...frames].reverse().find(find) ?? null, label, timeout);
const waitCounter = (find, label, timeout) => waitFor(readCounters, (events) => [...events].reverse().find(find) ?? null, label, timeout);
const waitWindow = (find, label, timeout) => waitFor(readWindows, (events) => [...events].reverse().find(find) ?? null, label, timeout);

async function waitIdleFullStamina(timeout = 15000) {
  return waitMotion((frame) => frame?.state === 'idle' && frame.isGrounded && frame.stamina === 100 && frame.attackKind === 'none' && frame.guardBreakRemaining === 0 && frame.hitStaggerRemaining === 0, 'full-stamina actionable idle', timeout);
}

async function armFrozenDamageOnParry(amount, sourceId) {
  await page.evaluate(async ({ amount: value, sourceId: source }) => {
    const [{ gameEvents }, { EVENTS }, { readDamageResolution }] = await Promise.all([
      import('./src/3d/eventBus.js'),
      import('./src/3d/config.js'),
      import('./src/3d/gameplay/health.js'),
    ]);
    window.__riposteParryProof = { armed: true, triggered: false, sourceId: source, frame: null, resolution: null, producerMutated: null };
    const onMotion = (event) => {
      const frame = event?.detail;
      if (!frame || frame.state !== 'guard' || !frame.guarding || !(frame.parryWindowRemaining > 0)) return;
      window.removeEventListener('aapw:player-motion', onMotion);
      const payload = Object.freeze({ amount: value, sourceId: source });
      window.__riposteParryProof.triggered = true;
      window.__riposteParryProof.frame = structuredClone(frame);
      gameEvents.emit(EVENTS.PLAYER_DAMAGED, payload);
      window.__riposteParryProof.resolution = structuredClone(readDamageResolution(payload));
      window.__riposteParryProof.producerMutated = Object.hasOwn(payload, 'mitigation') || Object.hasOwn(payload, 'appliedAmount');
    };
    window.addEventListener('aapw:player-motion', onMotion);
  }, { amount, sourceId });
}

async function performFrozenParry(sourceId) {
  const healthBefore = await readHealth();
  const counterMarker = (await readCounters()).length;
  await armFrozenDamageOnParry(20, sourceId);
  await page.keyboard.down('KeyQ');
  const parryMotion = await waitMotion((frame) => frame?.defenseResult === 'parry' && frame.counterReady && frame.counterSource === 'parry', `${sourceId} parry + counter motion`, 7000);
  const opened = await waitFor(readCounters, (events) => events.slice(counterMarker).find((event) => event.ready && event.source === 'parry' && event.reason === 'opened') ?? null, `${sourceId} counter opened`, 5000, 30);
  const proof = await page.evaluate(() => structuredClone(window.__riposteParryProof));
  const healthAfter = await readHealth();
  await page.keyboard.up('KeyQ');
  need(proof?.triggered && proof.frame?.parryWindowRemaining > 0, `${sourceId} controlled hit did not land inside real parry window: ${JSON.stringify(proof)}`);
  need(proof?.producerMutated === false, `${sourceId} frozen producer payload was mutated`);
  need(proof?.resolution?.mitigation === 'parry' && proof?.resolution?.amount === 0 && proof?.resolution?.appliedAmount === 0, `${sourceId} immutable resolution missing authoritative parry result: ${JSON.stringify(proof?.resolution)}`);
  need(healthAfter === healthBefore, `${sourceId} parry changed health ${healthBefore} -> ${healthAfter}`);
  need(opened.remainingSeconds >= 1 && opened.remainingSeconds <= 1.1 && opened.stamina <= 92.1 && opened.stamina >= 90, `${sourceId} counter opening drifted: ${JSON.stringify(opened)}`);
  return { healthBefore, healthAfter, parryMotion, opened, proof };
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#run266-entry-enter').click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  const baseline = await waitIdleFullStamina(20000);
  need(baseline.counterReady === false && baseline.counterSource === 'none' && baseline.counterRemaining === 0, `baseline counter state must be empty: ${JSON.stringify(baseline)}`);

  const firstParry = await performFrozenParry('riposte-consume');
  const firstOpenedIndex = (await readCounters()).findIndex((event) => event.reason === 'opened' && event.ready);
  await page.keyboard.press('KeyE');
  const riposteStart = await waitWindow((event) => event.phase === 'start' && event.kind === 'light' && event.counter === true && event.counterSource === 'parry', 'light riposte start', 7000);
  need(Math.abs((firstParry.opened.stamina - riposteStart.stamina) - 6) <= 0.35, `light riposte must cost 6 stamina from parry-open snapshot: ${firstParry.opened.stamina} -> ${riposteStart.stamina}`);
  need(riposteStart.comboStep === 1 && riposteStart.damageScale === 1.35, `riposte attack metadata drifted: ${JSON.stringify(riposteStart)}`);
  const consumed = await waitFor(readCounters, (events) => events.slice(firstOpenedIndex + 1).find((event) => !event.ready && event.source === 'parry' && event.reason === 'consumed') ?? null, 'one-shot riposte consumption', 5000, 30);
  need(consumed.remainingSeconds === 0, `consumed counter must close immediately: ${JSON.stringify(consumed)}`);
  const riposteActive = await waitWindow((event) => event.serial === riposteStart.serial && event.phase === 'active-start' && event.counter === true, 'riposte active window', 5000);
  const riposteHud = await waitFor(readHudSamples, (samples) => [...samples].reverse().find((sample) => sample.serial === riposteStart.serial && sample.phase === 'active-start' && sample.text.includes('RİPOST') && sample.text.includes('Güç x1.35')) ?? null, 'riposte HUD projection', 5000, 30);
  need(riposteActive.damageScale === 1.35 && riposteHud.state === 'attack-active-start', `riposte active HUD/scale mismatch: ${JSON.stringify({ riposteActive, riposteHud })}`);
  await waitWindow((event) => event.serial === riposteStart.serial && event.phase === 'finish', 'riposte finish', 12000);
  await waitIdleFullStamina(15000);

  await page.keyboard.press('KeyE');
  const normalStart = await waitWindow((event) => event.phase === 'start' && event.kind === 'light' && event.serial > riposteStart.serial, 'normal light attack after riposte', 5000);
  need(normalStart.counter === false && normalStart.counterSource === 'none', `counter reward leaked into later attack: ${JSON.stringify(normalStart)}`);
  need(normalStart.damageScale === 1 && Math.abs(normalStart.stamina - 88) <= 0.2, `normal light attack must retain 12 stamina / x1 tuning: ${JSON.stringify(normalStart)}`);
  await waitWindow((event) => event.serial === normalStart.serial && event.phase === 'finish', 'normal light finish', 12000);
  await waitIdleFullStamina(15000);

  const counterCountBeforeExpiry = (await readCounters()).length;
  const windowCountBeforeExpiry = (await readWindows()).length;
  const secondParry = await performFrozenParry('riposte-expiry');
  const frozenParryHud = await waitFor(readHud, (hud) => hud.state === 'defense-parry' && hud.text.includes('PARRY') && hud.text.includes('20.0 savuşturuldu') ? hud : null, 'frozen parry HUD from staged resolution', 3000, 25);
  const readyHud = await waitFor(readHud, (hud) => hud.state === 'counter-ready' && hud.text.includes('RİPOST HAZIR') && hud.text.includes('PARRY') ? hud : null, 'riposte-ready HUD after defense feedback', 5000, 30);
  const expired = await waitFor(readCounters, (events) => events.slice(counterCountBeforeExpiry).find((event) => !event.ready && event.source === 'parry' && event.reason === 'expired') ?? null, 'riposte expiry event', 6000, 40);
  const expiredMotion = await waitMotion((frame) => frame?.counterReady === false && frame.counterRemaining === 0 && frame.attackKind === 'none', 'expired counter motion state', 5000);
  const afterExpiryWindows = await readWindows();
  need(afterExpiryWindows.length === windowCountBeforeExpiry, 'letting a riposte expire must not synthesize an attack');
  need(expired.remainingSeconds === 0 && expiredMotion.counterSource === 'none', `expired counter must clear authoritative state: ${JSON.stringify({ expired, expiredMotion })}`);
  await waitFor(readHud, (hud) => hud.state === 'free' && hud.text.includes('Serbest') ? hud : null, 'HUD reset after riposte expiry', 5000, 40);

  await page.screenshot({ path: path.join(outDir, 'parry-riposte-runtime.png'), fullPage: true });
  need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
  const metrics = {
    ok: true,
    baseline,
    firstParry,
    riposte: { start: riposteStart, active: riposteActive, consumed, hud: riposteHud },
    normalAttack: normalStart,
    expiry: { parry: secondParry, frozenParryHud, readyHud, expired, motion: expiredMotion },
    browserErrors: errors,
  };
  fs.writeFileSync(path.join(outDir, 'parry-riposte-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`PLAYER_PARRY_RIPOSTE_RUNTIME_OK ${JSON.stringify({ counterWindow: firstParry.opened.remainingSeconds, riposteStamina: riposteStart.stamina, riposteScale: riposteStart.damageScale, normalStamina: normalStart.stamina, frozenParryHud: frozenParryHud.text, readyHud: readyHud.text, expired: expired.reason, errors: errors.length })}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
