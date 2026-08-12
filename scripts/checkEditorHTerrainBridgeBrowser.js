#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper');

const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const fail = (message) => { throw new Error(`[checkEditorHTerrainBridgeBrowser] ${message}`); };

async function readDownload(download, stem) {
  const target = path.join(os.tmpdir(), `${stem}-${process.pid}.json`);
  await download.saveAs(target);
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  fs.rmSync(target, { force: true });
  return parsed;
}

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

    const sceneFixture = {
      schemaVersion: 1,
      world: { name: 'Westeros', coordinateSystem: 'threejs-y-up', units: 'meters' },
      editor: { gridVisible: true, snapEnabled: true, snapSize: 1 },
      objects: [{
        id: 'hterrain-browser-proof',
        name: 'HTerrain Dorne Cell',
        asset: 'editor-land-cell',
        transform: {
          position: [-3386.25, 0, 2747.5],
          rotation: [0, 0, 0],
          scale: [40, 3.5, 40]
        },
        terrain: { hterrainSurface: 'rock', elevationMeters: 3.5 }
      }],
      instanceGroups: []
    };
    await page.setInputFiles('#we-load-file', {
      name: 'hterrain-scene-proof.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(sceneFixture))
    });
    await page.waitForFunction(() => window.__WESTEROS_WORLD_EDITOR__?.editableObjects?.some(
      (object) => object?.userData?.editorId === 'hterrain-browser-proof'
    ), null, { timeout: 30000 });
    const restored = await page.evaluate(() => {
      const object = window.__WESTEROS_WORLD_EDITOR__.editableObjects.find(
        (candidate) => candidate?.userData?.editorId === 'hterrain-browser-proof'
      );
      return {
        surface: object?.userData?.editorHTerrainSurface,
        elevationMeters: object?.userData?.editorTerrainElevationMeters,
        assetId: object?.userData?.editorAssetId
      };
    });
    if (restored.assetId !== 'editor-land-cell') fail(`terrain scene asset did not restore: ${restored.assetId}`);
    if (restored.surface !== 'rock') fail(`HTerrain scene surface did not restore: ${restored.surface}`);
    if (restored.elevationMeters !== 3.5) fail(`HTerrain scene elevation did not restore: ${restored.elevationMeters}`);

    const sceneDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#we-save');
    const savedScene = await readDownload(await sceneDownloadPromise, 'westeros-scene-hterrain');
    const savedRecord = savedScene.objects.find((record) => record.id === 'hterrain-browser-proof');
    if (savedRecord?.terrain?.hterrainSurface !== 'rock') fail('scene save lost HTerrain surface metadata');
    if (savedRecord?.terrain?.elevationMeters !== 3.5) fail('scene save lost HTerrain elevation metadata');

    const authored = await page.evaluate(() => {
      const api = window.__WESTEROS_WORLD_EDITOR__;
      const object = api.editableObjects.find((candidate) => candidate?.userData?.editorId === 'hterrain-browser-proof');
      object.userData.editorHTerrainSurface = 'auto';
      const manifest = window.__WESTEROS_EDITOR_HTERRAIN__.buildManifest();
      const stroke = manifest.strokes.find((candidate) => candidate.id === object.userData.editorId);
      return { manifest, stroke };
    });
    if (!authored.stroke) fail('loaded authored terrain cell did not reach HTerrain manifest');
    if (authored.stroke.surface !== 'earth') fail(`Dorne map-biome auto surface should be earth, got ${authored.stroke.surface}`);
    if (authored.stroke.referenceBiome !== 'dorne') fail(`Dorne reference biome mismatch: ${authored.stroke.referenceBiome}`);
    if (authored.stroke.heightDeltaMeters !== 3.5) fail('authored height delta was not preserved');
    if (!(authored.stroke.radiusUv[0] > 0 && authored.stroke.radiusUv[1] > 0)) fail('stroke radiusUv must be positive');

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.click('#we-hterrain-export');
    const exported = await readDownload(await downloadPromise, 'westeros-hterrain');
    if (exported.schema !== 'westeros-hterrain-editor-v1') fail('downloaded schema drift');
    if (exported.mapLocked !== true || exported.mapReferenceSha256 !== EXPECTED_SHA) fail('downloaded map lock drift');
    if (!exported.strokes.some((stroke) => stroke.id === 'hterrain-browser-proof' && stroke.surface === 'earth')) {
      fail('downloaded manifest lost authored Dorne stroke');
    }

    if (consoleErrors.length || pageErrors.length) {
      fail(`browser errors: console=${consoleErrors.length} page=${pageErrors.length} ${consoleErrors.join(' | ')} ${pageErrors.join(' | ')}`);
    }
    console.log('[checkEditorHTerrainBridgeBrowser] PASS:', JSON.stringify({
      mapLocked: initial.snapshot.mapLocked,
      resolution: initial.snapshot.resolution,
      biomeZoneCount: initial.snapshot.biomeZoneCount,
      reliefChainCount: initial.snapshot.reliefChainCount,
      sceneSurfaceRoundtrip: savedRecord.terrain.hterrainSurface,
      dorneStrokeSurface: authored.stroke.surface,
      heightDeltaMeters: authored.stroke.heightDeltaMeters,
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
