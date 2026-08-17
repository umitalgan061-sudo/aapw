#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(ROOT, 'artifacts/world-environment-acceptance');
const WIDTH = 1536;
const HEIGHT = 1024;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const playwright = devServerHelper.loadPlaywright();
assert(Boolean(playwright), 'Playwright is required for world environment acceptance');
fs.mkdirSync(OUT_DIR, { recursive: true });

const server = await devServerHelper.startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
});

const samples = [
  { id: 'northwest', u: 0.18, v: 0.18 },
  { id: 'northeast', u: 0.82, v: 0.20 },
  { id: 'center', u: 0.50, v: 0.50 },
  { id: 'southwest', u: 0.22, v: 0.78 },
  { id: 'southeast', u: 0.80, v: 0.80 },
];

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
    waitUntil: 'load', timeout: 30000,
  });
  await page.evaluate(() => {
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: {
      three: '/src/3d/vendor/three/three.module.js',
      'three/addons/': '/src/3d/vendor/three/addons/',
    } });
    document.head.append(map);
  });

  const boot = await page.evaluate(async ({ width, height }) => {
    document.body.innerHTML = '<canvas id="world-acceptance"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_SCALE } = await import('/src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { CURRENT_TERRAIN_POLICY, CURRENT_TERRAIN_ALBEDO_POLICY } = await import('/src/3d/world/terrain.js');

    const state = createScene(document.getElementById('world-acceptance'));
    state.controls.enabled = false;
    state.scene.fog = null;
    state.renderer.setPixelRatio(1);
    state.renderer.setSize(width, height, false);
    state.chunkManager.loadSquare(0, 0, 12);

    const terrainMeshes = [...state.chunkManager.loaded.values()];
    const terrainTextures = terrainMeshes.map((mesh) => mesh.material?.map).filter(Boolean);
    const world = {
      width: WORLD_SCALE.WORLD_WIDTH_METERS,
      depth: WORLD_SCALE.WORLD_DEPTH_METERS,
      bounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    };
    globalThis.__worldAcceptance = { THREE, state, world, normalizedReferenceToWorldXZ };
    return {
      terrainMeshCount: terrainMeshes.length,
      terrainPolicy: CURRENT_TERRAIN_POLICY.id,
      terrainAlbedoPolicy: CURRENT_TERRAIN_ALBEDO_POLICY.id,
      terrainAlbedoAsset: CURRENT_TERRAIN_ALBEDO_POLICY.assetPath,
      fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage,
      singleSourceViolations: terrainMeshes.filter((mesh) => mesh.userData.currentTerrainSingleSource !== true).length,
      albedoAdoptionViolations: terrainMeshes.filter((mesh) => (
        mesh.userData.currentTerrainAlbedo?.policyId !== CURRENT_TERRAIN_ALBEDO_POLICY.id
        || mesh.userData.currentTerrainAlbedo?.mapAlignedUv !== true
        || mesh.userData.currentTerrainAlbedo?.textureEnabled !== true
        || mesh.material?.isMeshStandardMaterial !== true
        || mesh.material?.map?.userData?.terrainAlbedoPolicy !== CURRENT_TERRAIN_ALBEDO_POLICY.id
      )).length,
      texturedTerrainCount: terrainTextures.length,
      sharedAlbedoTextureCount: new Set(terrainTextures.map((texture) => texture.uuid)).size,
      world,
    };
  }, { width: WIDTH, height: HEIGHT });

  assert(boot.terrainMeshCount >= 500, `incomplete full-world terrain: ${boot.terrainMeshCount} meshes`);
  assert(boot.fullOwnerMapCoverage === true, 'terrain policy lost full-owner-map coverage');
  assert(boot.singleSourceViolations === 0, `single-height-source violations: ${boot.singleSourceViolations}`);
  assert(boot.albedoAdoptionViolations === 0, `map-aligned terrain albedo adoption violations: ${boot.albedoAdoptionViolations}`);
  assert(boot.texturedTerrainCount === boot.terrainMeshCount, `textured terrain ${boot.texturedTerrainCount}/${boot.terrainMeshCount}`);
  assert(boot.sharedAlbedoTextureCount === 1, `terrain chunks must share one albedo texture, got ${boot.sharedAlbedoTextureCount}`);

  const fullMetrics = await page.evaluate(({ width, height }) => {
    const { THREE, state, world } = globalThis.__worldAcceptance;
    const aspect = width / height;
    const halfWidth = Math.max(world.width / 2, world.depth * aspect / 2) * 1.025;
    const halfHeight = halfWidth / aspect;
    const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 13000, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    state.renderer.render(state.scene, camera);
    return {
      camera: 'orthographic', pitchDegrees: 90,
      sceneChildren: state.scene.children.length,
      rendererTriangles: state.renderer.info.render.triangles,
      rendererCalls: state.renderer.info.render.calls,
    };
  }, { width: WIDTH, height: HEIGHT });
  const fullPng = await page.screenshot({ type: 'png' });
  assert(fullPng.length > 4096, 'full-world proof PNG unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'full-world-orthographic.png'), fullPng);

  const sampleMetrics = [];
  for (const sample of samples) {
    const metrics = await page.evaluate(({ sample, width, height }) => {
      const { THREE, state, world, normalizedReferenceToWorldXZ } = globalThis.__worldAcceptance;
      const target = normalizedReferenceToWorldXZ(sample.u, sample.v, world.bounds, world.metersPerMapUnit);
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(target.x, 12000, target.z),
        new THREE.Vector3(0, -1, 0),
        0,
        24000,
      );
      const terrainMeshes = [...state.chunkManager.loaded.values()];
      const hit = raycaster.intersectObjects(terrainMeshes, false)[0] ?? null;
      const groundY = hit?.point?.y ?? 0;
      const camera = new THREE.PerspectiveCamera(48, width / height, 1, 24000);
      camera.position.set(target.x - 420, groundY + 260, target.z + 520);
      camera.lookAt(target.x, groundY + 35, target.z);
      camera.updateProjectionMatrix();
      state.renderer.render(state.scene, camera);
      return {
        id: sample.id,
        target,
        groundHit: Boolean(hit),
        groundY,
        rendererCalls: state.renderer.info.render.calls,
        rendererTriangles: state.renderer.info.render.triangles,
      };
    }, { sample, width: WIDTH, height: HEIGHT });
    assert(metrics.groundHit, `${sample.id}: no terrain ground hit at deterministic sample`);
    assert(Number.isFinite(metrics.groundY), `${sample.id}: invalid terrain height`);
    assert(metrics.rendererCalls > 0, `${sample.id}: scene produced zero draw calls`);
    const png = await page.screenshot({ type: 'png' });
    assert(png.length > 4096, `${sample.id}: near proof PNG unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, `${sample.id}-terrain-near.png`), png);
    sampleMetrics.push({ ...metrics, sha256: hash(png) });
  }

  assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
  const report = {
    resolution: [WIDTH, HEIGHT],
    deterministicSamples: samples,
    boot,
    full: { ...fullMetrics, sha256: hash(fullPng) },
    near: sampleMetrics,
    browserErrors,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'world-environment-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`WORLD_ENVIRONMENT_ACCEPTANCE=${JSON.stringify(report)}`);
  console.log('WORLD_ENVIRONMENT_ACCEPTANCE_OK');
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
