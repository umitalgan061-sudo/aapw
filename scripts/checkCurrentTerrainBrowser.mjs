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
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => window.__WESTEROS_CURRENT_TERRAIN__?.chunks > 0 && window.__WESTEROS_CURRENT_TERRAIN__?.samplers > 0,
    null,
    { timeout: 30000 },
  );

  const result = await page.evaluate(async () => {
    const terrain = await import('/src/3d/world/terrain.js');
    const physics = await import('/src/3d/physics.js');
    const { ChunkManager } = await import('/src/3d/world/chunkManager.js');
    const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
    const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
    const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
    const { sampleReferenceWaterMask } = await import('/src/3d/world/worldReferenceWaterMask.js');
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const THREE = await import('three');
    const current = await import('/src/3d/world/currentTerrainRuntime.js');

    const sampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, []);
    const collider = physics.createGroundCollider(WORLD_DEFAULTS.WORLD_SEED, undefined, []);
    const points = [
      [0, 0],
      [625, 875],
      [-1800, 2400],
      [current.ownerMapNormalizedToCurrentWorld(3885 / 9000, 5404 / 7000).x,
        current.ownerMapNormalizedToCurrentWorld(3885 / 9000, 5404 / 7000).z],
    ];
    let maxPhysicsError = 0;
    for (const [x, z] of points) {
      maxPhysicsError = Math.max(maxPhysicsError, Math.abs(sampler(x, z) - collider.getGroundHeight(x, z)));
    }

    const scene = new THREE.Scene();
    const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: WORLD_DEFAULTS.WORLD_SEED, flattenPads: [] });
    const mesh = manager.loadChunk(0, 0);
    const position = mesh.geometry.getAttribute('position');
    let maxRenderError = 0;
    for (let index = 0; index < position.count; index += Math.max(1, Math.floor(position.count / 97))) {
      const worldX = mesh.position.x + position.getX(index);
      const worldZ = mesh.position.z + position.getZ(index);
      maxRenderError = Math.max(maxRenderError, Math.abs(position.getY(index) - collider.getGroundHeight(worldX, worldZ)));
    }

    // Keep the 20-degree road acceptance gate unchanged. This diagnostic locates the exact segment
    // responsible for any remaining over-grade edge so fixes can target terrain continuity instead
    // of weakening the path safety contract.
    const baseRoadSampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const flattenPads = computeSettlementFlattenPads({
      sampleHeightMeters: baseRoadSampler,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const roadSampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
    const roadSeats = KINGDOM_SEATS.map((seat) => {
      const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
      return { id: seat.id, x, z, groundY: roadSampler(x, z) };
    });
    const roadNetwork = buildRoadNetwork({ seats: roadSeats, sampleHeightMeters: roadSampler });
    const roadGradeDiagnostics = roadNetwork.edges.filter((edge) => edge.maxGradeDegrees > 20).map((edge) => {
      let worst = null;
      for (let index = 1; index < edge.points.length; index += 1) {
        const a = edge.points[index - 1];
        const b = edge.points[index];
        const horizontalMeters = Math.hypot(b.x - a.x, b.z - a.z);
        if (horizontalMeters <= 1e-9) continue;
        const y0 = roadSampler(a.x, a.z);
        const y1 = roadSampler(b.x, b.z);
        const gradeDegrees = Math.atan2(Math.abs(y1 - y0), horizontalMeters) * 180 / Math.PI;
        if (!worst || gradeDegrees > worst.gradeDegrees) worst = { a, b, y0, y1, horizontalMeters, gradeDegrees };
      }
      const describe = (point, heightMeters) => {
        const map = current.currentWorldToOwnerMap(point.x, point.z);
        const rawWater = sampleReferenceWaterMask(map.normalizedX, map.normalizedY);
        const pindex = sampleReferencePindexQualityV2(map.normalizedX, map.normalizedY);
        return {
          worldX: point.x, worldZ: point.z, heightMeters,
          mapX: map.mapX, mapY: map.mapY,
          rawWater,
          pindexWaterWeight: (pindex.surfaceWeights.sea ?? 0) + (pindex.surfaceWeights.lake ?? 0),
          terrain: current.sampleCurrentTerrainNormalized(map.normalizedX, map.normalizedY),
        };
      };
      return {
        fromId: edge.fromId, toId: edge.toId, edgeMaxGradeDegrees: edge.maxGradeDegrees,
        worstGradeDegrees: worst?.gradeDegrees ?? null,
        horizontalMeters: worst?.horizontalMeters ?? null,
        from: worst ? describe(worst.a, worst.y0) : null,
        to: worst ? describe(worst.b, worst.y1) : null,
      };
    });

    const spawn = current.sampleCurrentTerrainNormalized(3885 / 9000, 5404 / 7000);
    const runtime = window.__WESTEROS_CURRENT_TERRAIN__;
    const output = {
      mappedPolicyId: terrain.CURRENT_TERRAIN_POLICY?.id ?? null,
      expectedPolicyId: current.CURRENT_TERRAIN_POLICY.id,
      fullOwnerMapCoverage: current.CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage,
      legacyProceduralFallback: current.CURRENT_TERRAIN_POLICY.legacyProceduralFallback,
      renderAndPhysicsSingleSource: terrain.CURRENT_TERRAIN_ADAPTER_POLICY?.renderAndPhysicsSingleSource ?? false,
      maxPhysicsError,
      maxRenderError,
      meshPolicyId: mesh.userData.currentTerrainPolicy ?? null,
      meshSingleSource: mesh.userData.currentTerrainSingleSource === true,
      spawnSource: spawn.source,
      spawnHeight: spawn.heightMeters,
      roadGradeDiagnostics,
      runtime,
    };
    manager.disposeAll();
    return output;
  });

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  if (result.mappedPolicyId !== result.expectedPolicyId) throw new Error(`import-map terrain mismatch: ${JSON.stringify(result)}`);
  if (!result.fullOwnerMapCoverage || result.legacyProceduralFallback) throw new Error(`full-map policy invalid: ${JSON.stringify(result)}`);
  if (!result.renderAndPhysicsSingleSource) throw new Error('adapter single-source contract is false');
  if (result.maxPhysicsError > 1e-9) throw new Error(`physics sampler mismatch ${result.maxPhysicsError}`);
  if (result.maxRenderError > 1e-6) throw new Error(`render sampler mismatch ${result.maxRenderError}`);
  if (result.meshPolicyId !== result.expectedPolicyId || !result.meshSingleSource) throw new Error('ChunkManager mesh did not use current terrain');
  if (result.spawnSource !== 'canonical-full-map') throw new Error(`spawn still uses unexpected source ${result.spawnSource}`);
  if (!(result.runtime?.chunks > 0) || !(result.runtime?.samplers > 0)) throw new Error('real game boot did not exercise current terrain adapter');

  console.log(`CURRENT_TERRAIN_BROWSER_METRICS=${JSON.stringify(result)}`);
  console.log('CURRENT_TERRAIN_BROWSER_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}