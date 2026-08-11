#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run257-sandbox-combat');

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
async function waitForGame(page) {
  await page.goto(page._run257Base + '/game3d.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.g3d-sandbox-combat', { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 180000 });
}
function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}
async function localStorageKeys(page) {
  return page.evaluate(() => Object.keys(localStorage).sort());
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const playerSource = fs.readFileSync(path.join(ROOT, 'src/3d/gameplay/player.js'), 'utf8');
  const npcSource = fs.readFileSync(path.join(ROOT, 'src/3d/gameplay/npc.js'), 'utf8');
  const interactionSource = fs.readFileSync(path.join(ROOT, 'src/3d/gameplay/interaction.js'), 'utf8');
  assert(playerSource.includes('SANDBOX_COMBAT_EVENTS_RUN257'), 'Player sandbox-combat contract missing');
  assert(npcSource.includes('SANDBOX_GUARD_COMBAT_CONFIG_RUN257'), 'Guard sandbox-combat contract missing');
  assert(interactionSource.includes('sandboxCombatHostile'), 'Hostile-dialogue suppression missing');
  assert(!playerSource.includes('localStorage') && !playerSource.includes('sessionStorage'), 'Player combat must not add persistence');
  assert(!npcSource.includes('localStorage') && !npcSource.includes('sessionStorage'), 'Guard combat must not add persistence');

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const desktopPage = await desktop.newPage();
  desktopPage._run257Base = base;
  const desktopErrors = collectErrors(desktopPage);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobilePage = await mobile.newPage();
  mobilePage._run257Base = base;
  const mobileErrors = collectErrors(mobilePage);

  try {
    await waitForGame(desktopPage);
    const desktopStorageBefore = await localStorageKeys(desktopPage);
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
    assert(arc.front === true && arc.side === false && arc.far === false, `Melee arc contract drifted: ${JSON.stringify(arc)}`);

    const initial = await desktopPage.locator('.g3d-sandbox-combat').evaluate((root) => ({
      stamina: Number(root.dataset.stamina),
      blocking: root.dataset.blocking,
      dodging: root.dataset.dodging,
      text: root.textContent,
    }));
    assert(initial.stamina === 100, `Initial stamina drifted: ${JSON.stringify(initial)}`);
    assert(initial.text.includes('Dayanıklılık') && initial.text.includes('F: saldır'), `Desktop combat affordance missing: ${initial.text}`);

    await desktopPage.keyboard.press('KeyF');
    await desktopPage.waitForFunction(() => Number(document.querySelector('.g3d-sandbox-combat')?.dataset.stamina) < 99, null, { timeout: 5000 });
    const afterAttack = Number(await desktopPage.locator('.g3d-sandbox-combat').getAttribute('data-stamina'));
    assert(afterAttack <= 90, `Attack did not consume expected stamina: ${afterAttack}`);

    await desktopPage.keyboard.down('KeyC');
    await desktopPage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'true', null, { timeout: 3000 });
    await desktopPage.keyboard.up('KeyC');
    await desktopPage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'false', null, { timeout: 3000 });

    await desktopPage.keyboard.press('KeyQ');
    await desktopPage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.dodging === 'true', null, { timeout: 3000 });
    await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, '01-desktop-dodge-combat-hud.png'), fullPage: false });
    await desktopPage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.dodging === 'false', null, { timeout: 5000 });
    const desktopStorageAfter = await localStorageKeys(desktopPage);
    assert(JSON.stringify(desktopStorageBefore) === JSON.stringify(desktopStorageAfter), `Combat input must not create save/progression storage: ${JSON.stringify({ desktopStorageBefore, desktopStorageAfter })}`);
    assert(desktopErrors.length === 0, `Desktop browser errors: ${desktopErrors.join(' | ')}`);

    await waitForGame(mobilePage);
    const mobileStorageBefore = await localStorageKeys(mobilePage);
    const mobileLayout = await mobilePage.locator('.g3d-sandbox-combat').evaluate((root) => {
      const buttons = [...root.querySelectorAll('.g3d-sandbox-combat-actions button')];
      return {
        viewport: [innerWidth, innerHeight],
        maxTouchPoints: navigator.maxTouchPoints,
        buttons: buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { text: button.textContent, width: rect.width, height: rect.height, display: getComputedStyle(button).display };
        }),
      };
    });
    assert(mobileLayout.viewport[0] === 390 && mobileLayout.viewport[1] === 844, `Mobile viewport drifted: ${JSON.stringify(mobileLayout.viewport)}`);
    assert(mobileLayout.maxTouchPoints > 0, `Touch context unavailable: ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.buttons.length === 3 && mobileLayout.buttons.every((button) => button.height >= 44), `Mobile combat buttons are not touch-safe: ${JSON.stringify(mobileLayout.buttons)}`);

    await mobilePage.locator('[data-action="attack"]').tap();
    await mobilePage.waitForFunction(() => Number(document.querySelector('.g3d-sandbox-combat')?.dataset.stamina) < 99, null, { timeout: 5000 });
    await mobilePage.locator('[data-action="block"]').dispatchEvent('pointerdown', { pointerType: 'touch' });
    await mobilePage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.blocking === 'true', null, { timeout: 3000 });
    await mobilePage.locator('[data-action="block"]').dispatchEvent('pointerup', { pointerType: 'touch' });
    await mobilePage.locator('[data-action="dodge"]').tap();
    await mobilePage.waitForFunction(() => document.querySelector('.g3d-sandbox-combat')?.dataset.dodging === 'true', null, { timeout: 3000 });
    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, '02-mobile-sandbox-combat-controls.png'), fullPage: false });
    const mobileStorageAfter = await localStorageKeys(mobilePage);
    assert(JSON.stringify(mobileStorageBefore) === JSON.stringify(mobileStorageAfter), `Mobile combat must not create save/progression storage: ${JSON.stringify({ mobileStorageBefore, mobileStorageAfter })}`);
    assert(mobileErrors.length === 0, `Mobile browser errors: ${mobileErrors.join(' | ')}`);

    console.log(`[checkRun257SandboxCombat] PASS ${JSON.stringify({ arc, desktopAttackStamina: afterAttack, mobileButtons: mobileLayout.buttons.length, persistenceKeysAdded: 0, screenshots: 2 })}`);
  } finally {
    await desktop.close();
    await mobile.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun257SandboxCombat] FAIL: ${error.stack || error}`); process.exitCode = 1; });