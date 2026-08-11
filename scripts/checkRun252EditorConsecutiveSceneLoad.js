#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run252-editor-consecutive-scene-load');

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
function sceneData(objects, snapSize) {
  return {
    schemaVersion: 1,
    world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
    editor: { gridVisible: false, snapEnabled: true, snapSize },
    objects: objects.map((object) => ({
      id: object.id,
      name: object.name,
      asset: object.asset,
      transform: { position: object.position, rotation: object.rotation, scale: object.scale }
    })),
    instanceGroups: []
  };
}

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const firstObjects = [
    { id: 'run252-first-0001', name: 'Run252 First North', asset: 'marker-tree', position: [-12.375, 0.125, 18.625], rotation: [0.625, -1.125, 2.25], scale: [0.007, 1.5, 0.625] },
    { id: 'run252-first-0002', name: 'Run252 First South', asset: 'marker-tree', position: [7.875, 1.375, -9.125], rotation: [-0.5, 0.75, -2.125], scale: [1.25, 0.333, 2.25] }
  ];
  const secondObjects = [
    { id: 'run252-second-0001', name: 'Run252 Replacement East', asset: 'marker-tree', position: [21.625, 2.125, -14.375], rotation: [-1.375, 2.125, 0.375], scale: [0.125, 2.75, 0.875] }
  ];
  const firstPath = path.join(ARTIFACT_DIR, 'first.scene.json');
  const secondPath = path.join(ARTIFACT_DIR, 'second.scene.json');
  fs.writeFileSync(firstPath, JSON.stringify(sceneData(firstObjects, 2.5), null, 2));
  fs.writeFileSync(secondPath, JSON.stringify(sceneData(secondObjects, 3.75), null, 2));

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));

  const capture = () => page.evaluate(() => {
    const round = (value) => Number(value.toFixed(6));
    const input = document.getElementById('we-load-file');
    const gridToggle = document.getElementById('we-grid-toggle');
    const objects = window.__WESTEROS_WORLD_EDITOR__.editableObjects.map((object) => ({
      id: object.userData.editorId,
      name: object.name,
      asset: object.userData.editorAssetId,
      position: object.position.toArray().map(round),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
      scale: object.scale.toArray().map(round)
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return {
      objects,
      hierarchyText: document.getElementById('we-hierarchy').textContent,
      selection: document.getElementById('we-selection-status').textContent,
      gridChecked: gridToggle.checked,
      gridDisabled: gridToggle.disabled,
      gridVisible: window.__WESTEROS_WORLD_EDITOR__.grid.visible,
      snapEnabled: document.getElementById('we-snap-toggle').checked,
      snapSize: Number(document.getElementById('we-snap-size').value),
      loadInputValue: input.value,
      toast: document.getElementById('we-toast').textContent,
      history: window.__WESTEROS_EDITOR_HISTORY__?.getSnapshot?.()
    };
  });

  try {
    await page.goto(`${base}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__ && window.__WESTEROS_EDITOR_HISTORY__, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted === true, null, { timeout: 30000 });

    await page.locator('#we-load-file').setInputFiles(firstPath);
    await page.waitForFunction(() => (
      window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.length === 2 &&
      document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
      Number(document.getElementById('we-snap-size')?.value) === 2.5
    ), null, { timeout: 120000 });
    const afterFirst = await capture();
    const sortedFirst = firstObjects.slice().sort((a, b) => a.id.localeCompare(b.id));
    assert(JSON.stringify(afterFirst.objects) === JSON.stringify(sortedFirst), `First scene did not load exactly: ${JSON.stringify({ expected: sortedFirst, actual: afterFirst.objects })}`);
    assert(afterFirst.snapEnabled === true && afterFirst.snapSize === 2.5, `First scene snap metadata drifted: ${JSON.stringify(afterFirst)}`);
    assert(afterFirst.loadInputValue === '', `File input was not reset after first load: ${afterFirst.loadInputValue}`);
    assert(afterFirst.selection.includes('yok'), `First scene load should clear selection: ${afterFirst.selection}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-first-scene-loaded.png'), fullPage: true });

    await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    await page.waitForFunction(() => !document.getElementById('we-selection-status').textContent.includes('yok'), null, { timeout: 30000 });
    await page.locator('#we-snap-toggle').check();
    await page.locator('#we-snap-size').fill('4.25');
    await page.locator('#we-snap-size').dispatchEvent('change');
    const beforeSecond = await capture();
    assert(beforeSecond.snapEnabled === true && beforeSecond.snapSize === 4.25, `Prepared second-load snap state drifted: ${JSON.stringify(beforeSecond)}`);

    await page.locator('#we-load-file').setInputFiles(secondPath);
    await page.waitForFunction(() => {
      const objects = window.__WESTEROS_WORLD_EDITOR__?.editableObjects || [];
      return objects.length === 1 && objects[0]?.userData?.editorId === 'run252-second-0001' &&
        document.getElementById('we-toast')?.textContent === 'Scene JSON yüklendi.' &&
        Number(document.getElementById('we-snap-size')?.value) === 3.75;
    }, null, { timeout: 120000 });

    const afterSecond = await capture();
    assert(JSON.stringify(afterSecond.objects) === JSON.stringify(secondObjects), `Second scene did not replace the first scene exactly: ${JSON.stringify({ expected: secondObjects, actual: afterSecond.objects })}`);
    for (const stale of firstObjects) {
      assert(!afterSecond.objects.some((object) => object.id === stale.id), `Stale first-scene id survived replacement: ${stale.id}`);
      assert(!afterSecond.hierarchyText.includes(stale.name), `Stale first-scene hierarchy entry survived replacement: ${stale.name}`);
    }
    assert(afterSecond.hierarchyText.includes(secondObjects[0].name), `Replacement hierarchy entry missing: ${afterSecond.hierarchyText}`);
    assert(afterSecond.snapEnabled === true && afterSecond.snapSize === 3.75, `Second scene snap metadata was not restored: ${JSON.stringify(afterSecond)}`);
    assert(afterSecond.loadInputValue === '', `File input was not reset after second load: ${afterSecond.loadInputValue}`);
    assert(afterSecond.gridChecked === false && afterSecond.gridDisabled === true && afterSecond.gridVisible === false, `Owner grid policy drifted: ${JSON.stringify(afterSecond)}`);
    assert(afterSecond.selection.includes('yok'), `Second scene load should clear prior selection: ${afterSecond.selection}`);
    assert(afterSecond.history?.observersStarted === true && afterSecond.history?.restoring === false, `History unstable after consecutive scene loads: ${JSON.stringify(afterSecond.history)}`);
    assert(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-second-scene-replaced.png'), fullPage: true });

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box && box.width > 240 && box.height > 180) {
      const startX = box.x + box.width * 0.58;
      const startY = box.y + box.height * 0.52;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 140, startY - 35, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(160);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-second-scene-orbit-angle.png'), fullPage: true });

    console.log(`[checkRun252EditorConsecutiveSceneLoad] PASS ${JSON.stringify({ firstCount: afterFirst.objects.length, secondCount: afterSecond.objects.length, staleObjectsAfterSecond: 0, secondObject: afterSecond.objects[0], snapSize: afterSecond.snapSize, unexpectedErrors: errors.length, screenshots: 3 })}`);
  } finally {
    await context.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`[checkRun252EditorConsecutiveSceneLoad] FAIL: ${error.stack || error}`); process.exitCode = 1; });
