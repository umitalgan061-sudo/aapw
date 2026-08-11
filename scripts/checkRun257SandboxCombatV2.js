#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run257-sandbox-combat-v2');

function assert(value, message) { if (!value) throw new Error(message); }
function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.fbx') return 'application/octet-stream';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  return 'application/octet-stream';
}
function startServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, relative);
    const directoryIndex = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(directoryIndex)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(directoryIndex).pipe(res); return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}
async function waitForGame(page, base) {
  await page.goto(`${base}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.g3d-sandbox-combat', { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 180000 });
}
async function storageKeys(page) { return page.evaluate(() => Object.keys(localStorage).sort()); }
async function observeStaminaDrop(page, marker) {
  await page.waitForFunction((markerName) => {
    const root = document.querySelector('.g3d-sandbox-combat');
    if (!root) return false;
    const value = Number(root.dataset.stamina);
    if (!(value < 99)) return false;
    root.dataset[markerName] = String(value);
    return true;
  }, marker, { timeout: 8000 });
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const playerSource = fs.readFileSync(path.join(ROOT, 'src/3d/gameplay/player.js'), 'utf8');
  const npcSource = fs.readFileSync(path.join(ROOT, 'src/3d/gameplay/npc.js'), 'utf8');
  const interactionSource = fs.readFileSync(path.join(ROOT, 'src/3d/gameplay/interaction.js'), 'utf8');
  assert(playerSource.includes('SANDBOX_COMBAT_EVENTS_RUN257'), 'Player sandbox combat contract missing');
  assert(playerSource.includes('STAMINA_REGEN_DELAY_SECONDS_RUN257_RCA'), 'RCA recovery delay missing');
  assert(npcSource.includes('SANDBOX_GUARD_COMBAT_CONFIG_RUN257'), 'Guard sandbox combat contract missing');
  assert(interactionSource.includes('sandboxCombatHostile'), 'Hostile dialogue suppression missing');
  assert(!/localStorage\.|sessionStorage\.|STORAGE_KEYS|SAVE_SLOT/.test(playerSource + npcSource), 'Sandbox combat must not own persistence APIs');

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const desktopPage = await desktop.newPage();
  const mobilePage = await mobile.newPage();
  const desktopErrors = collectErrors(desktopPage);
  const mobileErrors = collectErrors(mobilePage);

  try {
    await waitForGame(desktopPage, base);
    const desktopStorageBefore = await storageKeys(desktopPage);
    const arc = await desktopPage.evaluate(async () => {
      const module = await import('./src/3d/gameplay/player.js');
      const origin = { x: 0, z: 0 };
      const forward = { x: 0, z: 1 };
      return {
        front: module.isSandboxCombatTargetInArcRun257(origin, forward, { x: 0, z: 2.5 }, 3.2, Math.PI / 3),
        side: module.isSandboxCombatTargetInArcRun257(origin, forward, { x: 3, z: 0 }, 3.2, Math.PI / 3),
        far: module.isSandboxCombatTargetInArcRun257(origin, forward, { x: 0, z: 4 }, 3.2, Math.PI / 3),
      };
    });
    assert(arc.front === true && arc.side === false && arc.far === false, `Melee arc drifted: ${JSON.stringify(arc)}`);

    const desktopHud = desktopPage.locator('.g3d-sandbox-combat');
    assert(Number(await desktopHud.getAttribute('data-stamina')) === 100, 'Desktop initial stamina is not full');
    await desktopPage.keyboard.press('KeyF');
    await observeStaminaDrop(desktopPage, 'run257ObservedAttack');
    await desktopPage.keyboard.down('KeyC');
    await desktopPage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'true', null, { timeout: 5000 });
    await desktopPage.keyboard.up('KeyC');
    await desktopPage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'false', null, { timeout: 5000 });
    await desktopPage.keyboard.press('KeyQ');
    await desktopPage.waitForFunction(() => {
      const root = document.querySelector('.g3d-sandbox-combat');
      if (root?.dataset.dodging !== 'true') return false;
      root.dataset.run257ObservedDodge = 'true';
      return true;
    }, null, { timeout: 5000 });
    await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, '01-desktop-sandbox-combat.png'), fullPage: false });
    const desktopEvidence = await desktopHud.evaluate((root) => ({ attack: root.dataset.run257ObservedAttack, dodge: root.dataset.run257ObservedDodge }));
    assert(Number(desktopEvidence.attack) < 99 && desktopEvidence.dodge === 'true', `Desktop transition evidence missing: ${JSON.stringify(desktopEvidence)}`);
    assert(JSON.stringify(desktopStorageBefore) === JSON.stringify(await storageKeys(desktopPage)), 'Desktop combat created persistence state');
    assert(desktopErrors.length === 0, `Desktop browser errors: ${desktopErrors.join(' | ')}`);

    await waitForGame(mobilePage, base);
    const mobileStorageBefore = await storageKeys(mobilePage);
    const mobileLayout = await mobilePage.locator('.g3d-sandbox-combat').evaluate((root) => ({
      viewport: [innerWidth, innerHeight],
      maxTouchPoints: navigator.maxTouchPoints,
      buttons: [...root.querySelectorAll('.g3d-sandbox-combat-actions button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { text: button.textContent, width: rect.width, height: rect.height, display: getComputedStyle(button).display };
      }),
    }));
    assert(mobileLayout.viewport[0] === 390 && mobileLayout.viewport[1] === 844, `Mobile viewport drifted: ${JSON.stringify(mobileLayout.viewport)}`);
    assert(mobileLayout.maxTouchPoints > 0, 'Touch context unavailable');
    assert(mobileLayout.buttons.length === 3 && mobileLayout.buttons.every((button) => button.height >= 44), `Mobile controls are not touch-safe: ${JSON.stringify(mobileLayout.buttons)}`);

    await mobilePage.locator('[data-action="attack"]').tap();
    await observeStaminaDrop(mobilePage, 'run257ObservedAttack');
    await mobilePage.locator('[data-action="block"]').dispatchEvent('pointerdown', { pointerType: 'touch' });
    await mobilePage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'true', null, { timeout: 5000 });
    await mobilePage.locator('[data-action="block"]').dispatchEvent('pointerup', { pointerType: 'touch' });
    await mobilePage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'false', null, { timeout: 5000 });
    await mobilePage.locator('[data-action="dodge"]').tap();
    await mobilePage.waitForFunction(() => {
      const root = document.querySelector('.g3d-sandbox-combat');
      if (root?.dataset.dodging !== 'true') return false;
      root.dataset.run257ObservedDodge = 'true';
      return true;
    }, null, { timeout: 5000 });
    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, '02-mobile-sandbox-combat.png'), fullPage: false });
    const mobileEvidence = await mobilePage.locator('.g3d-sandbox-combat').evaluate((root) => ({ attack: root.dataset.run257ObservedAttack, dodge: root.dataset.run257ObservedDodge }));
    assert(Number(mobileEvidence.attack) < 99 && mobileEvidence.dodge === 'true', `Mobile transition evidence missing: ${JSON.stringify(mobileEvidence)}`);
    assert(JSON.stringify(mobileStorageBefore) === JSON.stringify(await storageKeys(mobilePage)), 'Mobile combat created persistence state');
    assert(mobileErrors.length === 0, `Mobile browser errors: ${mobileErrors.join(' | ')}`);

    console.log(`[checkRun257SandboxCombatV2] PASS ${JSON.stringify({ arc, desktopEvidence, mobileEvidence, touchButtons: mobileLayout.buttons.length, persistenceKeysAdded: 0, screenshots: 2 })}`);
  } finally {
    await desktop.close();
    await mobile.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun257SandboxCombatV2] FAIL: ${error.stack || error}`); process.exitCode = 1; });