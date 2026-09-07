#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'geographic-ambient-character');
const fail = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright bulunamadı.');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('response', (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });

  try {
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const result = await page.evaluate(async ({ port: serverPort }) => {
      const THREE = await import('three');
      const { createScene } = await import('/src/3d/sceneManager.js');
      const { AssetLoader } = await import('/src/3d/assetLoader.js');
      const { gameEvents } = await import('/src/3d/eventBus.js');
      const { WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
      const { createGeographicAmbientCharacterDirector, GEOGRAPHIC_AMBIENT_POLICY, AMBIENT_CHARACTER_ASSETS } = await import('/src/3d/world/geographicAmbientCharacterDirector.js');
      const { validateMaterialAssignment } = await import('/src/3d/materials/MaterialAssignmentCore.js');

      const errors = [];
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const canvas = document.createElement('canvas');
      canvas.id = 'geographic-ambient-proof-canvas';
      canvas.width = 1200;
      canvas.height = 700;
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:700px;z-index:99999;background:#10151a';
      document.body.appendChild(canvas);

      const state = createScene(canvas);
      check(state?.scene?.isScene, 'canonical createScene() did not produce a Three.js Scene');
      check(state?.groundCollider && typeof state.groundCollider.getGroundHeight === 'function', 'canonical ground collider sampler is unavailable');
      check(Array.isArray(state.settlementSeats) && state.settlementSeats.length > 0, 'canonical settlement-seat set is unavailable');
      check(Array.isArray(state.roadEdges), 'canonical road edge set is unavailable');

      const loader = new AssetLoader({ events: gameEvents });
      const director = await createGeographicAmbientCharacterDirector({
        assetLoader: loader,
        scene: state.scene,
        settlementSeats: state.settlementSeats,
        roadEdges: state.roadEdges,
        groundCollider: state.groundCollider,
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
        waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        seed: WORLD_DEFAULTS.WORLD_SEED,
        maxInstances: GEOGRAPHIC_AMBIENT_POLICY.desktopBudget,
      });

      const proof = director.getProofSnapshot();
      check(proof.sourceMapId === 'owner-world-map-2026-08-08', `unexpected source map id: ${proof.sourceMapId}`);
      check(proof.sourceMapSha256.length === 64, 'source map SHA-256 is not pinned');
      check(proof.requested <= GEOGRAPHIC_AMBIENT_POLICY.desktopBudget, 'desktop budget exceeded');
      check(proof.accepted >= 0, 'accepted count invalid');
      check(proof.rejected >= 0, 'rejected count invalid');
      check(proof.assetLoads.length === new Set(proof.assetLoads.map((asset) => asset.src)).size, 'asset family should be hydrated once per unique source path');
      check(proof.assetLoads.length <= Object.keys(AMBIENT_CHARACTER_ASSETS).length, 'unexpected asset family count');
      check(proof.assetLoads.every((asset) => asset.ok), `asset hydration failure: ${JSON.stringify(proof.assetLoads)}`);
      check(proof.assetLoads.every((asset) => asset.meshCount > 0), 'every loaded ambient model must contain renderable meshes');
      check(proof.assetLoads.every((asset) => asset.surfaceCount > 0), 'every loaded ambient model must expose material surfaces');
      check(proof.placements.every((placement) => placement.manifestValid), 'every placed ambient character must have a valid placement/material manifest');
      check(proof.placements.every((placement) => Number.isFinite(placement.position.y)), 'ambient character ground alignment must be finite');
      check(proof.placements.every((placement) => placement.groundSlopeDegrees <= GEOGRAPHIC_AMBIENT_POLICY.maxSlopeDegrees), 'accepted ambient character exceeds slope limit');
      check(proof.placements.every((placement) => placement.roadDistanceMeters == null || placement.roadDistanceMeters >= GEOGRAPHIC_AMBIENT_POLICY.minRoadDistanceMeters), 'accepted ambient character is too close to a road corridor');
      check(proof.placements.every((placement) => placement.settlementDistanceMeters == null || placement.settlementDistanceMeters >= GEOGRAPHIC_AMBIENT_POLICY.minSettlementDistanceMeters), 'accepted ambient character is inside settlement core');

      const materialAudits = [];
      for (const entry of director.group.children) {
        const audit = validateMaterialAssignment(entry, { requireGeneratedTexture: false });
        materialAudits.push({ id: entry.userData.geographicAmbientId, ok: audit.ok, errors: audit.errors, warnings: audit.warnings, meshCount: audit.meshCount, surfaceCount: audit.surfaceCount, generatedMaterialCount: audit.generatedMaterialCount });
        check(audit.ok, `material assignment failed for ${entry.userData.geographicAmbientId}: ${audit.errors.join(',')}`);
      }
      check(materialAudits.length === proof.accepted, 'proof accepted count must equal rendered child count');
      check(materialAudits.every((audit) => audit.meshCount > 0 && audit.surfaceCount > 0), 'placed model audit returned empty geometry');

      const camera = new THREE.PerspectiveCamera(62, 1200 / 700, 0.1, 4000);
      const focus = state.settlementSeats[0];
      camera.position.set(focus.x + 170, focus.y + 90, focus.z + 210);
      camera.lookAt(focus.x, focus.y, focus.z);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1200, 700, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      renderer.render(state.scene, camera);
      const pixels = renderer.readRenderTargetPixels ? null : null;
      void pixels;

      director.update(camera.position, 0.20);
      const visibleBefore = director.getProofSnapshot().visibleCount;
      director.update({ x: camera.position.x + GEOGRAPHIC_AMBIENT_POLICY.hideDistanceMeters + 10, z: camera.position.z }, 0.20);
      const visibleAfterFar = director.group.children.filter((child) => child.visible).length;
      check(visibleAfterFar <= visibleBefore, 'distance culling should never increase visible ambient population');
      director.update(camera.position, 0.20);
      const visibleAfterReturn = director.group.children.filter((child) => child.visible).length;
      check(visibleAfterReturn >= 0 && visibleAfterReturn <= proof.accepted, 'visible count escaped population bounds');

      const summary = {
        policy: GEOGRAPHIC_AMBIENT_POLICY.id,
        sourceMapId: proof.sourceMapId,
        sourceMapSha256: proof.sourceMapSha256,
        accepted: proof.accepted,
        rejected: proof.rejected,
        assetLoads: proof.assetLoads,
        placements: proof.placements,
        materialAudits,
        visibleBefore,
        visibleAfterFar,
        visibleAfterReturn,
        viewport: { width: 1200, height: 700 },
        worldState: { settlementCount: state.settlementSeats.length, roadEdgeCount: state.roadEdges.length },
      };

      director.dispose();
      renderer.dispose();
      return summary;
    }, { port });

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'geographic-ambient-browser.png'), fullPage: false });
    fs.writeFileSync(path.join(OUT, 'geographic-ambient-proof.json'), `${JSON.stringify(result, null, 2)}\n`);

    fail(httpErrors.length === 0, `HTTP errors: ${httpErrors.join(' | ')}`);
    fail(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    fail(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    console.log(`[checkGeographicAmbientCharacterBrowser] PASS: ${JSON.stringify(result)}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkGeographicAmbientCharacterBrowser] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
