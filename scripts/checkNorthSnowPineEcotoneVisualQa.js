#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) process.exit(2);

const ARTIFACT_DIR = 'artifacts/winter-tree-visual-qa';
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const PREFERRED_PINE = 'assets/models/vegetation/pine_Zt62gceKXZ.glb';
await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });

try {
  await page.goto(`${server.baseUrl}/north-snow-pine-crowd-visual-qa.html`, { waitUntil: 'networkidle' });
  const metrics = await page.evaluate(async ({ viewport, preferredPine }) => {
    const THREE = await import('three');
    const { WORLD_DEFAULTS, WORLD_SCALE } = await import('./src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('./src/3d/world/worldReferenceAlignment.js');
    const { createHeightSampler } = await import('./src/3d/world/terrain.js');
    const { resolveTerrainBiomeColor, slopeDegreesFromNeighbours } = await import('./src/3d/world/terrainBiomeShading.js');
    const { northReferenceCryosphereAtWorldXZ } = await import('./src/3d/world/northReferenceCryosphere.js');
    const { VEGETATION_SPATIAL_PATTERN_POLICY, createVegetation, disposeVegetation } = await import('./src/3d/world/vegetation.js');
    const { findProceduralWinterMeshes, upgradeWinterVegetationAssets } = await import('./src/3d/world/winterVegetationAsset.js');

    const root = document.getElementById('qa-root');
    const panel = document.getElementById('qa-panel');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    root.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaebbc5);
    scene.fog = new THREE.Fog(0xaebbc5, 950, 2650);
    scene.add(new THREE.HemisphereLight(0xe3edf3, 0x424b48, 1.35));
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.65);
    sun.position.set(820, 1450, 650);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1100, right: 1100, top: 1100, bottom: -1100, near: 100, far: 3200 });
    scene.add(sun);

    const winterCore = normalizedReferenceToWorldXZ(0.145, 0.115, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, null, []);
    const radiusMeters = Math.hypot(winterCore.x, winterCore.z) + 1100;
    const vegetation = createVegetation({
      sampleHeightMeters: sampleHeight,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      seed: 0x43524f57,
      seats: [],
      roadEdges: [],
      radiusMeters,
      densityPerKm2: 30,
    });
    const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(vegetation.group);
    if (!trunkMesh?.isInstancedMesh || !foliageMesh?.isInstancedMesh) throw new Error('production snow-pine meshes unavailable');
    for (const child of vegetation.group.children) if (child !== trunkMesh && child !== foliageMesh) child.visible = false;

    const sourceMatrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    const candidates = [];
    const iceCutoff = VEGETATION_SPATIAL_PATTERN_POLICY.permanentIceTreeCutoff;
    let permanentIceCount = 0;
    for (let i = 0; i < trunkMesh.count; i += 1) {
      trunkMesh.getMatrixAt(i, sourceMatrix);
      sourceMatrix.decompose(position, quaternion, scale);
      const climate = northReferenceCryosphereAtWorldXZ(position.x, position.z);
      if (climate.permanentIce >= iceCutoff) permanentIceCount += 1;
      if (climate.permanentIce < iceCutoff && Math.max(climate.permanentIce, climate.tundra) >= 0.20) {
        candidates.push({ x: position.x, y: position.y, z: position.z, matrix: sourceMatrix.clone(), climate });
      }
    }
    if (permanentIceCount !== 0) throw new Error(`permanent-ice trees remain: ${permanentIceCount}`);
    if (candidates.length < 8) throw new Error(`ecotone snow-pine population too sparse: ${candidates.length}`);

    const crowdRadiusMeters = 900;
    let anchor = candidates[0], crowd = [];
    for (const candidate of candidates) {
      const members = candidates.filter((other) => Math.hypot(other.x - candidate.x, other.z - candidate.z) <= crowdRadiusMeters);
      if (members.length > crowd.length) { anchor = candidate; crowd = members; }
    }
    if (crowd.length < 8) throw new Error(`ecotone stand unexpectedly sparse: ${crowd.length}`);
    const anchorHeight = sampleHeight(anchor.x, anchor.z);
    const localMatrices = crowd.map(({ matrix }) => {
      matrix.decompose(position, quaternion, scale);
      return new THREE.Matrix4().compose(new THREE.Vector3(position.x - anchor.x, position.y - anchorHeight, position.z - anchor.z), quaternion, scale);
    });
    trunkMesh.count = foliageMesh.count = localMatrices.length;
    localMatrices.forEach((matrix, i) => { trunkMesh.setMatrixAt(i, matrix); foliageMesh.setMatrixAt(i, matrix); });
    trunkMesh.instanceMatrix.needsUpdate = foliageMesh.instanceMatrix.needsUpdate = true;

    const upgrade = await upgradeWinterVegetationAssets(vegetation.group, { candidates: [preferredPine] });
    if (upgrade.status !== 'active') throw new Error(`snow-pine GLB did not hydrate: ${JSON.stringify(upgrade)}`);

    const terrainGeometry = new THREE.PlaneGeometry(2100, 1800, 112, 96);
    terrainGeometry.rotateX(-Math.PI / 2);
    const positions = terrainGeometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();
    const probe = Math.min(2100 / 112, 1800 / 96);
    let snowWeightSum = 0, rockWeightSum = 0;
    for (let i = 0; i < positions.count; i += 1) {
      const lx = positions.getX(i), lz = positions.getZ(i), wx = anchor.x + lx, wz = anchor.z + lz;
      const surface = {}, height = sampleHeight(wx, wz, undefined, surface);
      positions.setY(i, height - anchorHeight);
      const west = sampleHeight(wx - probe, wz), east = sampleHeight(wx + probe, wz);
      const north = sampleHeight(wx, wz - probe), south = sampleHeight(wx, wz + probe);
      resolveTerrainBiomeColor(color, {
        heightAboveSeaMeters: height - WORLD_DEFAULTS.WATER_LEVEL_METERS,
        slopeDegrees: slopeDegreesFromNeighbours(west, east, north, south, probe),
        rockWeight: surface.rockWeight ?? 0,
        snowWeight: surface.snowWeight ?? 0,
        worldX: wx, worldZ: wz,
      });
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
      snowWeightSum += surface.snowWeight ?? 0; rockWeightSum += surface.rockWeight ?? 0;
    }
    terrainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeometry.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
    terrain.receiveShadow = true;
    scene.add(terrain, vegetation.group);

    const camera = new THREE.PerspectiveCamera(38, viewport.width / viewport.height, 0.5, 5000);
    function render(positionArray, target, label) {
      camera.position.fromArray(positionArray); camera.lookAt(...target); camera.updateMatrixWorld(true);
      panel.textContent = [
        'NORTH SNOW-PINE ECOTONE · production scatter',
        `${label} · stand=${crowd.length} · permanent ice trees=0`,
        `anchor climate: ice=${anchor.climate.permanentIce.toFixed(3)} tundra=${anchor.climate.tundra.toFixed(3)}`,
      ].join('\n');
      renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    const gameplay = render([320, 120, 390], [0, 12, 0], 'gameplay');
    window.__renderSnowPineEcotoneAerial = () => render([520, 610, 650], [0, 0, 0], 'aerial');
    window.__disposeSnowPineEcotone = () => { disposeVegetation(vegetation.group); terrain.geometry.dispose(); terrain.material.dispose(); renderer.dispose(); };
    return {
      crowdCount: crowd.length,
      populationCount: candidates.length,
      permanentIceCount,
      anchor: { x: anchor.x, z: anchor.z, permanentIce: anchor.climate.permanentIce, tundra: anchor.climate.tundra },
      terrain: { meanSnowWeight: snowWeightSum / positions.count, meanRockWeight: rockWeightSum / positions.count },
      upgrade,
      gameplay,
    };
  }, { viewport: VIEWPORT, preferredPine: PREFERRED_PINE });

  await page.screenshot({ path: `${ARTIFACT_DIR}/snow-pine-ecotone-gameplay.png`, fullPage: false });
  const aerial = await page.evaluate(() => window.__renderSnowPineEcotoneAerial());
  await page.screenshot({ path: `${ARTIFACT_DIR}/snow-pine-ecotone-aerial.png`, fullPage: false });
  assert.equal(browserErrors.length, 0, `browser errors: ${browserErrors.join(' | ')}`);
  assert(metrics.crowdCount >= 8, 'browser ecotone stand must remain readable');
  assert.equal(metrics.permanentIceCount, 0, 'browser QA must prove the permanent-ice core is treeless');
  const report = { ...metrics, aerial, browserErrors };
  await writeFile(`${ARTIFACT_DIR}/snow-pine-ecotone-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log('[checkNorthSnowPineEcotoneVisualQa] PASS', JSON.stringify({ crowdCount: metrics.crowdCount, anchor: metrics.anchor, upgrade: metrics.upgrade.status }));
  await page.evaluate(() => window.__disposeSnowPineEcotone?.());
} finally {
  await browser.close();
  await server.close();
}
