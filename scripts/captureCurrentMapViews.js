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
      const { createScene } = await import('/src/3d/sceneManager.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { spawnRealCastleModels } = await import('/src/3d/world/settlements.js');
      const { AssetLoader } = await import('/src/3d/assetLoader.js');
      const { WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
      const { updateDayNightLighting } = await import('/src/3d/lighting.js');
      const { updateAuroraSky } = await import('/src/3d/sky.js');
      const { updateStarfield } = await import('/src/3d/stars.js');
      const { updateWater } = await import('/src/3d/world/water.js');

      const canvas = document.getElementById('map-capture');
      const state = createScene(canvas);
      state.renderer.setSize(width, height, false);
      state.camera.aspect = width / height;
      state.camera.updateProjectionMatrix();

      // Cover the complete configured 12.0 x 10.8 km world rectangle, not just the normal boot preview.
      state.chunkManager.loadSquare(0, 0, 12);

      // Add the same real castle-model layer the production game adds immediately after createScene().
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

      // Find the strongest live-relief point from the exact runtime sampler so the close shot
      // automatically frames the newly merged mountain system instead of a guessed coordinate.
      const sample = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const halfW = WORLD_SCALE.WORLD_WIDTH_METERS / 2;
      const halfD = WORLD_SCALE.WORLD_DEPTH_METERS / 2;
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

      function renderAt(position, target, up, fov) {
        const camera = state.camera;
        camera.fov = fov;
        camera.near = 5;
        camera.far = 40000;
        camera.aspect = width / height;
        camera.up.set(up.x, up.y, up.z);
        camera.position.set(position.x, position.y, position.z);
        camera.lookAt(target.x, target.y, target.z);
        camera.updateProjectionMatrix();
        updateAuroraSky(state.sky, camera.position, daylightElapsed, dayNight);
        updateStarfield(state.stars, camera.position, daylightElapsed, dayNight.nightFactor);
        updateWater(state.water, camera.position, daylightElapsed);
        if (state.scene.fog) state.scene.fog.density = 0;
        state.renderer.render(state.scene, camera);
      }

      window.__MAP_CAPTURE__ = {
        state,
        peak,
        world: {
          width: WORLD_SCALE.WORLD_WIDTH_METERS,
          depth: WORLD_SCALE.WORLD_DEPTH_METERS,
        },
        renderOblique() {
          const p = peak;
          renderAt(
            { x: p.x + 1850, y: Math.max(p.y + 1150, 1450), z: p.z + 2350 },
            { x: p.x, y: Math.max(p.y * 0.72, 120), z: p.z },
            { x: 0, y: 1, z: 0 },
            52,
          );
        },
        renderTopDown() {
          const fov = 48;
          const aspect = width / height;
          const halfVertical = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
          const halfHorizontalAsVertical = (WORLD_SCALE.WORLD_WIDTH_METERS * 0.5) / aspect;
          const neededHalfSpan = Math.max(halfVertical, halfHorizontalAsVertical);
          const altitude = (neededHalfSpan / Math.tan((fov * Math.PI / 180) / 2)) * 1.10;
          renderAt(
            { x: 0, y: altitude, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: -1 },
            fov,
          );
          return altitude;
        },
      };

      return { peak, worldWidth: WORLD_SCALE.WORLD_WIDTH_METERS, worldDepth: WORLD_SCALE.WORLD_DEPTH_METERS };
    }, VIEWPORT);

    await page.evaluate(() => window.__MAP_CAPTURE__.renderOblique());
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT_DIR, '01-yakin-egik-acili.png') });

    const topDownAltitude = await page.evaluate(() => window.__MAP_CAPTURE__.renderTopDown());
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT_DIR, '02-uzak-dik-ustten.png') });

    const summary = { ...setup, topDownAltitude, viewport: VIEWPORT, errors };
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log('[captureCurrentMapViews] COMPLETE', JSON.stringify(summary));

    // A few texture-loader warnings can be soft-degraded by AssetLoader; page-level JS failures may not.
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
