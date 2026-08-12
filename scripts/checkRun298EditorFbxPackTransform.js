#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run298-editor-fbx-pack-transform');
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
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/octet-stream';
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

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__ &&
      window.__WESTEROS_EDITOR_TRANSFORM__ &&
      window.__WESTEROS_EDITOR_FBX_PACKS__ &&
      document.getElementById('we-fbx-pack-panel')
    ), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 0, null, { timeout: 30000 });

    await page.evaluate(async () => {
      const THREE = await import('./src/3d/vendor/three/three.module.js');
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const root = new THREE.Group();
      root.name = 'Run298 FBX Pack Test';
      root.userData.editorId = 'run298-fbx-root';
      root.userData.editorAssetId = 'peasant-girl';
      root.userData.editorFormat = 'fbx';
      root.position.set(0, 6, 0);
      function makePack(name, x, color) {
        const group = new THREE.Group();
        group.name = name;
        group.position.x = x;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
        mesh.name = `${name} Mesh`;
        mesh.userData.editorRoot = root;
        group.add(mesh);
        return group;
      }
      root.add(makePack('Pack A', -4, 0x9a7546), makePack('Pack B', 4, 0x58779a));
      root.traverse((node) => { if (node.isMesh) node.userData.editorRoot = root; });
      api.editableObjects.push(root);
      api.scene.add(root);
      api.refreshHierarchy();
      api.orbitControls.target.set(0, 6, 0);
      api.camera.position.set(18, 14, 22);
      api.camera.lookAt(0, 6, 0);
      api.camera.updateMatrixWorld(true);
    });

    await page.locator('#we-hierarchy .we-hierarchy-item', { hasText: 'Run298 FBX Pack Test' }).click();
    await page.waitForFunction(() => {
      const root = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject();
      return root?.userData?.editorId === 'run298-fbx-root' && window.__WESTEROS_EDITOR_FBX_PACKS__.listPacks(root).length === 2;
    });
    const packButtons = page.locator('#we-fbx-pack-list button[data-pack-path]');
    assert(await packButtons.count() === 2, `Expected two pack buttons, got ${await packButtons.count()}`);
    await packButtons.filter({ hasText: 'Pack B' }).click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().activePackName === 'Pack B');

    let snapshot = await page.evaluate(() => ({
      packs: window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot(),
      transform: window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot()
    }));
    assert(snapshot.packs.transformAttachedToPack === true, `TransformControls is not attached to Pack B: ${JSON.stringify(snapshot)}`);
    assert(snapshot.transform.attachedEditorId === null, `TransformControls unexpectedly reattached to FBX root: ${JSON.stringify(snapshot)}`);

    await page.evaluate(() => {
      const snap = document.getElementById('we-snap-toggle');
      snap.checked = false;
      snap.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#we-pos-x').fill('7.25');
    await page.locator('#we-pos-x').dispatchEvent('change');
    await page.locator('#we-rot-y').fill('-37.5');
    await page.locator('#we-rot-y').dispatchEvent('change');
    await page.locator('#we-scale-x').fill('0.007');
    await page.locator('#we-scale-x').dispatchEvent('change');
    await page.waitForTimeout(150);

    snapshot = await page.evaluate(() => {
      const root = window.__WESTEROS_WORLD_EDITOR__.getSelectedObject();
      const pack = root.children[1];
      return {
        rootPosition: root.position.toArray(),
        packAPosition: root.children[0].position.toArray(),
        packAScale: root.children[0].scale.toArray(),
        packBPosition: pack.position.toArray(),
        packBRotation: [pack.rotation.x, pack.rotation.y, pack.rotation.z],
        packBScale: pack.scale.toArray(),
        state: window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot()
      };
    });
    assert(Math.abs(snapshot.packBPosition[0] - 7.25) < 1e-9, `Pack B position did not change independently: ${JSON.stringify(snapshot)}`);
    assert(Math.abs(snapshot.packBRotation[1] - (-37.5 * Math.PI / 180)) < 1e-9, `Pack B signed rotation drifted: ${JSON.stringify(snapshot)}`);
    assert(Math.abs(snapshot.packBScale[0] - 0.007) < 1e-9, `Pack B scale precision drifted: ${JSON.stringify(snapshot)}`);
    assert(snapshot.rootPosition[0] === 0 && snapshot.rootPosition[1] === 6 && snapshot.rootPosition[2] === 0, `FBX root moved with child pack: ${JSON.stringify(snapshot)}`);
    assert(snapshot.packAPosition[0] === -4 && snapshot.packAScale.every((value) => value === 1), `Sibling pack changed with Pack B: ${JSON.stringify(snapshot)}`);
    assert(snapshot.state.overrideCount === 1, `Pack override was not recorded: ${JSON.stringify(snapshot.state)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-pack-b-independent-transform.png'), fullPage: true });

    const countBeforeDelete = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length);
    await page.locator('#we-delete').click();
    await page.waitForTimeout(100);
    const countAfterDelete = await page.evaluate(() => window.__WESTEROS_WORLD_EDITOR__.editableObjects.length);
    assert(countAfterDelete === countBeforeDelete, `Delete while child pack active deleted FBX root: ${countBeforeDelete} -> ${countAfterDelete}`);

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#we-save').click();
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'westeros-world.scene.json', `Unexpected scene download name: ${download.suggestedFilename()}`);
    const downloadPath = await download.path();
    assert(downloadPath, 'Downloaded scene path unavailable');
    const saved = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
    const savedRoot = saved.objects.find((record) => record.id === 'run298-fbx-root');
    assert(savedRoot && Array.isArray(savedRoot.fbxPacks) && savedRoot.fbxPacks.length === 1, `FBX pack override missing from scene JSON: ${JSON.stringify(savedRoot)}`);
    const savedPack = savedRoot.fbxPacks[0];
    assert(savedPack.name === 'Pack B', `Wrong saved pack: ${JSON.stringify(savedPack)}`);
    assert(Math.abs(savedPack.transform.position[0] - 7.25) < 1e-9 && Math.abs(savedPack.transform.scale[0] - 0.007) < 1e-9, `Saved pack transform drifted: ${JSON.stringify(savedPack)}`);

    const restored = await page.evaluate((sceneData) => {
      const root = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((object) => object.userData?.editorId === 'run298-fbx-root');
      root.children[1].position.x = 99;
      root.children[1].scale.x = 3;
      return window.__WESTEROS_EDITOR_FBX_PACKS__.applyScenePackOverrides(sceneData);
    }, saved);
    assert(restored.applied === 1 && restored.missing === 0, `Pack override restore failed: ${JSON.stringify(restored)}`);
    const restoredValues = await page.evaluate(() => {
      const root = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((object) => object.userData?.editorId === 'run298-fbx-root');
      return { x: root.children[1].position.x, sx: root.children[1].scale.x };
    });
    assert(Math.abs(restoredValues.x - 7.25) < 1e-9 && Math.abs(restoredValues.sx - 0.007) < 1e-9, `Restored pack values drifted: ${JSON.stringify(restoredValues)}`);

    await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      api.orbitControls.target.set(0, 6, 0);
      api.camera.position.set(-24, 19, 18);
      api.camera.lookAt(0, 6, 0);
      api.camera.updateMatrixWorld(true);
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-pack-selection-second-angle.png'), fullPage: true });

    await page.locator('#we-fbx-pack-root').click();
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().activePackPath === null);
    const rootAttachment = await page.evaluate(() => ({
      selectedId: window.__WESTEROS_WORLD_EDITOR__.getSelectedObject()?.userData?.editorId || null,
      transformId: window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot().attachedEditorId
    }));
    assert(rootAttachment.selectedId === 'run298-fbx-root' && rootAttachment.transformId === 'run298-fbx-root', `Whole-FBX selection was not restored: ${JSON.stringify(rootAttachment)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    console.log('[checkRun298EditorFbxPackTransform] PASS: FBX packs select and transform independently, root/sibling isolation holds, destructive root actions are guarded, pack overrides serialize/restore, and browser errors are zero.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('[checkRun298EditorFbxPackTransform] FAIL:', error?.stack || error);
  process.exit(1);
});
