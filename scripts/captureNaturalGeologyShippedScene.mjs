#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, 'artifacts/natural-geology-morphology');
const WIDTH = 1536;
const HEIGHT = 1024;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const playwright = devServerHelper.loadPlaywright();
assert(playwright, 'Playwright is required for shipped natural geology proof');
await fs.mkdir(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => {
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports: {
      three: '/src/3d/vendor/three/three.module.js',
      'three/addons/': '/src/3d/vendor/three/addons/',
    } });
    document.head.append(importMap);
  });

  const boot = await page.evaluate(async ({ width, height }) => {
    document.body.innerHTML = '<canvas id="geology-proof"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
    const { NATURAL_GEOLOGY_PLACEMENT_POLICY } = await import('/src/3d/world/naturalGeologyPlacement.js');
    const { updateWater } = await import('/src/3d/world/water.js');
    const state = createScene(document.getElementById('geology-proof'));
    state.controls.enabled = false;
    state.renderer.setPixelRatio(1);
    state.renderer.setSize(width, height, false);
    state.chunkManager.loadSquare(0, 0, 12);

    const placements = [...(state.naturalGeology.userData.naturalGeologyPlacements ?? [])];
    const kinds = {};
    const roles = {};
    let groundingViolations = 0;
    let shorelineViolations = 0;
    let spacingViolations = 0;
    let nonFinitePlacements = 0;
    let minimumPairDistanceMeters = Infinity;
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      kinds[placement.kind] = (kinds[placement.kind] ?? 0) + 1;
      roles[placement.formationRole] = (roles[placement.formationRole] ?? 0) + 1;
      if (![placement.x, placement.y, placement.z, placement.scale?.x, placement.scale?.y, placement.scale?.z].every(Number.isFinite)) nonFinitePlacements++;
      const ground = state.groundCollider.getGroundHeight(placement.x, placement.z);
      const expectedY = ground - placement.scale.y * placement.buryFraction;
      if (Math.abs(placement.y - expectedY) > 1e-5) groundingViolations++;
      if (ground - WORLD_DEFAULTS.WATER_LEVEL_METERS <= NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters) shorelineViolations++;
      for (let otherIndex = index + 1; otherIndex < placements.length; otherIndex += 1) {
        const other = placements[otherIndex];
        const distance = Math.hypot(placement.x - other.x, placement.z - other.z);
        minimumPairDistanceMeters = Math.min(minimumPairDistanceMeters, distance);
        if (distance + 1e-7 < Math.max(placement.minimumSpacingMeters, other.minimumSpacingMeters)) spacingViolations++;
      }
    }
    const renderMeshes = [];
    state.naturalGeology.traverse((node) => { if (node.isMesh || node.isInstancedMesh) renderMeshes.push(node); });
    const placeholderMeshes = renderMeshes.filter((mesh) => mesh.userData?.isPlaceholder).length;
    const target = [...placements].sort((a, b) => {
      const priority = (value) => value.formationRole === 'ridge-scarp' ? 3 : value.formationRole === 'talus-apron' ? 2 : value.kind === 'bedrock' ? 1 : 0;
      return priority(b) - priority(a) || (b.score ?? 0) - (a.score ?? 0);
    })[0];
    if (!target) throw new Error('no shipped natural geology placement available for visual proof');

    const originalFog = state.scene.fog;
    state.scene.fog = null;
    const aspect = width / height;
    const halfHeight = WORLD_SCALE.WORLD_DEPTH_METERS * 0.58;
    const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS * 0.55, halfHeight * aspect);
    const fullCamera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 40000);
    fullCamera.position.set(0, 18000, 0);
    fullCamera.up.set(0, 0, -1);
    fullCamera.lookAt(0, WORLD_DEFAULTS.WATER_LEVEL_METERS, 0);
    fullCamera.updateProjectionMatrix();
    updateWater(state.water, fullCamera.position, 23);
    state.renderer.render(state.scene, fullCamera);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state.renderer.render(state.scene, fullCamera);

    globalThis.__geologyProof = {
      THREE,
      state,
      originalFog,
      target,
      fullCamera,
      placements,
      metrics: {
        policyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
        placementCount: placements.length,
        kinds,
        roles,
        renderMeshCount: renderMeshes.length,
        instancedMeshCount: renderMeshes.filter((mesh) => mesh.isInstancedMesh).length,
        placeholderMeshes,
        groundingViolations,
        shorelineViolations,
        spacingViolations,
        nonFinitePlacements,
        minimumPairDistanceMeters,
        loadedTerrainChunks: state.chunkManager.loadedCount,
        fullCameraType: fullCamera.type,
      },
    };
    return globalThis.__geologyProof.metrics;
  }, { width: WIDTH, height: HEIGHT });

  assert(pageErrors.length === 0, `createScene page errors: ${pageErrors.join(' | ')}`);
  assert(boot.placementCount >= 80, `shipped geology unexpectedly sparse: ${boot.placementCount}`);
  assert(boot.renderMeshCount >= 4, `natural geology render families missing: ${boot.renderMeshCount}`);
  assert(boot.instancedMeshCount >= 3, `natural geology lost instancing: ${boot.instancedMeshCount}`);
  assert(boot.placeholderMeshes === 0, `placeholder geology meshes: ${boot.placeholderMeshes}`);
  assert(boot.groundingViolations === 0, `visual/collider grounding mismatches: ${boot.groundingViolations}`);
  assert(boot.shorelineViolations === 0, `geology inside shoreline reserve: ${boot.shorelineViolations}`);
  assert(boot.spacingViolations === 0, `geology pair spacing violations: ${boot.spacingViolations}`);
  assert(boot.nonFinitePlacements === 0, `non-finite geology placements: ${boot.nonFinitePlacements}`);
  assert(Object.keys(boot.roles).length >= 2, `canonical morphology collapsed to one role: ${JSON.stringify(boot.roles)}`);
  assert(boot.fullCameraType === 'OrthographicCamera');
  assert(boot.loadedTerrainChunks >= 500, `full-world terrain coverage incomplete: ${boot.loadedTerrainChunks}`);

  const fullPath = path.join(OUT, 'full-world-1536x1024.png');
  await page.screenshot({ path: fullPath, type: 'png' });

  const near = await page.evaluate(async ({ width, height }) => {
    const { state, target, originalFog } = globalThis.__geologyProof;
    state.scene.fog = originalFog;
    state.renderer.setSize(width, height, false);
    const ground = state.groundCollider.getGroundHeight(target.x, target.z);
    state.camera.position.set(target.x + 105, ground + 58, target.z + 132);
    state.camera.near = 0.1;
    state.camera.far = 2600;
    state.camera.aspect = width / height;
    state.camera.lookAt(target.x, target.y + Math.max(3, target.scale.y * 0.28), target.z);
    state.camera.updateProjectionMatrix();
    state.renderer.render(state.scene, state.camera);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    state.renderer.render(state.scene, state.camera);
    return {
      targetId: target.id,
      kind: target.kind,
      formationRole: target.formationRole,
      slopeDegrees: target.slopeDegrees,
      localReliefMeters: target.localReliefMeters,
      ridgeExposure: target.ridgeExposure,
      talusPotential: target.talusPotential,
      cameraPosition: state.camera.position.toArray(),
      targetPosition: [target.x, target.y, target.z],
    };
  }, { width: WIDTH, height: HEIGHT });
  const nearPath = path.join(OUT, 'terrain-near-1536x1024.png');
  await page.screenshot({ path: nearPath, type: 'png' });

  const summary = { ...boot, near, screenshots: [path.relative(ROOT, fullPath), path.relative(ROOT, nearPath)] };
  await fs.writeFile(path.join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log('[captureNaturalGeologyShippedScene] PASS');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close().catch(() => {});
  await server.stop().catch(() => {});
}
