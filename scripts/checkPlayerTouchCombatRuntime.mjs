#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME3D_SOURCE_PATH = path.join(ROOT, 'src', '3d', 'game3d.js');
const STATE_ANCHOR = '\t\tconst state = createScene(canvas);';
const STATE_HOOK = `${STATE_ANCHOR}\n\t\twindow.__KIZIL_TOUCH_LIVE_STATE__ = state;`;
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
});

const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-touch-combat-runtime');
const need = (ok, message) => { if (!ok) throw new Error(`[player-touch-combat-runtime] ${message}`); };
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });

/**
 * Serve the real shipped files while exposing the createScene return value only in this proof.
 * No observation hook is committed to game3d.js, so production lifecycle/ownership stays untouched.
 */
function startObservedStaticServer() {
  const game3dSource = fs.readFileSync(GAME3D_SOURCE_PATH, 'utf8');
  need(game3dSource.includes(STATE_ANCHOR), 'game3d createScene state anchor missing');
  need(!game3dSource.includes('__KIZIL_TOUCH_LIVE_STATE__'), 'runtime observation hook leaked into production source');
  const transformedGame3d = game3dSource.replace(STATE_ANCHOR, STATE_HOOK);
  const server = http.createServer((request, response) => {
    try {
      const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
      if (urlPath === '/src/3d/game3d.js') {
        response.writeHead(200, { 'Content-Type': MIME['.js'] });
        response.end(transformedGame3d);
        return;
      }
      const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
      const filePath = path.resolve(ROOT, relative);
      if (!(filePath === ROOT || filePath.startsWith(`${ROOT}${path.sep}`))) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const server = await startObservedStaticServer();
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

/**
 * Inspect the actual hydrated FBX already mounted in the shipped Three.js scene. The shared
 * material core is read-only here: existing imported materials are preserved, while warnings such
 * as a single-surface/untextured character remain visible in the artifact for the owning appearance
 * integration to act on rather than being hidden by a test-only recolor.
 */
async function capturePlayerAssetProof() {
  return page.evaluate(async () => {
    const state = window.__KIZIL_TOUCH_LIVE_STATE__;
    if (!state?.player?.object3D || !state?.groundCollider) return null;
    const [{ Box3 }, materialCore, playerConfigModule] = await Promise.all([
      import('/src/3d/vendor/three/build/three.module.js'),
      import('/src/3d/materials/MaterialAssignmentCore.js'),
      import('/src/3d/gameplay/playerConfig.js'),
    ]);
    const root = state.player.object3D;
    root.updateMatrixWorld(true);
    const validation = materialCore.validateMaterialAssignment(root);
    const manifest = materialCore.createMaterialManifest(root, {
      metadata: {
        id: 'player-runtime',
        name: root.name || 'player',
        category: 'character',
        src: playerConfigModule.PLAYER_CONFIG.MODEL_URL,
      },
    });
    const bounds = new Box3().setFromObject(root);
    const position = root.position;
    const groundY = state.groundCollider.getGroundHeight(position.x, position.z);
    const textureSlots = [];
    let layeredMaterialCount = 0;
    let namedMaterialCount = 0;
    let materialSlots = 0;
    root.traverse((child) => {
      if (!child?.isMesh || child.isInstancedMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (let index = 0; index < materials.length; index += 1) {
        const material = materials[index];
        if (!material) continue;
        materialSlots += 1;
        if (String(material.name || '').trim()) namedMaterialCount += 1;
        if (material.userData?.layeredMaterial) layeredMaterialCount += 1;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const texture = material[key];
          if (!texture) continue;
          const image = texture.image;
          textureSlots.push({
            mesh: child.name || `mesh-${validation.meshes.indexOf(child)}`,
            material: material.name || material.type || `material-${index}`,
            slot: key,
            width: Number(image?.naturalWidth || image?.videoWidth || image?.width || 0),
            height: Number(image?.naturalHeight || image?.videoHeight || image?.height || 0),
            paletteId: material.userData?.paletteId || null,
            generated: Boolean(material.userData?.generatedByTextureFactory || material.userData?.layeredMaterial),
          });
        }
      }
    });
    const recommendedAutoRecipe = materialCore.buildAutoMaterialRecipe(root, {
      metadata: { category: 'character', src: playerConfigModule.PLAYER_CONFIG.MODEL_URL, name: root.name || 'player' },
      textureSize: 256,
    });
    const recommendedLayerRecipe = validation.meshCount === 1 && validation.materialSlotCount === 1
      ? materialCore.buildRecommendedLayerRecipe(root, {
          metadata: { category: 'character', src: playerConfigModule.PLAYER_CONFIG.MODEL_URL, name: root.name || 'player' },
          textureSize: 256,
        })
      : null;
    return {
      source: playerConfigModule.PLAYER_CONFIG.MODEL_URL,
      animationSources: { ...playerConfigModule.PLAYER_CONFIG.ANIMATION_URLS },
      object: {
        name: root.name || '',
        uuid: root.uuid,
        placeholder: validation.placeholder,
        meshCount: validation.meshCount,
        surfaceCount: validation.surfaceCount,
        uvMeshCount: validation.uvMeshCount,
        namedSurfaceCount: validation.namedSurfaceCount,
        materialSlotCount: validation.materialSlotCount,
        namedMaterialCount,
        generatedMaterialCount: validation.generatedMaterialCount,
        layeredMaterialCount,
      },
      materialValidation: {
        ok: validation.ok,
        errors: [...validation.errors],
        warnings: [...validation.warnings],
      },
      surfaceManifest: manifest.surfaces.map((surface) => ({ ...surface })),
      textureSlots,
      recommendedOnly: {
        autoRecipe: recommendedAutoRecipe ? { ...recommendedAutoRecipe } : null,
        layeredFallback: recommendedLayerRecipe ? { ...recommendedLayerRecipe } : null,
        appliedInProof: false,
      },
      geography: {
        position: { x: position.x, y: position.y, z: position.z },
        groundY,
        rootGroundDeltaMeters: position.y - groundY,
        visualBottomY: bounds.min.y,
        visualTopY: bounds.max.y,
        visualBottomGroundDeltaMeters: bounds.min.y - groundY,
        visualHeightMeters: bounds.max.y - bounds.min.y,
      },
    };
  });
}

try {
  const gameUrl = `http://127.0.0.1:${server.address().port}/game3d.html`;
  await page.goto(gameUrl, { waitUntil: 'commit', timeout: 30000 });
  const entryButton = page.locator('#run266-entry-enter');
  await entryButton.waitFor({ state: 'visible', timeout: 30000 });
  await entryButton.click();
  await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__KIZIL_TOUCH_LIVE_STATE__?.player?.object3D), null, { timeout: 30000 });
  const baseline = await waitFor(motions, (history) => [...history].reverse().find((frame) => frame?.state === 'idle' && frame?.isGrounded && frame?.attackKind === 'none') ?? null, 'grounded mobile idle', 20000);
  const playerAsset = await capturePlayerAssetProof();
  need(Boolean(playerAsset), 'live player asset inspection unavailable');
  need(playerAsset.source === 'assets/models/characters/peasant_girl.fbx', `unexpected shipped player source ${playerAsset.source}`);
  need(playerAsset.object.placeholder === false, 'shipped player resolved to fallback placeholder instead of hydrated FBX');
  need(playerAsset.object.meshCount > 0 && playerAsset.object.surfaceCount > 0, `player has no renderable/material surfaces: ${JSON.stringify(playerAsset.object)}`);
  need(playerAsset.object.materialSlotCount > 0, 'player has no material slots');
  need(playerAsset.materialValidation.errors.length === 0, `shared material validation errors: ${JSON.stringify(playerAsset.materialValidation)}`);
  need(Math.abs(playerAsset.geography.rootGroundDeltaMeters) <= 0.08, `player root/collider ground split ${playerAsset.geography.rootGroundDeltaMeters}m`);
  need(playerAsset.geography.visualHeightMeters > 0.5 && playerAsset.geography.visualHeightMeters < 3.5, `implausible hydrated player visual height ${playerAsset.geography.visualHeightMeters}m`);
  need(Math.abs(playerAsset.geography.visualBottomGroundDeltaMeters) <= 0.35, `player visual feet/ground split ${playerAsset.geography.visualBottomGroundDeltaMeters}m`);

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
  const metrics = { baseline, playerAsset, guarded, blockedIntent, released, lightStart, lockEvent, browserErrors: errors };
  fs.writeFileSync(path.join(outDir, 'touch-combat-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
  console.log(`PLAYER_TOUCH_COMBAT_RUNTIME_OK ${JSON.stringify({
    source: blockedIntent.source,
    lightComboStep: lightStart.comboStep,
    lockState: lockEvent.locked,
    playerMeshes: playerAsset.object.meshCount,
    playerMaterialSlots: playerAsset.object.materialSlotCount,
    playerTextureSlots: playerAsset.textureSlots.length,
    playerMaterialWarnings: playerAsset.materialValidation.warnings,
    rootGroundDeltaMeters: Number(playerAsset.geography.rootGroundDeltaMeters.toFixed(4)),
    visualBottomGroundDeltaMeters: Number(playerAsset.geography.visualBottomGroundDeltaMeters.toFixed(4)),
    errors: errors.length,
  })}`);
} catch (error) {
  fs.writeFileSync(path.join(outDir, 'failure.json'), `${JSON.stringify({ error: String(error?.stack ?? error), browserErrors: errors }, null, 2)}\n`);
  throw error;
} finally {
  await page.close();
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
