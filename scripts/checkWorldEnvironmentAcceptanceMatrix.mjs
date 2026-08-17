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
const PROOF_ELAPSED_SECONDS = 23;
const PROOF_DAY_RATIO = 0.5;
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
    const { CURRENT_TERRAIN_POLICY } = await import('/src/3d/world/terrain.js');
    const { updateDayNightLighting } = await import('/src/3d/lighting.js');
    const { updateAuroraSky } = await import('/src/3d/sky.js');
    const { updateStarfield } = await import('/src/3d/stars.js');
    const { updateFog } = await import('/src/3d/fog.js');
    const { focusSunShadow } = await import('/src/3d/renderQuality.js');

    const state = createScene(document.getElementById('world-acceptance'));
    state.controls.enabled = false;
    const proofFog = state.scene.fog;
    state.scene.fog = null;
    state.renderer.setPixelRatio(1);
    state.renderer.setSize(width, height, false);
    state.chunkManager.loadSquare(0, 0, 12);

    const terrainMeshes = [...state.chunkManager.loaded.values()];
    const world = {
      width: WORLD_SCALE.WORLD_WIDTH_METERS,
      depth: WORLD_SCALE.WORLD_DEPTH_METERS,
      bounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    };
    globalThis.__worldAcceptance = {
      THREE, state, world, normalizedReferenceToWorldXZ, proofFog,
      updateDayNightLighting, updateAuroraSky, updateStarfield, updateFog, focusSunShadow,
    };
    return {
      terrainMeshCount: terrainMeshes.length,
      terrainPolicy: CURRENT_TERRAIN_POLICY.id,
      fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage,
      singleSourceViolations: terrainMeshes.filter((mesh) => mesh.userData.currentTerrainSingleSource !== true).length,
      world,
    };
  }, { width: WIDTH, height: HEIGHT });

  assert(boot.terrainMeshCount >= 500, `incomplete full-world terrain: ${boot.terrainMeshCount} meshes`);
  assert(boot.fullOwnerMapCoverage === true, 'terrain policy lost full-owner-map coverage');
  assert(boot.singleSourceViolations === 0, `single-height-source violations: ${boot.singleSourceViolations}`);

  const fullMetrics = await page.evaluate(({ width, height, elapsedSeconds, dayRatio }) => {
    const {
      THREE, state, world, updateDayNightLighting, updateAuroraSky, updateStarfield, focusSunShadow,
    } = globalThis.__worldAcceptance;
    const aspect = width / height;
    const halfWidth = Math.max(world.width / 2, world.depth * aspect / 2) * 1.025;
    const halfHeight = halfWidth / aspect;
    const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 13000, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    state.scene.fog = null;
    const dayNight = updateDayNightLighting(state.lights, 0, 3600, dayRatio);
    updateAuroraSky(state.sky, camera.position, elapsedSeconds, dayNight);
    updateStarfield(state.stars, camera.position, elapsedSeconds, dayNight.nightFactor);
    focusSunShadow(state.lights.sun, 0, 0, 0);
    state.renderer.render(state.scene, camera);
    return {
      camera: 'orthographic', pitchDegrees: 90,
      sceneChildren: state.scene.children.length,
      rendererTriangles: state.renderer.info.render.triangles,
      rendererCalls: state.renderer.info.render.calls,
      proofDayRatio: dayNight.timeRatio,
    };
  }, { width: WIDTH, height: HEIGHT, elapsedSeconds: PROOF_ELAPSED_SECONDS, dayRatio: PROOF_DAY_RATIO });
  const fullPng = await page.screenshot({ type: 'png' });
  assert(fullPng.length > 4096, 'full-world proof PNG unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'full-world-orthographic.png'), fullPng);

  const sampleMetrics = [];
  for (const sample of samples) {
    const metrics = await page.evaluate(({ sample, width, height, elapsedSeconds, dayRatio }) => {
      const {
        THREE, state, world, normalizedReferenceToWorldXZ, proofFog,
        updateDayNightLighting, updateAuroraSky, updateStarfield, updateFog, focusSunShadow,
      } = globalThis.__worldAcceptance;
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

      // Mirror the shipped frame-order that game3d.js uses: day/night first, then camera-centered
      // atmosphere and the shadow frustum. Earlier evidence skipped these per-frame updates, leaving
      // distant proof cameras outside the 1900m sky sphere and incorrectly rendering black sky.
      const dayNight = updateDayNightLighting(state.lights, 0, 3600, dayRatio);
      updateAuroraSky(state.sky, camera.position, elapsedSeconds, dayNight);
      updateStarfield(state.stars, camera.position, elapsedSeconds, dayNight.nightFactor);
      state.scene.fog = proofFog;
      updateFog(proofFog, dayNight);
      focusSunShadow(state.lights.sun, target.x, groundY, target.z);
      state.renderer.render(state.scene, camera);
      return {
        id: sample.id,
        target,
        groundHit: Boolean(hit),
        groundY,
        rendererCalls: state.renderer.info.render.calls,
        rendererTriangles: state.renderer.info.render.triangles,
        proofDayRatio: dayNight.timeRatio,
        skyDistanceToCamera: state.sky.position.distanceTo(camera.position),
        starDistanceToCamera: state.stars.position.distanceTo(camera.position),
        fogEnabled: Boolean(state.scene.fog),
      };
    }, {
      sample, width: WIDTH, height: HEIGHT,
      elapsedSeconds: PROOF_ELAPSED_SECONDS, dayRatio: PROOF_DAY_RATIO,
    });
    assert(metrics.groundHit, `${sample.id}: no terrain ground hit at deterministic sample`);
    assert(Number.isFinite(metrics.groundY), `${sample.id}: invalid terrain height`);
    assert(metrics.rendererCalls > 0, `${sample.id}: scene produced zero draw calls`);
    assert(metrics.skyDistanceToCamera < 1e-6, `${sample.id}: sky was not camera-centered`);
    assert(metrics.starDistanceToCamera < 1e-6, `${sample.id}: stars were not camera-centered`);
    assert(metrics.fogEnabled, `${sample.id}: shipped atmospheric fog was not enabled`);
    const png = await page.screenshot({ type: 'png' });
    assert(png.length > 4096, `${sample.id}: near proof PNG unexpectedly small`);
    fs.writeFileSync(path.join(OUT_DIR, `${sample.id}-terrain-near.png`), png);
    sampleMetrics.push({ ...metrics, sha256: hash(png) });
  }

  assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
  const report = {
    resolution: [WIDTH, HEIGHT],
    deterministicSamples: samples,
    proofFrame: { elapsedSeconds: PROOF_ELAPSED_SECONDS, dayRatio: PROOF_DAY_RATIO },
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