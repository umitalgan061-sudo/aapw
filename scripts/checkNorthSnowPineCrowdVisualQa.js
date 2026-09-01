#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkNorthSnowPineCrowdVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/winter-tree-visual-qa';
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const PREFERRED_PINE = 'assets/models/vegetation/pine_Zt62gceKXZ.glb';

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});

try {
  await page.goto(`${server.baseUrl}/north-snow-pine-crowd-visual-qa.html`, { waitUntil: 'networkidle' });
  const report = await page.evaluate(async ({ viewport, preferredPine }) => {
    const THREE = await import('three');
    const { WORLD_DEFAULTS, WORLD_SCALE } = await import('./src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('./src/3d/world/worldReferenceAlignment.js');
    const { createHeightSampler } = await import('./src/3d/world/terrain.js');
    const {
      resolveTerrainBiomeColor,
      slopeDegreesFromNeighbours,
    } = await import('./src/3d/world/terrainBiomeShading.js');
    const { northReferenceCryosphereAtWorldXZ } = await import('./src/3d/world/northReferenceCryosphere.js');
    const {
      VEGETATION_SPATIAL_PATTERN_POLICY,
      createVegetation,
      disposeVegetation,
    } = await import('./src/3d/world/vegetation.js');
    const {
      WINTER_VEGETATION_ASSET_POLICY,
      findProceduralWinterMeshes,
      upgradeWinterVegetationAssets,
    } = await import('./src/3d/world/winterVegetationAsset.js');

    const root = document.getElementById('qa-root');
    const panel = document.getElementById('qa-panel');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
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
    scene.fog = new THREE.Fog(0xaebbc5, 900, 2600);
    const hemi = new THREE.HemisphereLight(0xe3edf3, 0x424b48, 1.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.65);
    sun.position.set(820, 1450, 650);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1100, right: 1100, top: 1100, bottom: -1100, near: 100, far: 3200 });
    scene.add(sun);

    // Visualize the authored North tundra/ecotone rather than demanding forest inside the glacier
    // core. This reference point is the same canonical North used by map-aligned species acceptance.
    const winterStand = normalizedReferenceToWorldXZ(
      0.175,
      0.285,
      WORLD_SCALE.MAP_BOUNDS,
      WORLD_SCALE.METERS_PER_MAP_UNIT,
    );
    const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, null, []);
    const anchorHeight = sampleHeight(winterStand.x, winterStand.z);
    const radiusMeters = Math.hypot(winterStand.x, winterStand.z) + 1100;
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
    if (!trunkMesh?.isInstancedMesh || !foliageMesh?.isInstancedMesh) {
      throw new Error('production snow-pine procedural meshes are unavailable');
    }
    for (const child of vegetation.group.children) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child !== trunkMesh && child !== foliageMesh) child.visible = false;
    }

    const sourceMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const crowdMatrices = [];
    const crowdRadiusMeters = 1100;
    const permanentIceCutoff = VEGETATION_SPATIAL_PATTERN_POLICY.permanentIceTreeCutoff;
    let permanentIceCount = 0;
    let ecotoneCount = 0;
    for (let index = 0; index < trunkMesh.count; index += 1) {
      trunkMesh.getMatrixAt(index, sourceMatrix);
      sourceMatrix.decompose(position, quaternion, scale);
      if (Math.hypot(position.x - winterStand.x, position.z - winterStand.z) > crowdRadiusMeters) continue;
      const climate = northReferenceCryosphereAtWorldXZ(position.x, position.z);
      if (climate.permanentIce >= permanentIceCutoff) permanentIceCount += 1;
      if (climate.permanentIce < permanentIceCutoff && Math.max(climate.permanentIce, climate.tundra) >= 0.20) ecotoneCount += 1;
      const localPosition = new THREE.Vector3(
        position.x - winterStand.x,
        position.y - anchorHeight,
        position.z - winterStand.z,
      );
      localMatrix.compose(localPosition, quaternion, scale);
      crowdMatrices.push(localMatrix.clone());
    }
    if (crowdMatrices.length < 12) throw new Error(`production ecotone crowd unexpectedly sparse: ${crowdMatrices.length}`);

    trunkMesh.count = crowdMatrices.length;
    foliageMesh.count = crowdMatrices.length;
    for (let index = 0; index < crowdMatrices.length; index += 1) {
      trunkMesh.setMatrixAt(index, crowdMatrices[index]);
      foliageMesh.setMatrixAt(index, crowdMatrices[index]);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;

    const upgrade = await upgradeWinterVegetationAssets(vegetation.group, { candidates: [preferredPine] });
    const replacementMeshes = vegetation.group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-'));
    if (upgrade.status !== 'active') throw new Error(`hydrated preferred snow pine did not activate: ${JSON.stringify(upgrade)}`);

    const terrainWidth = 2100;
    const terrainDepth = 1800;
    const segmentsX = 112;
    const segmentsZ = 96;
    const terrainGeometry = new THREE.PlaneGeometry(terrainWidth, terrainDepth, segmentsX, segmentsZ);
    terrainGeometry.rotateX(-Math.PI / 2);
    const terrainPositions = terrainGeometry.getAttribute('position');
    const terrainColors = new Float32Array(terrainPositions.count * 3);
    const color = new THREE.Color();
    const slopeOffset = Math.min(terrainWidth / segmentsX, terrainDepth / segmentsZ);
    let minLocalHeight = Infinity;
    let maxLocalHeight = -Infinity;
    let snowWeightSum = 0;
    let rockWeightSum = 0;

    for (let index = 0; index < terrainPositions.count; index += 1) {
      const localX = terrainPositions.getX(index);
      const localZ = terrainPositions.getZ(index);
      const worldX = winterStand.x + localX;
      const worldZ = winterStand.z + localZ;
      const surface = {};
      const height = sampleHeight(worldX, worldZ, undefined, surface);
      const localY = height - anchorHeight;
      terrainPositions.setY(index, localY);
      const west = sampleHeight(worldX - slopeOffset, worldZ);
      const east = sampleHeight(worldX + slopeOffset, worldZ);
      const north = sampleHeight(worldX, worldZ - slopeOffset);
      const south = sampleHeight(worldX, worldZ + slopeOffset);
      const slopeDegrees = slopeDegreesFromNeighbours(west, east, north, south, slopeOffset);
      resolveTerrainBiomeColor(color, {
        heightAboveSeaMeters: height - WORLD_DEFAULTS.WATER_LEVEL_METERS,
        slopeDegrees,
        rockWeight: surface.rockWeight ?? 0,
        snowWeight: surface.snowWeight ?? 0,
        worldX,
        worldZ,
      });
      terrainColors[index * 3] = color.r;
      terrainColors[index * 3 + 1] = color.g;
      terrainColors[index * 3 + 2] = color.b;
      minLocalHeight = Math.min(minLocalHeight, localY);
      maxLocalHeight = Math.max(maxLocalHeight, localY);
      snowWeightSum += surface.snowWeight ?? 0;
      rockWeightSum += surface.rockWeight ?? 0;
    }
    terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
    terrainGeometry.computeVertexNormals();
    const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    scene.add(terrain);
    scene.add(vegetation.group);

    const crowdBounds = new THREE.Box3();
    for (const matrix of crowdMatrices) {
      matrix.decompose(position, quaternion, scale);
      crowdBounds.expandByPoint(position);
    }
    const crowdCenter = crowdBounds.getCenter(new THREE.Vector3());
    const crowdSize = crowdBounds.getSize(new THREE.Vector3());

    const camera = new THREE.PerspectiveCamera(38, viewport.width / viewport.height, 0.5, 5000);
    function renderView(cameraPosition, target, label) {
      camera.position.fromArray(cameraPosition);
      camera.lookAt(...target);
      camera.updateMatrixWorld(true);
      panel.textContent = [
        `NORTH SNOW-PINE ECOTONE · ${WINTER_VEGETATION_ASSET_POLICY.id}`,
        `${label}`,
        `production crowd=${crowdMatrices.length} · ecotone=${ecotoneCount} · permanent ice=${permanentIceCount}`,
        `terrain span Y=${minLocalHeight.toFixed(1)}..${maxLocalHeight.toFixed(1)} m`,
        `foliage snow mix=${WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin.toFixed(2)}..${(WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin + WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixRange).toFixed(2)}`,
      ].join('\n');
      renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }

    const gameplayTarget = [crowdCenter.x, crowdCenter.y + 8, crowdCenter.z];
    const gameplayCamera = [crowdCenter.x + 260, crowdCenter.y + 105, crowdCenter.z + 320];
    const gameplayRender = renderView(gameplayCamera, gameplayTarget, 'gameplay / close three-quarter stand readability');
    window.__renderNorthSnowPineAerial = () => renderView([760, 720, 880], [0, 10, 0], 'elevated / ecotone distribution readability');

    const treatments = replacementMeshes.map((mesh) => mesh.material?.userData?.winterPineTreatment ?? 'source');
    const telemetry = vegetation.group.userData.northClimateVegetation ?? {};
    window.__disposeNorthSnowPineCrowd = () => {
      disposeVegetation(vegetation.group);
      terrainGeometry.dispose();
      terrainMaterial.dispose();
      renderer.dispose();
    };

    return {
      upgrade,
      crowdCount: crowdMatrices.length,
      ecotoneCount,
      permanentIceCount,
      productionWinterTreeCount: vegetation.winterTreeCount,
      replacementMeshCount: replacementMeshes.length,
      treatments,
      proceduralHidden: trunkMesh.visible === false && foliageMesh.visible === false,
      telemetry: {
        mapAligned: telemetry.mapAligned,
        liveRepresentation: telemetry.liveRepresentation,
        winterAssetTreeCount: telemetry.winterAssetTreeCount,
        winterAssetTreatment: telemetry.winterAssetTreatment,
      },
      terrain: {
        vertexCount: terrainPositions.count,
        minLocalHeight,
        maxLocalHeight,
        meanSnowWeight: snowWeightSum / terrainPositions.count,
        meanRockWeight: rockWeightSum / terrainPositions.count,
      },
      crowdSpan: { x: crowdSize.x, z: crowdSize.z },
      crowdCenter: crowdCenter.toArray(),
      foliageSnowMix: {
        min: WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin,
        max: WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin + WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixRange,
      },
      gameplayRender,
    };
  }, { viewport: VIEWPORT, preferredPine: PREFERRED_PINE });

  await page.screenshot({ path: `${ARTIFACT_DIR}/snow-pine-crowd-gameplay.png`, fullPage: true });
  const aerialRender = await page.evaluate(() => window.__renderNorthSnowPineAerial());
  await page.screenshot({ path: `${ARTIFACT_DIR}/snow-pine-crowd-aerial.png`, fullPage: true });

  const normalized = {
    ...report,
    crowdSpan: Object.fromEntries(Object.entries(report.crowdSpan).map(([key, value]) => [key, round(value)])),
    crowdCenter: report.crowdCenter.map((value) => round(value)),
    terrain: Object.fromEntries(Object.entries(report.terrain).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])),
    gameplayRender: report.gameplayRender,
    aerialRender,
    browserErrors,
  };
  await writeFile(`${ARTIFACT_DIR}/snow-pine-crowd-report.json`, `${JSON.stringify(normalized, null, 2)}\n`);

  assert.equal(report.upgrade.status, 'active', 'preferred hydrated snow pine must activate in crowd QA');
  assert.equal(report.upgrade.assetUrl, PREFERRED_PINE);
  assert(report.crowdCount >= 12, `crowd must retain at least 12 production snow pines, got ${report.crowdCount}`);
  assert(report.ecotoneCount >= 12, `crowd must visibly occupy the canonical tundra/ice ecotone, got ${report.ecotoneCount}`);
  assert.equal(report.permanentIceCount, 0, 'production snow-pine crowd must not repopulate the permanent-ice core');
  assert(report.crowdSpan.x >= 350 && report.crowdSpan.z >= 350,
    `crowd must remain a 2D stand, got ${report.crowdSpan.x.toFixed(1)}x${report.crowdSpan.z.toFixed(1)} m`);
  assert(report.replacementMeshCount >= 1, 'hydrated crowd must render replacement GLB meshes');
  assert.equal(report.proceduralHidden, true, 'procedural crowd must hide after hydrated GLB activation');
  assert(report.treatments.includes('snow-foliage-shader'), 'crowd foliage must use the production snow-foliage shader');
  assert(report.treatments.includes('winter-trunk-source-map'), 'crowd must retain the textured source trunk treatment');
  assert.equal(report.telemetry.mapAligned, true, 'crowd must retain map-aligned north ownership');
  assert.equal(report.telemetry.liveRepresentation, 'materialized-instanced-winter-glb');
  assert.equal(report.telemetry.winterAssetTreeCount, report.crowdCount, 'hydrated crowd telemetry must match the rendered subset');
  assert(report.terrain.vertexCount > 10000, 'visual QA terrain patch is unexpectedly coarse');
  assert(report.terrain.maxLocalHeight - report.terrain.minLocalHeight > 20, 'canonical north terrain patch lost meaningful relief');
  assert(report.terrain.meanSnowWeight > 0.05, 'canonical north ecotone terrain no longer carries visible snow authority');
  assert(report.gameplayRender.triangles > 10000 && aerialRender.triangles > 10000, 'crowd QA did not render real terrain/tree geometry');
  assert.deepEqual(browserErrors, [], `crowd visual QA emitted browser errors: ${browserErrors.join(' | ')}`);

  await page.evaluate(() => window.__disposeNorthSnowPineCrowd?.());
  console.log('[checkNorthSnowPineCrowdVisualQa] PASS', JSON.stringify({
    crowdCount: report.crowdCount,
    ecotoneCount: report.ecotoneCount,
    permanentIceCount: report.permanentIceCount,
    replacementMeshCount: report.replacementMeshCount,
    crowdSpan: normalized.crowdSpan,
    terrain: normalized.terrain,
    foliageSnowMix: report.foliageSnowMix,
  }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
