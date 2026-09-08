#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkSettlementWoodlandPocketVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/settlement-woodland-pocket-visual-qa';
const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

try {
  await page.goto(`${server.baseUrl}/north-snow-pine-crowd-visual-qa.html`, { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async ({ viewport }) => {
    const THREE = await import('three');
    const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('./src/3d/config.js');
    const { createHeightSampler } = await import('./src/3d/world/terrain.js');
    const { resolveTerrainBiomeColor, slopeDegreesFromNeighbours } = await import('./src/3d/world/terrainBiomeShading.js');
    const { KINGDOM_SEATS, computeSettlementFlattenPads } = await import('./src/3d/world/settlements.js');
    const { createVegetation, disposeVegetation, VEGETATION_SPATIAL_PATTERN_POLICY } = await import('./src/3d/world/vegetation.js');

    const rawHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const pads = computeSettlementFlattenPads({
      sampleHeightMeters: rawHeight,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
    const seatIndex = KINGDOM_SEATS.findIndex((seat) => seat.id === 'cersei');
    if (seatIndex < 0) throw new Error('canonical Cersei settlement seat missing');
    const seat = { ...KINGDOM_SEATS[seatIndex], x: pads[seatIndex].x, z: pads[seatIndex].z };
    const seatY = sampleHeight(seat.x, seat.z);
    const ownerRadius = Math.hypot(seat.x, seat.z)
      + VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCenterMaxMeters
      + VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveRadiusMaxMeters + 20;
    const vegetation = createVegetation({
      sampleHeightMeters: sampleHeight,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      seed: WORLD_DEFAULTS.WORLD_SEED,
      seats: [seat],
      roadEdges: [],
      radiusMeters: ownerRadius,
      densityPerKm2: 0,
    });
    vegetation.group.position.set(-seat.x, -seatY, -seat.z);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const treePoints = [];
    for (const mesh of vegetation.group.children) {
      if (!mesh.isInstancedMesh || !mesh.name.endsWith('-trunks')) continue;
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        matrix.decompose(position, quaternion, scale);
        treePoints.push([position.x - seat.x, position.z - seat.z]);
      }
    }
    const sectors = new Array(16).fill(0);
    const radii = [];
    for (const [x, z] of treePoints) {
      const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      sectors[Math.min(15, Math.floor(angle / (Math.PI * 2) * 16))] += 1;
      radii.push(Math.hypot(x, z));
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    document.getElementById('qa-root').appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb8c4ca);
    scene.add(new THREE.HemisphereLight(0xf0f4ef, 0x4b5147, 1.35));
    const sun = new THREE.DirectionalLight(0xffefd2, 2.2);
    sun.position.set(420, 780, 310);
    scene.add(sun);

    const patchSize = 720;
    const segments = 72;
    const terrainGeometry = new THREE.PlaneGeometry(patchSize, patchSize, segments, segments);
    terrainGeometry.rotateX(-Math.PI / 2);
    const terrainPosition = terrainGeometry.getAttribute('position');
    const terrainColors = new Float32Array(terrainPosition.count * 3);
    const terrainColor = new THREE.Color();
    const offset = patchSize / segments;
    for (let index = 0; index < terrainPosition.count; index += 1) {
      const localX = terrainPosition.getX(index);
      const localZ = terrainPosition.getZ(index);
      const worldX = seat.x + localX;
      const worldZ = seat.z + localZ;
      const surface = {};
      const height = sampleHeight(worldX, worldZ, undefined, surface);
      terrainPosition.setY(index, height - seatY);
      const slope = slopeDegreesFromNeighbours(
        sampleHeight(worldX - offset, worldZ), sampleHeight(worldX + offset, worldZ),
        sampleHeight(worldX, worldZ - offset), sampleHeight(worldX, worldZ + offset), offset,
      );
      resolveTerrainBiomeColor(terrainColor, {
        heightAboveSeaMeters: height - WORLD_DEFAULTS.WATER_LEVEL_METERS,
        slopeDegrees: slope,
        rockWeight: surface.rockWeight ?? 0,
        snowWeight: surface.snowWeight ?? 0,
        worldX,
        worldZ,
      });
      terrainColors[index * 3] = terrainColor.r;
      terrainColors[index * 3 + 1] = terrainColor.g;
      terrainColors[index * 3 + 2] = terrainColor.b;
    }
    terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
    terrainGeometry.computeVertexNormals();
    const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.receiveShadow = true;
    scene.add(terrain, vegetation.group);

    const exclusion = new THREE.Mesh(
      new THREE.RingGeometry(88, 92, 64),
      new THREE.MeshBasicMaterial({ color: 0xd6b15f, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    );
    exclusion.rotation.x = -Math.PI / 2;
    exclusion.position.y = 0.5;
    scene.add(exclusion);
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 18, 10), new THREE.MeshStandardMaterial({ color: 0x7d6a58, roughness: 0.9 }));
    marker.position.y = 9;
    scene.add(marker);

    const camera = new THREE.PerspectiveCamera(42, viewport.width / viewport.height, 0.5, 3000);
    const panel = document.getElementById('qa-panel');
    function render(cameraPosition, target, label) {
      camera.position.fromArray(cameraPosition);
      camera.lookAt(...target);
      camera.updateMatrixWorld(true);
      panel.textContent = `SETTLEMENT WOODLAND POCKETS · ${seat.name}\n${label}\ntrees=${treePoints.length} · occupied sectors=${sectors.filter(Boolean).length}/16\npolicy=${VEGETATION_SPATIAL_PATTERN_POLICY.id}`;
      renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    const oblique = render([410, 290, 430], [0, 18, 0], 'oblique canonical terrain / 90 m seat exclusion ring');
    window.__renderSettlementTopdown = () => render([0, 720, 0.01], [0, 0, 0], 'topdown woodland-pocket distribution');
    window.__disposeSettlementQa = () => {
      disposeVegetation(vegetation.group);
      terrainGeometry.dispose(); terrainMaterial.dispose(); exclusion.geometry.dispose(); exclusion.material.dispose();
      marker.geometry.dispose(); marker.material.dispose(); renderer.dispose();
    };
    return {
      seatId: seat.id,
      seatName: seat.name,
      policyId: VEGETATION_SPATIAL_PATTERN_POLICY.id,
      treeCount: treePoints.length,
      sectors,
      occupiedSectors: sectors.filter(Boolean).length,
      emptySectors: sectors.filter((count) => count === 0).length,
      minRadiusMeters: Math.min(...radii),
      maxRadiusMeters: Math.max(...radii),
      clusterSeatCount: vegetation.clusterSeatCount,
      settlementWoodlandSeatCount: vegetation.settlementWoodlandSeatCount,
      oblique,
    };
  }, { viewport: VIEWPORT });

  assert.equal(report.clusterSeatCount, 1);
  assert.equal(report.settlementWoodlandSeatCount, 1);
  assert(report.treeCount >= 24, `canonical settlement woodland became too sparse: ${report.treeCount}`);
  assert(report.emptySectors >= 4, `canonical settlement woodland became ring-like: ${JSON.stringify(report.sectors)}`);
  assert(report.occupiedSectors <= 12, `canonical settlement woodland refilled the annulus: ${JSON.stringify(report.sectors)}`);
  assert(report.minRadiusMeters >= 90, `canonical seat exclusion was invaded: ${report.minRadiusMeters}`);
  assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/settlement-woodland-oblique.png` });
  const topdown = await page.evaluate(() => window.__renderSettlementTopdown());
  await page.screenshot({ path: `${ARTIFACT_DIR}/settlement-woodland-topdown.png` });
  await writeFile(`${ARTIFACT_DIR}/report.json`, `${JSON.stringify({ ...report, topdown, errors }, null, 2)}\n`);
  await page.evaluate(() => window.__disposeSettlementQa());
  console.log('[checkSettlementWoodlandPocketVisualQa] PASS', JSON.stringify(report));
} finally {
  await browser.close();
  await server.stop();
}
