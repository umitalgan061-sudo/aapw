#!/usr/bin/env node
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const terrain = await import('/src/3d/world/terrain.js');
    const physics = await import('/src/3d/physics.js');
    const { ChunkManager } = await import('/src/3d/world/chunkManager.js');
    const { WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
    const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
    const sampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const repeatSampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const collider = physics.createGroundCollider(WORLD_DEFAULTS.WORLD_SEED);
    const mapW = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
    const mapH = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
    const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
    const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
    const world = (nx, ny) => ({
      x: (nx * mapW - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
      z: (ny * mapH - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const probes = [world(1.5 / 8, 7.5 / 8), world(7.5 / 8, 7.5 / 8), world(0.5, 0.5)];
    let maxPhysicsError = 0;
    for (const probe of probes) maxPhysicsError = Math.max(maxPhysicsError, Math.abs(sampler(probe.x, probe.z) - collider.getGroundHeight(probe.x, probe.z)));

    let minimum = Infinity, maximum = -Infinity, belowSea = 0, aboveSea = 0, checksum = 2166136261;
    for (let y = 0; y <= 32; y += 1) {
      for (let x = 0; x <= 32; x += 1) {
        const probe = world(x / 32, y / 32);
        const a = sampler(probe.x, probe.z);
        const b = repeatSampler(probe.x, probe.z);
        if (!Number.isFinite(a) || a !== b) throw new Error(`invalid deterministic height at ${x},${y}`);
        minimum = Math.min(minimum, a); maximum = Math.max(maximum, a);
        a < WORLD_DEFAULTS.WATER_LEVEL_METERS ? belowSea += 1 : aboveSea += 1;
        checksum ^= Math.round((a + 2048) * 1000); checksum = Math.imul(checksum, 16777619) >>> 0;
      }
    }

    const scene = new THREE.Scene();
    const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: WORLD_DEFAULTS.WORLD_SEED, flattenPads: [] });
    const g17 = probes[0];
    const mesh = manager.loadChunk(Math.round(g17.x / 500), Math.round(g17.z / 500));
    const position = mesh.geometry.getAttribute('position');
    let maxRenderError = 0;
    for (let index = 0; index < position.count; index += Math.max(1, Math.floor(position.count / 101))) {
      const x = mesh.position.x + position.getX(index);
      const z = mesh.position.z + position.getZ(index);
      maxRenderError = Math.max(maxRenderError, Math.abs(position.getY(index) - collider.getGroundHeight(x, z)));
    }
    const output = {
      policyId: terrain.CURRENT_TERRAIN_POLICY.id,
      sourceMapSha256: terrain.CURRENT_TERRAIN_POLICY.sourceMapSha256,
      fullOwnerMapCoverage: terrain.CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage,
      legacyProceduralFallback: terrain.CURRENT_TERRAIN_POLICY.legacyProceduralFallback,
      mapDerivedHeight: terrain.CURRENT_TERRAIN_POLICY.mapDerivedHeight,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      denseHeight: { minimum, maximum, belowSea, aboveSea, checksum },
      maxPhysicsError, maxRenderError,
      meshPolicyId: mesh.userData.currentTerrainPolicy,
      meshSingleSource: mesh.userData.currentTerrainSingleSource === true,
      g17Height: sampler(g17.x, g17.z), g77Height: sampler(probes[1].x, probes[1].z),
    };
    manager.disposeAll();
    return output;
  });
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (!result.fullOwnerMapCoverage || result.legacyProceduralFallback || !result.mapDerivedHeight) throw new Error(`invalid runtime policy ${JSON.stringify(result)}`);
  if (result.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('runtime source-map checksum drifted');
  if (result.mapBounds.minX !== 0 || result.mapBounds.maxX !== 9000 || result.mapBounds.minY !== 0 || result.mapBounds.maxY !== 7000) throw new Error('browser runtime still cropped');
  if (result.denseHeight.belowSea === 0 || result.denseHeight.aboveSea === 0) throw new Error('dense live terrain lacks wet/dry range');
  if (result.denseHeight.maximum - result.denseHeight.minimum <= 100) throw new Error(`live relief is implausibly flat: ${JSON.stringify(result.denseHeight)}`);
  if (result.maxPhysicsError > 1e-9) throw new Error(`render/physics sampler source mismatch ${result.maxPhysicsError}`);
  if (result.maxRenderError > 1e-5) throw new Error(`chunk/collider height mismatch ${result.maxRenderError}`);
  if (result.meshPolicyId !== result.policyId || !result.meshSingleSource) throw new Error('ChunkManager mesh missing current-terrain provenance');
  console.log(`FULL_WORLD_RUNTIME_BROWSER=${JSON.stringify(result)}`);
  console.log('FULL_WORLD_RUNTIME_BROWSER_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}