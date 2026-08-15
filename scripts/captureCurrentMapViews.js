#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const OUT_DIR = path.resolve('artifacts/current-map-capture');
const VIEWPORT = { width: 1600, height: 1000 };

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright is not available.');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const server = await startStaticServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });

  try {
    await page.goto(`${baseUrl}/capture-current-map.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const setup = await page.evaluate(async ({ width, height }) => {
      const THREE = await import('/src/3d/vendor/three/three.module.js');
      const { installRuntimePindexTerrainPolish } = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
      const { createScene } = await import('/src/3d/sceneManager.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { spawnRealCastleModels } = await import('/src/3d/world/settlements.js');
      const { AssetLoader } = await import('/src/3d/assetLoader.js');
      const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = await import('/src/3d/config.js');
      const { updateDayNightLighting } = await import('/src/3d/lighting.js');
      const { updateAuroraSky } = await import('/src/3d/sky.js');
      const { updateStarfield } = await import('/src/3d/stars.js');
      const { updateWater } = await import('/src/3d/world/water.js');

      // IMPORTANT: production game3d.html installs this BEFORE initGame3D/createScene.
      // The previous capture skipped it, so it was not visually equivalent to the real game page.
      installRuntimePindexTerrainPolish();

      const canvas = document.getElementById('map-capture');
      const state = createScene(canvas);
      state.controls.enabled = false;
      state.renderer.setPixelRatio(1);
      state.renderer.setSize(width, height, false);
      state.renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (state.scene.fog) state.scene.fog.density = 0;

      // Load every runtime chunk intersecting the configured world rectangle.
      const halfW = WORLD_SCALE.WORLD_WIDTH_METERS / 2;
      const halfD = WORLD_SCALE.WORLD_DEPTH_METERS / 2;
      const worldBounds = { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD };
      const size = CHUNK_CONFIG.CHUNK_SIZE_METERS;
      const minChunkX = Math.ceil(worldBounds.minX / size - 0.5);
      const maxChunkX = Math.floor(worldBounds.maxX / size + 0.5);
      const minChunkZ = Math.ceil(worldBounds.minZ / size - 0.5);
      const maxChunkZ = Math.floor(worldBounds.maxZ / size + 0.5);
      for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
        for (let x = minChunkX; x <= maxChunkX; x += 1) state.chunkManager.loadChunk(x, z);
      }

      // Hide any chunks outside the configured world rectangle that createScene may have loaded
      // around seats/preview; the full-world proof should frame exactly the current world bounds.
      let visibleTerrainMeshes = 0;
      for (const mesh of state.chunkManager.loaded.values()) {
        const coord = mesh.userData.chunkCoord;
        const visible = coord && coord.x >= minChunkX && coord.x <= maxChunkX && coord.z >= minChunkZ && coord.z <= maxChunkZ;
        mesh.visible = Boolean(visible);
        if (visible) visibleTerrainMeshes += 1;
      }

      // Add the same real castle-model layer the production game adds after createScene().
      try {
        const loader = new AssetLoader();
        state.realCastles = await spawnRealCastleModels({
          assetLoader: loader,
          seats: state.settlementSeats,
          seed: WORLD_DEFAULTS.WORLD_SEED,
        });
        state.scene.add(state.realCastles);
      } catch (error) {
        console.warn('[captureCurrentMapViews] Castle layer degraded:', error?.message ?? String(error));
      }

      // Find the strongest current live-relief point so the oblique shot frames a real mountain.
      const sample = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      let peak = { x: 0, z: 0, y: -Infinity };
      const nx = 121;
      const nz = 109;
      for (let iz = 0; iz < nz; iz += 1) {
        const z = -halfD + (iz / (nz - 1)) * WORLD_SCALE.WORLD_DEPTH_METERS;
        for (let ix = 0; ix < nx; ix += 1) {
          const x = -halfW + (ix / (nx - 1)) * WORLD_SCALE.WORLD_WIDTH_METERS;
          const y = sample(x, z);
          if (y > peak.y) peak = { x, y, z };
        }
      }

      const daylightElapsed = ((0.42 - WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO + 1) % 1) * WORLD_DEFAULTS.DAY_LENGTH_SECONDS;
      const dayNight = updateDayNightLighting(
        state.lights,
        daylightElapsed,
        WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
        WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO,
      );
      // A lower side light makes the true terrain normals visible from both requested angles.
      state.lights.sun.position.set(-WORLD_SCALE.WORLD_WIDTH_METERS * 0.45, 3200, -WORLD_SCALE.WORLD_DEPTH_METERS * 0.45);
      state.lights.sun.intensity = 2.0;
      state.lights.hemisphere.intensity = 0.38;

      state.water.geometry.computeBoundingBox();
      const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;

      function prepareCommon(camera, elapsed = daylightElapsed) {
        updateAuroraSky(state.sky, camera.position, elapsed, dayNight);
        updateStarfield(state.stars, camera.position, elapsed, dayNight.nightFactor);
        if (state.scene.fog) state.scene.fog.density = 0;
      }

      function enlargeWaterToMeters(coverageMeters) {
        const scale = coverageMeters / waterExtent;
        state.water.scale.set(scale, 1, scale);
        return scale;
      }

      function restoreLiveWaterDepth() {
        // createScene already attached the production depth field; keep the material itself untouched.
        // This function intentionally exists only as a semantic marker for the oblique/live-water path.
      }

      window.__MAP_CAPTURE__ = {
        state,
        peak,
        world: { width: WORLD_SCALE.WORLD_WIDTH_METERS, depth: WORLD_SCALE.WORLD_DEPTH_METERS },
        visibleTerrainMeshes,
        renderOblique() {
          restoreLiveWaterDepth();
          const p = peak;
          const camera = state.camera;
          camera.fov = 52;
          camera.near = 5;
          camera.far = 40000;
          camera.aspect = width / height;
          camera.up.set(0, 1, 0);
          // Peak is in the eastern half; place the camera farther east so the enlarged sea plane
          // remains visible beyond the world edge while still reading as a close oblique view.
          camera.position.set(p.x + 2250, Math.max(p.y + 1450, 1750), p.z + 2800);
          camera.lookAt(p.x - 250, Math.max(p.y * 0.55, 120), p.z - 250);
          camera.updateProjectionMatrix();
          // The production 4 km plane follows a near gameplay camera. For this inspection shot,
          // scale the SAME shader/material capture-only so its edge cannot appear in a multi-km frame.
          const coverage = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS, WORLD_SCALE.WORLD_DEPTH_METERS) * 1.55;
          enlargeWaterToMeters(coverage);
          updateWater(state.water, camera.position, daylightElapsed);
          prepareCommon(camera);
          state.renderer.render(state.scene, camera);
          return { waterCoverageMeters: coverage, camera: camera.position.toArray() };
        },
        renderTopDown() {
          // Match the corrected full-world proof approach from the prior terrain review: true 90°
          // orthographic camera, full frustum water coverage, and a calm deep far-field so the near-
          // camera foam/swell shader cannot alias into cyan 'fake lakes' from ~9 km above.
          const aspect = width / height;
          const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * aspect / 2) * 1.025;
          const halfHeight = halfWidth / aspect;
          const cameraHeight = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS, WORLD_SCALE.WORLD_DEPTH_METERS) * 0.78 + peak.y;
          const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000);
          camera.up.set(0, 0, -1);
          camera.position.set(0, cameraHeight, 0);
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);

          const waterCoverageMeters = Math.max(halfWidth * 2, halfHeight * 2) * 1.05;
          enlargeWaterToMeters(waterCoverageMeters);
          updateWater(state.water, camera.position, 0);
          state.water.position.x = 0;
          state.water.position.z = 0;

          // Capture-only far-field treatment copied from the already-qualified PR #524 method.
          const proofDepthTexture = new THREE.DataTexture(
            new Uint8Array([255, 255, 255, 255]),
            1,
            1,
            THREE.RGBAFormat,
            THREE.UnsignedByteType,
          );
          proofDepthTexture.needsUpdate = true;
          state.water.material.uniforms.uDepthMap.value = proofDepthTexture;
          state.water.material.uniforms.uDepthFieldExtentMeters.value = 1;
          state.water.material.uniforms.uSwellStrength.value = 0;
          state.water.material.uniforms.uSunDirection.value.set(1, 0, 0);

          // Keep the real terrain geometry at 1x height. Only the water-frustum treatment is changed.
          state.sky.visible = false;
          state.stars.visible = false;
          state.scene.background.setHex(0x0a3a4a);
          if (state.scene.fog) state.scene.fog.density = 0;
          state.renderer.render(state.scene, camera);
          return { cameraHeight, waterCoverageMeters, halfWidth, halfHeight };
        },
      };

      return {
        peak,
        worldWidth: WORLD_SCALE.WORLD_WIDTH_METERS,
        worldDepth: WORLD_SCALE.WORLD_DEPTH_METERS,
        visibleTerrainMeshes,
      };
    }, VIEWPORT);

    const oblique = await page.evaluate(() => window.__MAP_CAPTURE__.renderOblique());
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(OUT_DIR, '01-yakin-egik-acili.png') });

    const topDown = await page.evaluate(() => window.__MAP_CAPTURE__.renderTopDown());
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(OUT_DIR, '02-uzak-dik-ustten.png') });

    const summary = { ...setup, oblique, topDown, viewport: VIEWPORT, errors };
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log('[captureCurrentMapViews] COMPLETE', JSON.stringify(summary));

    if (errors.some((entry) => entry.startsWith('page:'))) process.exitCode = 1;
  } finally {
    await page.close();
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error('[captureCurrentMapViews] FAIL:', error);
  process.exit(1);
});
