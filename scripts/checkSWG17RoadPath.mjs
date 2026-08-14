import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { G17_ROAD_PATH_POLICY } from '../godot/terrain-authoring/geocells/sw/g17_road_path.mjs';
import { sampleG17Biome } from '../godot/terrain-authoring/geocells/sw/g17_biome.mjs';
import { buildG17RockSnowControlProbe } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_control_probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]), file = path.join(ROOT, url === '/' ? 'game3d.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file); res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'text/javascript' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
let runtime;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded' });
  runtime = await page.evaluate(async ({ cell, guard }) => {
    const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
    const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
    const { createHeightSampler } = await import('/src/3d/world/terrain.js');
    const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
    const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const pads = computeSettlementFlattenPads({ sampleHeightMeters: raw, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS, minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS, mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
    const height = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
    const seats = KINGDOM_SEATS.map((s) => { const p = mapToWorldXZ(s.mapX, s.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT); return { id: s.id, x: p.x, z: p.z, groundY: height(p.x, p.z) }; });
    const network = buildRoadNetwork({ seats, sampleHeightMeters: height }), b = WORLD_SCALE.MAP_BOUNDS, m = WORLD_SCALE.METERS_PER_MAP_UNIT;
    const bounds = { x0: cell.xMin - guard, x1: cell.xMax + guard, y0: cell.yMin - guard, y1: cell.yMax + guard };
    const norm = (p) => ({ x: (p.x / m + (b.minX + b.maxX) / 2 - b.minX) / (b.maxX - b.minX), y: (p.z / m + (b.minY + b.maxY) / 2 - b.minY) / (b.maxY - b.minY) });
    const hits = (a, c) => !(Math.max(a.x, c.x) < bounds.x0 || Math.min(a.x, c.x) > bounds.x1 || Math.max(a.y, c.y) < bounds.y0 || Math.min(a.y, c.y) > bounds.y1);
    const count = (edges) => (edges ?? []).filter((e) => { const p = e.points.map(norm); return p.slice(1).some((v, i) => hits(p[i], v)); }).length;
    return { roadEdges: network.edges.length, pathEdges: network.footpathEdges.length, roadCrossings: count(network.edges), pathCrossings: count(network.footpathEdges) };
  }, { cell: G17_ROAD_PATH_POLICY.normalizedBounds, guard: G17_ROAD_PATH_POLICY.guardBandNormalized });
} finally { await browser.close(); server.close(); }
if (runtime.roadCrossings || runtime.pathCrossings) throw new Error(`G17 guard-band crossings: ${JSON.stringify(runtime)}`);
const prior = buildG17RockSnowControlProbe(), b = G17_ROAD_PATH_POLICY.normalizedBounds, n = prior.importSize;
if (prior.sourceMapSha256 !== G17_ROAD_PATH_POLICY.sourceMapSha256 || prior.maxSnowWeight !== 0) throw new Error('G17 prior-layer provenance changed');
const colors = Array.from({ length: n }, (_, z) => Array.from({ length: n }, (_, x) => {
  const s = sampleG17Biome(b.xMin + (b.xMax - b.xMin) * x / (n - 1), b.yMin + (b.yMax - b.yMin) * z / (n - 1));
  return [...s.color.map((v) => +v.toFixed(8)), +s.roughness.toFixed(8)];
}));
const probe = { ...prior, schema: 'westeros-g17-road-path-terrain3d-v1', policyId: G17_ROAD_PATH_POLICY.id, layer: G17_ROAD_PATH_POLICY.layer, roadTextureId: G17_ROAD_PATH_POLICY.roadTextureId, pathTextureId: G17_ROAD_PATH_POLICY.pathTextureId, maxRoadCoverage: 0, maxPathCoverage: 0, colors, ...runtime };
fs.mkdirSync(path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g17-road-path-probe.json'), JSON.stringify(probe));
console.log(`SW_G17_ROAD_PATH_METRICS=${JSON.stringify({ ...runtime, samples: prior.samples, checksum: prior.checksum })}`);
console.log('SW_G17_ROAD_PATH_SOURCE_OK');
