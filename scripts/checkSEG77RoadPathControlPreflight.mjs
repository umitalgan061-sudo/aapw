#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
import {
  G77_ROAD_PATH_POLICY as P,
  buildG77RoadPathControlContract,
  findG77CrossingEdges,
  g77RoadGuardBounds,
  sampleG77RoadPath,
} from '../godot/terrain-authoring/geocells/se/g77_road_path.mjs';

const mapBounds = { minX: 0, maxX: 9000, minY: 0, maxY: 7000 }, metersPerMapUnit = 1;
const point = (nx, ny) => { const p = normalizedReferenceToWorldXZ(nx, ny, mapBounds, metersPerMapUnit); return { x: p.x, y: 0, z: p.z }; };
const emptyNetwork = { mapBounds, metersPerMapUnit, waterLevelMeters: 0, settlementPads: [], mainEdges: [], footpathEdges: [] };
const b = P.normalizedBounds, N = 257;
let samples = 0, maxHeightDelta = 0, maxSurfaceDelta = 0, maxCoverage = 0, checksum = 2166136261;
const hash = (value) => { const q = Math.round(value * 1e6) | 0; for (const shift of [0, 8, 16, 24]) checksum = Math.imul((checksum ^ (q >>> shift)) >>> 0, 16777619) >>> 0; };
for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
  const nx = b.xMin + (b.xMax - b.xMin) * x / (N - 1), ny = b.yMin + (b.yMax - b.yMin) * y / (N - 1);
  const prior = sampleG77RockSnow(nx, ny), s = sampleG77RoadPath(nx, ny, emptyNetwork), c = buildG77RoadPathControlContract(s);
  maxCoverage = Math.max(maxCoverage, s.coverage);
  maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - prior.height));
  maxSurfaceDelta = Math.max(maxSurfaceDelta, Math.abs(s.groundWeight - prior.groundWeight), Math.abs(s.rockWeight - prior.rockWeight), Math.abs(s.snowWeight - prior.snowWeight));
  assert.equal(c.baseTextureId, P.groundTextureId); assert.ok(c.overlayTextureId === P.rockTextureId || c.overlayTextureId === P.snowTextureId);
  hash(s.authoredHeight); hash(s.coverage); hash(c.overlayBlend); samples += 1;
}
assert.equal(samples, 66049); assert.equal(maxCoverage, 0); assert.equal(maxHeightDelta, 0); assert.equal(maxSurfaceDelta, 0);

let land = null;
for (let y = 0; y <= 64 && !land; y += 1) for (let x = 0; x <= 64 && !land; x += 1) {
  const nx = b.xMin + (b.xMax - b.xMin) * x / 64, ny = b.yMin + (b.yMax - b.yMin) * y / 64, s = sampleG77RockSnow(nx, ny);
  if (s.landFactor > 0.9) land = { nx, ny };
}
assert.ok(land, 'G77 mixed geography must expose a deep-land Road/Path test point');
const makeEdge = (tier) => {
  const a = point(Math.max(b.xMin, land.nx - 0.01), land.ny), c = point(Math.min(1, land.nx + 0.01), land.ny);
  const edge = { fromId: `${tier}-a`, toId: `${tier}-b`, points: [a, c] };
  return { ...emptyNetwork, mainEdges: tier === 'road' ? [edge] : [], footpathEdges: tier === 'path' ? [edge] : [] };
};
for (const tier of ['road', 'path']) {
  const network = makeEdge(tier), s = sampleG77RoadPath(land.nx, land.ny, network), c = buildG77RoadPathControlContract(s);
  assert.ok(s.coverage > 0.95, `${tier} did not materialize over real G77 land`);
  assert.equal(c.overlayTextureId, tier === 'road' ? P.roadTextureId : P.pathTextureId);
  assert.ok(c.overlayBlend > 0.95); assert.equal(findG77CrossingEdges(network).length, 1);
}

const guard = g77RoadGuardBounds();
const network = (pairs) => ({ ...emptyNetwork, mainEdges: pairs.map(([a, c], i) => ({ fromId: `a${i}`, toId: `b${i}`, points: [point(...a), point(...c)] })) });
for (const pair of [
  [[guard.xMin - .02, .94], [1, .94]],
  [[.94, guard.yMin - .02], [.94, 1]],
  [[.84, .84], [.99, .99]],
]) assert.equal(findG77CrossingEdges(network([pair])).length, 1, 'Liang-Barsky missed a G77 crossing');
for (const pair of [
  [[.60, .90], [guard.xMin - .01, .90]],
  [[.75, .70], [.84, .84]],
  [[.70, .99], [.80, .99]],
]) assert.equal(findG77CrossingEdges(network([pair])).length, 0, 'Liang-Barsky invented a G77 crossing');
assert.throws(() => sampleG77RoadPath(1.000001, .95, emptyNetwork), /escaped owner map/);
assert.throws(() => sampleG77RoadPath(.95, 1.000001, emptyNetwork), /escaped owner map/);

console.log(`SE_G77_ROAD_PATH_CONTROL_PREFLIGHT=${JSON.stringify({ samples, maxCoverage, maxHeightDelta, maxSurfaceDelta, syntheticLand: land, checksum: checksum >>> 0 })}`);
console.log('SE_G77_ROAD_PATH_CONTROL_PREFLIGHT_OK');
