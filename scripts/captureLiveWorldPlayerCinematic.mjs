#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const OUT_DIR = path.resolve('artifacts/live-world-player-cinematic');
const META_PATH = path.join(OUT_DIR, 'real-live-world-player-cinematic.json');
const need = (condition, message) => { if (!condition) throw new Error(`[captureLiveWorldPlayerCinematic] ${message}`); };

const playwright = loadPlaywright();
need(playwright, 'Playwright unavailable');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30_000 });

  const frame = await page.evaluate(async ({ width, height }) => {
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports: {
      three: '/src/3d/vendor/three/three.module.js',
      'three/addons/': '/src/3d/vendor/three/addons/',
    } });
    document.head.append(importMap);

    const [THREE, sceneModule, configModule, waterModule, lightingModule, skyModule] = await Promise.all([
      import('/src/3d/vendor/three/three.module.js'),
      import('/src/3d/sceneManager.js'),
      import('/src/3d/config.js'),
      import('/src/3d/world/water.js'),
      import('/src/3d/lighting.js'),
      import('/src/3d/sky.js'),
    ]);
    const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;

    document.body.innerHTML = [
      '<canvas id="runtime-world"></canvas>',
      '<canvas id="proof-coast-player"></canvas>',
      '<canvas id="proof-mountain-player"></canvas>',
      '<canvas id="proof-settlement-player"></canvas>',
    ].join('');
    Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
    const runtimeCanvas = document.getElementById('runtime-world');
    Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
    for (const id of ['proof-coast-player', 'proof-mountain-player', 'proof-settlement-player']) {
      const canvas = document.getElementById(id);
      canvas.width = width;
      canvas.height = height;
      Object.assign(canvas.style, { display: 'block', width: `${width}px`, height: `${height}px` });
    }

    const state = sceneModule.createScene(runtimeCanvas);
    state.controls.enabled = false;
    state.scene.fog = null;
    state.stars.visible = false;
    state.sky.visible = true;
    state.renderer.setPixelRatio(1);
    state.renderer.setSize(width, height, false);
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const worldBounds = {
      minX: -WORLD_SCALE.WORLD_WIDTH_METERS / 2,
      maxX: WORLD_SCALE.WORLD_WIDTH_METERS / 2,
      minZ: -WORLD_SCALE.WORLD_DEPTH_METERS / 2,
      maxZ: WORLD_SCALE.WORLD_DEPTH_METERS / 2,
    };
    const worldWidth = worldBounds.maxX - worldBounds.minX;
    const worldDepth = worldBounds.maxZ - worldBounds.minZ;
    const size = CHUNK_CONFIG.CHUNK_SIZE_METERS;
    const minChunkX = Math.ceil(worldBounds.minX / size - 0.5);
    const maxChunkX = Math.floor(worldBounds.maxX / size + 0.5);
    const minChunkZ = Math.ceil(worldBounds.minZ / size - 0.5);
    const maxChunkZ = Math.floor(worldBounds.maxZ / size + 0.5);
    for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
      for (let x = minChunkX; x <= maxChunkX; x += 1) state.chunkManager.loadChunk(x, z);
    }
    const terrainMeshes = [...state.chunkManager.loaded.values()].filter((mesh) => {
      const { x, z } = mesh.userData.chunkCoord;
      mesh.visible = x >= minChunkX && x <= maxChunkX && z >= minChunkZ && z <= maxChunkZ;
      return mesh.visible;
    });

    state.water.geometry.computeBoundingBox();
    const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
    state.water.scale.set(Math.max(worldWidth, worldDepth) * 1.04 / waterExtent, 1, Math.max(worldWidth, worldDepth) * 1.04 / waterExtent);
    state.water.position.set(0, state.water.position.y, 0);
    const daylight = lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);
    state.scene.background.copy(daylight.horizonColor);
    state.scene.updateMatrixWorld(true);
    await new Promise((resolve) => setTimeout(resolve, 3500));

    const sampleHeight = state.groundCollider.getGroundHeight;
    const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
    const dirs = Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return new THREE.Vector2(Math.cos(angle), Math.sin(angle));
    });

    let coast = null;
    const coastRadius = 650;
    for (let z = worldBounds.minZ + 700; z <= worldBounds.maxZ - 700; z += 240) {
      for (let x = worldBounds.minX + 700; x <= worldBounds.maxX - 700; x += 240) {
        const h = sampleHeight(x, z);
        if (h < sea - 10 || h > sea + 80) continue;
        const samples = dirs.map((dir) => ({ dir, h: sampleHeight(x + dir.x * coastRadius, z + dir.y * coastRadius) }));
        const low = samples.reduce((a, b) => b.h < a.h ? b : a);
        const high = samples.reduce((a, b) => b.h > a.h ? b : a);
        if (low.h > sea - 3 || high.h < sea + 45) continue;
        const score = high.h - low.h;
        if (!coast || score > coast.score) coast = { x, z, h, score, lowH: low.h, highH: high.h, waterDir: low.dir.toArray() };
      }
    }
    needCoast: {
      if (!coast) coast = { x: 0, z: 0, h: sampleHeight(0, 0), score: 0, lowH: sea - 1, highH: sea + 50, waterDir: [0, 1] };
    }

    let peak = { x: 0, z: 0, h: -Infinity };
    for (let z = worldBounds.minZ + 300; z <= worldBounds.maxZ - 300; z += 180) {
      for (let x = worldBounds.minX + 300; x <= worldBounds.maxX - 300; x += 180) {
        const h = sampleHeight(x, z);
        if (h > peak.h) peak = { x, z, h };
      }
    }

    const makeCamera = (fov, position, target, far = 12_000) => {
      const camera = new THREE.PerspectiveCamera(fov, width / height, 0.5, far);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      return camera;
    };

    const coastWaterDir = new THREE.Vector2(coast.waterDir[0], coast.waterDir[1]).normalize();
    const coastCameraXZ = new THREE.Vector2(coast.x, coast.z).addScaledVector(coastWaterDir, 760);
    const coastCameraGround = sampleHeight(coastCameraXZ.x, coastCameraXZ.y);
    const coastCamera = makeCamera(
      58,
      { x: coastCameraXZ.x, y: Math.max(sea + 48, coastCameraGround + 38), z: coastCameraXZ.y },
      { x: coast.x - coastWaterDir.x * 520, y: sea + 95, z: coast.z - coastWaterDir.y * 520 },
    );

    let mountainStand = null;
    for (const radius of [900, 1150, 1400]) {
      for (const dir of dirs) {
        const x = peak.x + dir.x * radius;
        const z = peak.z + dir.y * radius;
        const h = sampleHeight(x, z);
        if (h < sea + 12 || h > peak.h - 90) continue;
        const around = dirs.slice(0, 8).map((probe) => sampleHeight(x + probe.x * 70, z + probe.y * 70));
        const roughness = Math.max(...around) - Math.min(...around);
        if (roughness > 95) continue;
        const score = roughness + Math.abs(h - Math.min(150, peak.h * 0.28)) * 0.15 + radius * 0.01;
        if (!mountainStand || score < mountainStand.score) mountainStand = { x, z, h, score, roughness };
      }
    }
    if (!mountainStand) {
      const dir = new THREE.Vector2(peak.x || 1, peak.z || 1).normalize();
      mountainStand = { x: peak.x - dir.x * 1200, z: peak.z - dir.y * 1200 };
      mountainStand.h = sampleHeight(mountainStand.x, mountainStand.z);
      mountainStand.roughness = null;
    }
    const mountainCamera = makeCamera(
      55,
      { x: mountainStand.x, y: mountainStand.h + 24, z: mountainStand.z },
      { x: peak.x, y: peak.h * 0.84, z: peak.z },
      9000,
    );

    const seats = state.settlementSeats ?? [];
    let settlement = seats.length ? seats.reduce((best, seat) => {
      const d = Math.hypot(seat.x, seat.z);
      return !best || d < best.distance ? { ...seat, distance: d } : best;
    }, null) : null;
    if (!settlement) settlement = { id: 'fallback', name: 'fallback', x: 0, z: 0, groundY: sampleHeight(0, 0), distance: 0 };
    let settlementStand = null;
    for (const radius of [120, 150, 190]) {
      for (const dir of dirs) {
        const x = settlement.x + dir.x * radius;
        const z = settlement.z + dir.y * radius;
        const h = sampleHeight(x, z);
        if (h < sea + 2) continue;
        const delta = Math.abs(h - settlement.groundY);
        if (!settlementStand || delta < settlementStand.delta) settlementStand = { x, z, h, delta };
      }
    }
    if (!settlementStand) settlementStand = { x: settlement.x + 160, z: settlement.z, h: sampleHeight(settlement.x + 160, settlement.z), delta: 0 };
    const settlementCamera = makeCamera(
      58,
      { x: settlementStand.x, y: settlementStand.h + 16, z: settlementStand.z },
      { x: settlement.x, y: settlement.groundY + 18, z: settlement.z },
      5500,
    );

    const renderView = (camera, proofId, elapsedSeconds) => {
      skyModule.updateAuroraSky(state.sky, camera.position, elapsedSeconds, daylight);
      waterModule.updateWater(state.water, camera.position, elapsedSeconds);
      state.renderer.render(state.scene, camera);
      document.getElementById(proofId).getContext('2d').drawImage(runtimeCanvas, 0, 0, width, height);
      return {
        position: camera.position.toArray(),
        direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
        renderCalls: state.renderer.info.render.calls,
        renderTriangles: state.renderer.info.render.triangles,
      };
    };

    return {
      terrainMeshCount: terrainMeshes.length,
      terrainVertexCount: terrainMeshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0),
      waterMaterialType: state.water.material.type,
      coast,
      peak,
      mountainStand,
      settlement,
      settlementStand,
      coastStats: renderView(coastCamera, 'proof-coast-player', 0.91),
      mountainStats: renderView(mountainCamera, 'proof-mountain-player', 1.73),
      settlementStats: renderView(settlementCamera, 'proof-settlement-player', 2.37),
    };
  }, { width: WIDTH, height: HEIGHT });

  const outputs = [
    ['proof-coast-player', 'real-coast-player.png'],
    ['proof-mountain-player', 'real-mountain-player.png'],
    ['proof-settlement-player', 'real-settlement-player.png'],
  ];
  const images = {};
  for (const [id, filename] of outputs) {
    const png = await page.locator(`#${id}`).screenshot({ type: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, filename), png);
    need(png.readUInt32BE(16) === WIDTH && png.readUInt32BE(20) === HEIGHT, `${filename} dimensions drifted`);
    need(png.length > 50_000, `${filename} too small: ${png.length}`);
    images[filename] = { bytes: png.length, sha256: crypto.createHash('sha256').update(png).digest('hex') };
  }

  const metadata = { schema: 'westeros-real-live-world-player-cinematic-v1', images, consoleErrors, pageErrors, requestFailures, ...frame };
  fs.writeFileSync(META_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
  need(consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0, 'browser/runtime errors present');
  need(frame.terrainMeshCount >= 550 && frame.terrainVertexCount > 2_000_000, 'full live terrain not loaded');
  need(frame.waterMaterialType === 'ShaderMaterial', 'shipped water shader missing');
  need(frame.coast.highH - frame.coast.lowH > 40, 'coast does not contain strong land/water relief');
  need(frame.coastStats.renderTriangles > 500_000, 'coast view is not a substantive live render');
  need(frame.mountainStats.renderTriangles > 500_000, 'mountain view is not a substantive live render');
  need(frame.settlementStats.renderTriangles > 100_000, 'settlement view is not a substantive live render');
  console.log('REAL_LIVE_WORLD_PLAYER_CINEMATIC_OK', JSON.stringify({ images, coastRelief: frame.coast.highH - frame.coast.lowH, peakHeight: frame.peak.h, settlement: frame.settlement.name }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
