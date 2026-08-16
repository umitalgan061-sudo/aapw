#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildG77RockSnowControlContract, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
import { G77_ROAD_PATH_POLICY as P } from '../godot/terrain-authoring/geocells/se/g77_road_path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probePath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g77-road-path-probe.json');
assert.ok(fs.existsSync(probePath), 'G77 Road/Path probe missing');
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
assert.equal(probe.schema, 'westeros-g77-terrain3d-road-path-probe-v1');
assert.equal(probe.sourceMapSha256, P.sourceMapSha256); assert.equal(probe.sourceGridSize, 257);

const b = P.normalizedBounds, N = 257;
let samples = 0, activeRoad = 0, activePath = 0, waterLeak = 0, controlDrift = 0;
let maxHeightDrift = 0, maxGroundDrift = 0, maxRockDrift = 0, maxSnowDrift = 0, maxWaterDrift = 0;
let maxAdjacentCoverageStep = 0, verticalGridEnergy = 0, horizontalGridEnergy = 0, nonGridEnergy = 0, gridSamples = 0, nonGridSamples = 0;
let checksum = 2166136261, previous = null;
const hash = (v) => { const q = Math.round(v * 1e6) | 0; for (const shift of [0, 8, 16, 24]) checksum = Math.imul((checksum ^ (q >>> shift)) >>> 0, 16777619) >>> 0; };
for (let y = 0; y < N; y += 1) {
  const ny = b.yMin + (b.yMax - b.yMin) * y / (N - 1), rowCoverage = [];
  assert.equal(probe.rows[y].length, N);
  for (let x = 0; x < N; x += 1) {
    const nx = b.xMin + (b.xMax - b.xMin) * x / (N - 1), r = probe.rows[y][x], base = sampleG77RockSnow(nx, ny);
    assert.equal(r.length, 12); const road = r[1], pathCoverage = r[2], coverage = Math.max(road, pathCoverage), support = r[8];
    maxHeightDrift = Math.max(maxHeightDrift, Math.abs(r[0] - base.height)); maxGroundDrift = Math.max(maxGroundDrift, Math.abs(r[4] - base.groundWeight));
    maxRockDrift = Math.max(maxRockDrift, Math.abs(r[5] - base.rockWeight)); maxSnowDrift = Math.max(maxSnowDrift, Math.abs(r[6] - base.snowWeight)); maxWaterDrift = Math.max(maxWaterDrift, Math.abs(r[7] - base.waterConfidence));
    if (road > 0.02) activeRoad += 1; if (pathCoverage > 0.02) activePath += 1;
    if (r[7] >= 0.5 && support <= 0.001 && coverage > 0.000001) waterLeak += 1;
    if (coverage <= 0.002) { const c = buildG77RockSnowControlContract(base); if (r[9] !== c.baseTextureId || r[10] !== c.overlayTextureId || r[11] !== c.overlayBlend8) controlDrift += 1; }
    for (const [neighbor, grid] of [[x ? rowCoverage[x - 1] : null, x > 0 && x % 32 === 0], [previous ? previous[x] : null, y > 0 && y % 32 === 0]]) if (neighbor !== null) {
      const step = Math.abs(coverage - neighbor); maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, step);
      if (grid) { if (x > 0 && x % 32 === 0) verticalGridEnergy += step; else horizontalGridEnergy += step; gridSamples += 1; } else { nonGridEnergy += step; nonGridSamples += 1; }
    }
    hash(r[0]); hash(road); hash(pathCoverage); hash(r[4]); hash(r[5]); hash(r[6]); rowCoverage.push(coverage); samples += 1;
  }
  previous = rowCoverage;
}
assert.equal(samples, 66049); assert.ok(maxHeightDrift <= 0.000001 && maxGroundDrift <= 0.00000001 && maxRockDrift <= 0.00000001 && maxSnowDrift <= 0.00000001 && maxWaterDrift <= 0.00000001, 'Road/Path probe drifted from merged G77 predecessor');
assert.equal(waterLeak, 0); assert.equal(controlDrift, 0); assert.ok(maxAdjacentCoverageStep <= 0.82);
assert.equal(activeRoad, probe.activeRoadSamples); assert.equal(activePath, probe.activePathSamples);
const roadCross = probe.crossingEdges.some((e) => e.tier === 'road'), pathCross = probe.crossingEdges.some((e) => e.tier === 'path');
assert.equal(activeRoad > 0, roadCross); assert.equal(activePath > 0, pathCross);
if (!roadCross && !pathCross) assert.equal(Math.max(verticalGridEnergy, horizontalGridEnergy, nonGridEnergy), 0, 'route-free G77 contains grid-shaped paint');
else { const gridMean = (verticalGridEnergy + horizontalGridEnergy) / Math.max(1, gridSamples), otherMean = nonGridEnergy / Math.max(1, nonGridSamples); assert.ok(gridMean / Math.max(1e-9, otherMean) <= 4, 'possible authoring-grid imprint'); }

let canonicalWater = 0, canonicalLand = 0; const m = P.maskBounds;
for (let y = m.yMin; y <= m.yMax; y += 1) for (let x = m.xMin; x <= m.xMax; x += 1) sampleG77RockSnow((x + .5) / 96, (y + .5) / 64).waterConfidence >= .5 ? canonicalWater++ : canonicalLand++;
assert.equal(canonicalWater, 44); assert.equal(canonicalLand, 52);
console.log(`SE_G77_ROAD_PATH_MAP_FIDELITY=${JSON.stringify({ samples, canonicalWater, canonicalLand, activeRoad, activePath, waterLeak, controlDrift, maxHeightDrift, maxGroundDrift, maxRockDrift, maxSnowDrift, maxWaterDrift, maxAdjacentCoverageStep, checksum: checksum >>> 0 })}`);
console.log('SE_G77_ROAD_PATH_MAP_FIDELITY_OK');
