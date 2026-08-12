#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper');

const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const fail = (message) => { throw new Error(`[checkEditorHTerrainBridgeBrowser] ${message}`); };

async function main() {
  const playwright = loadPlaywright();
  if (!playwright?.chromium) fail('Playwright Chromium is unavailable');
  const server = await startStaticServer();
  const port = server.address().port;
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  try {
    await page.goto(`http://127.0.0.1:${port}/editor.html?liveWorkspace=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await page.waitForFunction(() => Boolean(window.__WESTEROS_EDITOR_HTERRAIN__), null, { timeout: 90000 });
    const initial = await page.evaluate(() => ({
      snapshot: window.__WESTEROS_EDITOR_HTERRAIN__.getSnapshot(),
      lock: document.querySelector('.we-hterrain-lock')?.textContent?.trim(),
      exportLabel: document.getElementById('we-hterrain-export')?.textContent?.trim()
    }));
    if (initial.lock !== 'MAP.PNG KİLİDİ · AÇIK') fail(`map lock UI missing: ${initial.lock}`);
    if (initial.exportLabel !== 'HTerrain JSON İndir') fail('HTerrain export control missing');
    if (initial.snapshot.mapLocked !== true) fail('snapshot map lock is false');
    if (initial.snapshot.mapReferenceSha256 !== EXPECTED_SHA) fail('snapshot canonical map SHA drift');
    if (initial.snapshot.resolution !== 513) fail('snapshot HTerrain resolution drift');
    if (initial.snapshot.biomeZoneCount !== 17 || initial.snapshot.reliefChainCount !== 4) fail('canonical biome/relief counts drift');

    const synthetic = await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const object = {
        uuid: 'hterrain-browser-proof',
        position: { x: -3386.25, y: 0, z: 2747.5 },
        scale: { x: 40, y: 3.5, z: 40 },
        userData: {
          editorId: 'hterrain-browser-proof',
          editorAssetId: 'editor-land-cell',
          editorTerrainElevationMeters: 3.5
        }
      };
      api.editableObjects.push(object);
      const manifest = window.__WESTEROS_EDITOR_HTERRAIN__.buildManifest();
      const stroke = manifest.strokes.find((candidate) => candidate.id === object.userData.editorId);
      return { manifest, stroke };
    });
    if (!synthetic.stroke) fail('synthetic authored terrain cell did not reach HTerrain manifest');
    if (synthetic.stroke.surface !== 'earth') fail(`Dorne map-biome auto surface should be earth, got ${synthetic.stroke.surface}`);
    if (synthetic.stroke.referenceBiome !== 'dorne') fail(`Dorne reference biome mismatch: ${synthetic.stroke.referenceBiome}`);
    if (synthetic.stroke.heightDeltaMeters !== 3.5) fail('authored height delta was not preserved');
    if (!(synthetic.stroke.radiusUv[0] > 0 && synthetic.stroke.radiusUv[1] > 0)) fail('stroke radiusUv must be positive');

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#we-hterrain-export');
    const download = await downloadPromise;
    const target = path.join(os.tmpdir(), `westeros-hterrain-${process.pid}.json`);
    await download.saveAs(target);
    const exported = JSON.parse(fs.readFileSync(target, 'utf8'));
    fs.rmSync(target, { force: true });
    if (exported.schema !== 'westeros-hterrain-editor-v1') fail('downloaded schema drift');
    if (exported.mapLocked !== true || exported.mapReferenceSha256 !== EXPECTED_SHA) fail('downloaded map lock drift');
    if (!exported.strokes.some((stroke) => stroke.id === 'hterrain-browser-proof' && stroke.surface === 'earth')) fail('downloaded manifest lost authored Dorne stroke');

    await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const index = api.editableObjects.findIndex((object) => object?.userData?.editorId === 'hterrain-browser-proof');
      if (index >= 0) api.editableObjects.splice(index, 1);
    });

    if (consoleErrors.length || pageErrors.length) {
      fail(`browser errors: console=${consoleErrors.length} page=${pageErrors.length} ${consoleErrors.join(' | ')} ${pageErrors.join(' | ')}`);
    }
    console.log('[checkEditorHTerrainBridgeBrowser] PASS:', JSON.stringify({
      mapLocked: initial.snapshot.mapLocked,
      resolution: initial.snapshot.resolution,
      biomeZoneCount: initial.snapshot.biomeZoneCount,
      reliefChainCount: initial.snapshot.reliefChainCount,
      dorneStrokeSurface: synthetic.stroke.surface,
      heightDeltaMeters: synthetic.stroke.heightDeltaMeters,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length
    }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
