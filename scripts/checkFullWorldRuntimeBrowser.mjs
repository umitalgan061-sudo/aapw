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
  await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const terrain = await import('/src/3d/world/terrain.js');
    const physics = await import('/src/3d/physics.js');
    const { ChunkManager } = await import('/src/3d/world/chunkManager.js');
    const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
    const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
    const { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
    const { WORLD_REFERENCE_ALIGNMENT } = await import('/src/3d/world/worldReferenceAlignment.js');
    const baseSampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const flattenPads = computeSettlementFlattenPads({
      sampleHeightMeters: baseSampler,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const sampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
    const repeatSampler = terrain.createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
    const collider = physics.createGroundCollider(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
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

    const seats = KINGDOM_SEATS.map((seat) => {
      const mapped = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
      return { id: seat.id, x: mapped.x, z: mapped.z, groundY: sampler(mapped.x, mapped.z) };
    });
    const network = buildRoadNetwork({ seats, sampleHeightMeters: sampler });
    const roadDiagnostics = network.edges.map((edge) => {
      let worst = { gradeDegrees: 0 };
      for (let i = 1; i < edge.points.length; i += 1) {
        const a = edge.points[i - 1], b = edge.points[i];
        const run = Math.hypot(b.x - a.x, b.z - a.z);
        const rise = Math.abs(b.y - a.y);
        const gradeDegrees = Math.atan2(rise, Math.max(run, 1e-9)) * 180 / Math.PI;
        if (gradeDegrees > worst.gradeDegrees) {
          const midX = (a.x + b.x) * 0.5, midZ = (a.z + b.z) * 0.5;
          let nearestPadIndex = -1, nearestPadDistance = Infinity;
          flattenPads.forEach((pad, index) => {
            const distance = Math.hypot(midX - pad.x, midZ - pad.z);
            if (distance < nearestPadDistance) { nearestPadDistance = distance; nearestPadIndex = index; }
          });
          worst = {
            gradeDegrees, run, rise, segmentIndex: i - 1, midX, midZ,
            nearestPadId: nearestPadIndex >= 0 ? KINGDOM_SEATS[nearestPadIndex].id : null,
            nearestPadDistance,
            nearestPadOuterRadius: nearestPadIndex >= 0 ? flattenPads[nearestPadIndex].outerRadiusMeters : null,
            flattenDeltaA: sampler(a.x, a.z) - baseSampler(a.x, a.z),
            flattenDeltaB: sampler(b.x, b.z) - baseSampler(b.x, b.z),
          };
        }
      }
      return { fromId: edge.fromId, toId: edge.toId, edgeMaxGradeDegrees: edge.maxGradeDegrees, worst };
    }).sort((a, b) => b.worst.gradeDegrees - a.worst.gradeDegrees);

    const scene = new THREE.Scene();
    const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: WORLD_DEFAULTS.WORLD_SEED, flattenPads });
    const g17 = probes[0];
    const chunkX = Math.round(g17.x / 500), chunkZ = Math.round(g17.z / 500);
    const mesh = manager.loadChunk(chunkX, chunkZ);
    const directMesh = terrain.createTerrainChunk({ chunkX, chunkZ, size: 500, segments: 64, seed: WORLD_DEFAULTS.WORLD_SEED, flattenPads });
    const position = mesh.geometry.getAttribute('position');
    const directPosition = directMesh.geometry.getAttribute('position');
    let maxRenderError = 0, maxDirectError = 0;
    let worstRender = null, worstDirect = null;
    for (let index = 0; index < position.count; index += Math.max(1, Math.floor(position.count / 101))) {
      const x = mesh.position.x + position.getX(index);
      const z = mesh.position.z + position.getZ(index);
      const meshY = position.getY(index);
      const samplerY = sampler(x, z);
      const colliderY = collider.getGroundHeight(x, z);
      const error = Math.abs(meshY - colliderY);
      if (error > maxRenderError) {
        maxRenderError = error;
        worstRender = { index, x, z, meshY, samplerY, colliderY, error };
      }
      const directX = directMesh.position.x + directPosition.getX(index);
      const directZ = directMesh.position.z + directPosition.getZ(index);
      const directY = directPosition.getY(index);
      const directExpected = sampler(directX, directZ);
      const directError = Math.abs(directY - directExpected);
      if (directError > maxDirectError) {
        maxDirectError = directError;
        worstDirect = { index, x: directX, z: directZ, directY, samplerY: directExpected, error: directError };
      }
    }
    const output = {
      policyId: terrain.CURRENT_TERRAIN_POLICY.id,
      sourceMapSha256: terrain.CURRENT_TERRAIN_POLICY.sourceMapSha256,
      fullOwnerMapCoverage: terrain.CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage,
      legacyProceduralFallback: terrain.CURRENT_TERRAIN_POLICY.legacyProceduralFallback,
      mapDerivedHeight: terrain.CURRENT_TERRAIN_POLICY.mapDerivedHeight,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      denseHeight: { minimum, maximum, belowSea, aboveSea, checksum },
      maxPhysicsError, maxRenderError, maxDirectError, worstRender, worstDirect,
      meshPolicyId: mesh.userData.currentTerrainPolicy,
      meshSingleSource: mesh.userData.currentTerrainSingleSource === true,
      g17Height: sampler(g17.x, g17.z), g77Height: sampler(probes[1].x, probes[1].z),
      roadDiagnostics: roadDiagnostics.slice(0, 6),
    };
    terrain.disposeTerrainChunk(directMesh);
    manager.disposeAll();
    return output;
  });
  console.log(`FULL_WORLD_RUNTIME_ROAD_DIAGNOSTICS=${JSON.stringify(result.roadDiagnostics)}`);
  console.log(`FULL_WORLD_RUNTIME_PARITY_DIAGNOSTICS=${JSON.stringify({ maxPhysicsError: result.maxPhysicsError, maxRenderError: result.maxRenderError, maxDirectError: result.maxDirectError, worstRender: result.worstRender, worstDirect: result.worstDirect })}`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (!result.fullOwnerMapCoverage || result.legacyProceduralFallback || !result.mapDerivedHeight) throw new Error(`invalid runtime policy ${JSON.stringify(result)}`);
  if (result.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('runtime source-map checksum drifted');
  if (result.mapBounds.minX !== 0 || result.mapBounds.maxX !== 9000 || result.mapBounds.minY !== 0 || result.mapBounds.maxY !== 7000) throw new Error('browser runtime still cropped');
  if (result.denseHeight.belowSea === 0 || result.denseHeight.aboveSea === 0) throw new Error('dense live terrain lacks wet/dry range');
  if (result.denseHeight.maximum - result.denseHeight.minimum <= 100) throw new Error(`live relief is implausibly flat: ${JSON.stringify(result.denseHeight)}`);
  if (result.maxPhysicsError > 1e-9) throw new Error(`render/physics sampler source mismatch ${result.maxPhysicsError}`);
  if (result.maxDirectError > 1e-5) throw new Error(`direct terrain mesh/sampler height mismatch ${result.maxDirectError}`);
  if (result.maxRenderError > 1e-5) throw new Error(`chunk/collider height mismatch ${result.maxRenderError}`);
  if (result.meshPolicyId !== result.policyId || !result.meshSingleSource) throw new Error('ChunkManager mesh missing current-terrain provenance');
  console.log(`FULL_WORLD_RUNTIME_BROWSER=${JSON.stringify({ ...result, roadDiagnostics: undefined })}`);
  console.log('FULL_WORLD_RUNTIME_BROWSER_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}