import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  G17_ROAD_PATH_POLICY,
  measureG17ZeroCoverage,
  measurePolylineAgainstG17,
} from '../godot/terrain-authoring/geocells/sw/g17_road_path.mjs';
import { sampleG17Biome } from '../godot/terrain-authoring/geocells/sw/g17_biome.mjs';
import { buildG17RockSnowControlProbe } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_control_probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const { chromium } = createRequire(import.meta.url)('playwright');

function fnvWord(checksum, value) {
  let out = checksum >>> 0;
  const word = value >>> 0;
  for (let shift = 0; shift < 32; shift += 8) {
    out = Math.imul((out ^ ((word >>> shift) & 0xff)) >>> 0, 16777619) >>> 0;
  }
  return out;
}

function normalizePoint(point, mapBounds, metersPerMapUnit) {
  const centerX = (mapBounds.minX + mapBounds.maxX) * 0.5;
  const centerY = (mapBounds.minY + mapBounds.maxY) * 0.5;
  const mapX = point.x / metersPerMapUnit + centerX;
  const mapY = point.z / metersPerMapUnit + centerY;
  return {
    x: (mapX - mapBounds.minX) / (mapBounds.maxX - mapBounds.minX),
    y: (mapY - mapBounds.minY) / (mapBounds.maxY - mapBounds.minY),
  };
}

function summarizeTier(edges, tier, mapBounds, metersPerMapUnit) {
  let routeChecksum = 2166136261;
  let segmentCount = 0;
  let ownedCrossingSegments = 0;
  let guardCrossingSegments = 0;
  let minOwnedClearance = Infinity;
  let minGuardClearance = Infinity;
  let closestEdge = null;
  const summaries = [];
  for (const edge of edges ?? []) {
    const points = (edge.points ?? []).map((point) => normalizePoint(point, mapBounds, metersPerMapUnit));
    const measure = measurePolylineAgainstG17(points);
    segmentCount += measure.segmentCount;
    ownedCrossingSegments += measure.ownedCrossings;
    guardCrossingSegments += measure.guardCrossings;
    if (measure.minGuardClearance < minGuardClearance) {
      minGuardClearance = measure.minGuardClearance;
      closestEdge = `${edge.fromId}->${edge.toId}`;
    }
    minOwnedClearance = Math.min(minOwnedClearance, measure.minOwnedClearance);
    for (const point of points) {
      routeChecksum = fnvWord(routeChecksum, Math.round(point.x * 1e7));
      routeChecksum = fnvWord(routeChecksum, Math.round(point.y * 1e7));
    }
    summaries.push({
      tier,
      fromId: edge.fromId,
      toId: edge.toId,
      points: points.length,
      segmentCount: measure.segmentCount,
      ownedCrossingSegments: measure.ownedCrossings,
      guardCrossingSegments: measure.guardCrossings,
      minOwnedClearance: +measure.minOwnedClearance.toFixed(10),
      minGuardClearance: +measure.minGuardClearance.toFixed(10),
    });
  }
  return {
    tier,
    edgeCount: (edges ?? []).length,
    segmentCount,
    ownedCrossingSegments,
    guardCrossingSegments,
    minOwnedClearance: Number.isFinite(minOwnedClearance) ? +minOwnedClearance.toFixed(10) : null,
    minGuardClearance: Number.isFinite(minGuardClearance) ? +minGuardClearance.toFixed(10) : null,
    closestEdge,
    routeChecksum,
    edges: summaries,
  };
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'game3d.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const ext = path.extname(file);
  const mime = ext === '.html' ? 'text/html' :
    ext === '.css' ? 'text/css' :
    ext === '.json' ? 'application/json' :
    ext === '.svg' ? 'image/svg+xml' :
    'text/javascript';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
let runtime;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  runtime = await page.evaluate(async () => {
    const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } =
      await import('/src/3d/world/settlements.js');
    const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } =
      await import('/src/3d/config.js');
    const { createHeightSampler } = await import('/src/3d/world/terrain.js');
    const { buildRoadNetwork } = await import('/src/3d/world/roads.js');

    const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const pads = computeSettlementFlattenPads({
      sampleHeightMeters: raw,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const height = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
    const seats = KINGDOM_SEATS.map((seat) => {
      const p = mapToWorldXZ(
        seat.mapX,
        seat.mapY,
        WORLD_SCALE.MAP_BOUNDS,
        WORLD_SCALE.METERS_PER_MAP_UNIT,
      );
      return { id: seat.id, x: p.x, z: p.z, groundY: height(p.x, p.z) };
    });
    const network = buildRoadNetwork({ seats, sampleHeightMeters: height });
    const serialize = (edge) => ({
      fromId: edge.fromId,
      toId: edge.toId,
      lengthMeters: edge.lengthMeters,
      maxGradeDegrees: edge.maxGradeDegrees,
      points: edge.points.map((point) => ({ x: point.x, z: point.z })),
    });
    return {
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      roads: network.edges.map(serialize),
      paths: (network.footpathEdges ?? []).map(serialize),
      totalRoadLengthMeters: network.totalLengthMeters,
      totalPathLengthMeters: network.footpathTotalLengthMeters ?? 0,
    };
  });
} finally {
  await browser.close();
  server.close();
}

const roads = summarizeTier(runtime.roads, 'road', runtime.mapBounds, runtime.metersPerMapUnit);
const paths = summarizeTier(runtime.paths, 'path', runtime.mapBounds, runtime.metersPerMapUnit);
if (roads.ownedCrossingSegments || roads.guardCrossingSegments ||
    paths.ownedCrossingSegments || paths.guardCrossingSegments) {
  throw new Error(`G17 live route entered owned/guard sea parcel: ${JSON.stringify({ roads, paths })}`);
}

const coverage = measureG17ZeroCoverage();
if (coverage.activeSamples !== 0 || coverage.maxCoverage !== 0) {
  throw new Error(`G17 open-sea Road/Path source is not zero: ${JSON.stringify(coverage)}`);
}

const prior = buildG17RockSnowControlProbe();
if (prior.sourceMapSha256 !== G17_ROAD_PATH_POLICY.sourceMapSha256 || prior.maxSnowWeight !== 0) {
  throw new Error('G17 prior-layer provenance changed');
}
if (prior.importSize !== G17_ROAD_PATH_POLICY.terrain3dImportSize) {
  throw new Error(`unexpected prior import size ${prior.importSize}`);
}

const b = G17_ROAD_PATH_POLICY.normalizedBounds;
const n = prior.importSize;
const colors = Array.from({ length: n }, (_, z) => Array.from({ length: n }, (_, x) => {
  const nx = b.xMin + (b.xMax - b.xMin) * x / (n - 1);
  const ny = b.yMin + (b.yMax - b.yMin) * z / (n - 1);
  const sample = sampleG17Biome(nx, ny);
  return [...sample.color.map((value) => +value.toFixed(8)), +sample.roughness.toFixed(8)];
}));

const routeEvidence = {
  roadEdges: roads.edgeCount,
  pathEdges: paths.edgeCount,
  roadSegments: roads.segmentCount,
  pathSegments: paths.segmentCount,
  roadOwnedCrossingSegments: roads.ownedCrossingSegments,
  roadGuardCrossingSegments: roads.guardCrossingSegments,
  pathOwnedCrossingSegments: paths.ownedCrossingSegments,
  pathGuardCrossingSegments: paths.guardCrossingSegments,
  minRoadOwnedClearance: roads.minOwnedClearance,
  minRoadGuardClearance: roads.minGuardClearance,
  minPathOwnedClearance: paths.minOwnedClearance,
  minPathGuardClearance: paths.minGuardClearance,
  closestRoadEdge: roads.closestEdge,
  closestPathEdge: paths.closestEdge,
  roadRouteChecksum: roads.routeChecksum,
  pathRouteChecksum: paths.routeChecksum,
  totalRoadLengthMeters: +runtime.totalRoadLengthMeters.toFixed(4),
  totalPathLengthMeters: +runtime.totalPathLengthMeters.toFixed(4),
};

const probe = {
  ...prior,
  schema: 'westeros-g17-road-path-terrain3d-v2',
  policyId: G17_ROAD_PATH_POLICY.id,
  layer: G17_ROAD_PATH_POLICY.layer,
  guardBandNormalizedX: G17_ROAD_PATH_POLICY.guardBandNormalizedX,
  guardBandNormalizedY: G17_ROAD_PATH_POLICY.guardBandNormalizedY,
  roadTextureId: G17_ROAD_PATH_POLICY.roadTextureId,
  pathTextureId: G17_ROAD_PATH_POLICY.pathTextureId,
  maxRoadCoverage: 0,
  maxPathCoverage: 0,
  coverage,
  routeEvidence,
  roadEdges: roads.edges,
  pathEdges: paths.edges,
  colors,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'g17-road-path-probe.json'), JSON.stringify(probe));
fs.writeFileSync(
  path.join(OUT, 'g17-road-path-source-evidence.json'),
  `${JSON.stringify({ schema: 'westeros-g17-road-path-source-evidence-v2', coverage, routeEvidence }, null, 2)}\n`,
);

console.log(`SW_G17_ROAD_PATH_METRICS=${JSON.stringify({
  ...routeEvidence,
  sourceSamples: coverage.samples,
  activeSamples: coverage.activeSamples,
  coverageChecksum: coverage.coverageChecksum,
  substrateChecksum: prior.checksum,
})}`);
console.log('SW_G17_ROAD_PATH_SOURCE_OK');
