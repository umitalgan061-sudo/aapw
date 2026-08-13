import devServerHelper from './devServerHelper.js';
import { G07_RUNTIME_BAKE_POLICY } from '../godot/terrain-authoring/geocells/sw/g07_runtime_bake_source.mjs';

const { startStaticServer, loadPlaywright } = devServerHelper;

function segmentIntersectsRect(a, b, rect) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - rect.xMin],
    [dx, rect.xMax - a.x],
    [-dy, a.y - rect.yMin],
    [dy, rect.yMax - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return false;
  }
  return true;
}

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright is required for real runtime G07 road/path exclusion');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const edges = await page.evaluate(async () => {
    const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
    const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
    const { createHeightSampler } = await import('/src/3d/world/terrain.js');
    const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
    const { worldXZToNormalizedReference } = await import('/src/3d/world/worldReferenceAlignment.js');
    const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const pads = computeSettlementFlattenPads({
      sampleHeightMeters: base,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
    const seats = KINGDOM_SEATS.map((seat) => {
      const p = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
      return { id: seat.id, x: p.x, z: p.z, groundY: sampleHeightMeters(p.x, p.z) };
    });
    const network = buildRoadNetwork({ seats, sampleHeightMeters });
    const pack = (edge, kind) => ({
      kind,
      fromId: edge.fromId,
      toId: edge.toId,
      points: edge.points.map((point) => {
        const normalized = worldXZToNormalizedReference(
          point.x,
          point.z,
          WORLD_SCALE.MAP_BOUNDS,
          WORLD_SCALE.METERS_PER_MAP_UNIT,
        );
        return { x: normalized.x, y: normalized.y };
      }),
    });
    return [
      ...network.edges.map((edge) => pack(edge, 'road')),
      ...network.footpathEdges.map((edge) => pack(edge, 'path')),
    ];
  });

  const bounds = G07_RUNTIME_BAKE_POLICY.normalizedBounds;
  const guard = G07_RUNTIME_BAKE_POLICY.guardBandNormalized;
  const rect = {
    xMin: Math.max(0, bounds.xMin - guard),
    xMax: Math.min(1, bounds.xMax + guard),
    yMin: Math.max(0, bounds.yMin - guard),
    yMax: Math.min(1, bounds.yMax + guard),
  };
  const crossingEdges = [];
  let pointCount = 0;
  for (const edge of edges) {
    pointCount += edge.points.length;
    for (let i = 0; i + 1 < edge.points.length; i += 1) {
      if (segmentIntersectsRect(edge.points[i], edge.points[i + 1], rect)) {
        crossingEdges.push(`${edge.kind}:${edge.fromId}->${edge.toId}`);
        break;
      }
    }
  }
  if (crossingEdges.length) throw new Error(`live road/path crosses G07 guard: ${crossingEdges.join(', ')}`);
  const metrics = {
    edgeCount: edges.length,
    roadEdgeCount: edges.filter((edge) => edge.kind === 'road').length,
    pathEdgeCount: edges.filter((edge) => edge.kind === 'path').length,
    pointCount,
    crossingEdges,
  };
  console.log(`G07_LIVE_ROAD_EXCLUSION_METRICS=${JSON.stringify(metrics)}`);
  console.log('SW_G07_LIVE_ROAD_EXCLUSION_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
