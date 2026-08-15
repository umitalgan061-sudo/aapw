#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run344-editor-fbx-pack-current-main');
function assert(value, message) { if (!value) throw new Error(message); }
function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}
function typeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}
function serve() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const rel = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const file = path.resolve(ROOT, rel);
    const index = path.join(file, 'index.html');
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isDirectory() && fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(index).pipe(res);
      return;
    }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': typeOf(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const server = await serve();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_TRANSFORM__ && window.__WESTEROS_EDITOR_FBX_PACKS__, null, { timeout: 120000 });
    await page.evaluate(async () => {
      const THREE = await import('./src/3d/vendor/three/three.module.js');
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const root = new THREE.Group();
      root.name = 'Run344 FBX Pack';
      root.userData.editorId = 'run344-fbx-root';
      root.userData.editorAssetId = 'peasant-girl';
      root.userData.editorFormat = 'fbx';
      root.position.set(0, 5, 0);
      for (const [name, x, color] of [['Pack A', -4, 0x9a7546], ['Pack B', 4, 0x58779a]]) {
        const group = new THREE.Group();
        group.name = name;
        group.position.x = x;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshStandardMaterial({ color }));
        mesh.userData.editorRoot = root;
        group.add(mesh);
        root.add(group);
      }
      const bone = new THREE.Bone();
      bone.name = 'Rig Bone';
      const rigMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0x775566 }));
      rigMesh.name = 'Rig Mesh';
      bone.add(rigMesh);
      root.add(bone);
      const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color: 0x667755 }));
      skinned.name = 'Skinned Body';
      root.add(skinned);
      api.editableObjects.push(root);
      api.scene.add(root);
      api.refreshHierarchy();
    });
    await page.locator('#we-hierarchy .we-hierarchy-item', { hasText: 'Run344 FBX Pack' }).click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().candidateCount === 2);
    const candidates = await page.evaluate(() => window.__WESTEROS_EDITOR_FBX_PACKS__.listPacks());
    assert(candidates.length === 2 && candidates.every((entry) => entry.name === 'Pack A' || entry.name === 'Pack B'), `Rig safety drifted: ${JSON.stringify(candidates)}`);
    await page.locator('#we-fbx-pack-list button', { hasText: 'Pack B' }).click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().activePackName === 'Pack B');
    await page.evaluate(() => {
      const snap = document.getElementById('we-snap-toggle');
      snap.checked = false;
      snap.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (const [selector, value] of [['#we-pos-x', '7.25'], ['#we-rot-y', '-37.5'], ['#we-scale-x', '0.007']]) {
      await page.locator(selector).fill(value);
      await page.locator(selector).dispatchEvent('change');
    }
    const state = await page.evaluate(() => {
      const root = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject();
      return {
        rootPosition: root.position.toArray(),
        rootScale: root.scale.toArray(),
        siblingPosition: root.children[0].position.toArray(),
        packPosition: root.children[1].position.toArray(),
        packRotationY: root.children[1].rotation.y,
        packScaleX: root.children[1].scale.x,
        rigPosition: root.children[2].position.toArray(),
        surface: window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot(),
        transform: window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot()
      };
    });
    assert(JSON.stringify(state.rootPosition) === JSON.stringify([0, 5, 0]), `Root moved: ${JSON.stringify(state)}`);
    assert(JSON.stringify(state.rootScale) === JSON.stringify([1, 1, 1]), `Root scaled: ${JSON.stringify(state)}`);
    assert(state.siblingPosition[0] === -4, `Sibling changed: ${JSON.stringify(state)}`);
    assert(state.rigPosition.every((value) => value === 0), `Rig branch changed: ${JSON.stringify(state)}`);
    assert(Math.abs(state.packPosition[0] - 7.25) < 1e-9, `Pack position drifted: ${JSON.stringify(state)}`);
    assert(Math.abs(state.packRotationY - (-37.5 * Math.PI / 180)) < 1e-9, `Pack rotation drifted: ${JSON.stringify(state)}`);
    assert(Math.abs(state.packScaleX - 0.007) < 1e-9, `Pack scale drifted: ${JSON.stringify(state)}`);
    assert(state.surface.transformAttachedToPack === true && state.surface.overrideCount === 1, `Pack surface drifted: ${JSON.stringify(state)}`);
    assert(state.transform.attachedEditorId === null, `Transform attached to root instead of child: ${JSON.stringify(state)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-independent-pack.png'), fullPage: true });

    const guarded = await page.evaluate(() => ({ count: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length, scale: window.__WESTEROS_WORLD_EDITOR__.getSelectedObject().scale.toArray() }));
    await page.locator('#we-duplicate').click();
    await page.locator('#we-delete').click();
    if (await page.locator('#we-quick-shrink').count()) await page.locator('#we-quick-shrink').click();
    await page.waitForTimeout(100);
    const guardedAfter = await page.evaluate(() => ({ count: window.__WESTEROS_WORLD_EDITOR__.editableObjects.length, scale: window.__WESTEROS_WORLD_EDITOR__.getSelectedObject().scale.toArray() }));
    assert(guarded.count === guardedAfter.count && JSON.stringify(guarded.scale) === JSON.stringify(guardedAfter.scale), `Pack-active root action escaped guard: ${JSON.stringify({ guarded, guardedAfter })}`);

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#we-save').click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    const record = saved.objects.find((object) => object.id === 'run344-fbx-root');
    assert(record?.fbxPacks?.length === 1, `fbxPacks missing: ${JSON.stringify(record)}`);
    assert(record.fbxPacks[0].path === candidates.find((entry) => entry.name === 'Pack B').path, `Pack path drifted: ${JSON.stringify(record.fbxPacks)}`);
    assert(record.fbxPacks[0].transform.position[0] === 7.25 && record.fbxPacks[0].transform.scale[0] === 0.007, `Serialized pack transform drifted: ${JSON.stringify(record.fbxPacks[0])}`);
    assert(record.fbxPacks[0].transform.rotation[1] === Number((-37.5 * Math.PI / 180).toFixed(6)), `Serialized rotation normalization drifted: ${JSON.stringify(record.fbxPacks[0])}`);

    const restore = await page.evaluate((data) => {
      const root = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((object) => object.userData.editorId === 'run344-fbx-root');
      root.children[1].position.x = 99;
      root.children[1].scale.x = 2;
      return window.__WESTEROS_EDITOR_FBX_PACKS__.applySceneOverrides(data);
    }, saved);
    assert(restore.applied === 1 && restore.missing === 0, `Pack restore failed: ${JSON.stringify(restore)}`);
    const restored = await page.evaluate(() => {
      const root = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((object) => object.userData.editorId === 'run344-fbx-root');
      return { x: root.children[1].position.x, scale: root.children[1].scale.x };
    });
    assert(Math.abs(restored.x - 7.25) < 1e-9 && Math.abs(restored.scale - 0.007) < 1e-9, `Pack restore drifted: ${JSON.stringify(restored)}`);

    await page.locator('#we-fbx-pack-root').click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().activePackPath === null);
    const rootAttachment = await page.evaluate(() => window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot().attachedEditorId);
    assert(rootAttachment === 'run344-fbx-root', `Root attachment not restored: ${rootAttachment}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-root-selection-restored.png'), fullPage: true });
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log('[checkRun344EditorFbxPackCurrentMain] PASS');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error('[checkRun344EditorFbxPackCurrentMain] FAIL:', error?.stack || error);
  process.exit(1);
});
