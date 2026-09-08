#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainWindSnowSurfaceFabricSafely, resolveTerrainWindSnowSurfaceFabric, sanitizeTerrainWindSnowSurfaceFabricInput } from '../src/3d/world/terrainWindSnowSurfaceFabric.js';
import { terrainWindExposureFromNeighbours, resolveTerrainWindSnowAdjustment } from '../src/3d/world/terrainWindSnowExposure.js';

const normalized = ['slope','steepness','cliff','directional','crosswindNeutrality','foldStrength','ridgeShoulder','brokenRidge','shelteredPocket','valleyContinuity','slopeTransition','windwardAlignment','leeAlignment','leeRetention','retention','ridgeCrust','leePowder','continuity'];
function validateFabric(f, label) {
  for (const key of normalized) assert(Number.isFinite(f[key]) && f[key] >= -1e-9 && f[key] <= 1 + 1e-9, `${label}.${key}`);
  for (const key of ['windwardGain','leeGain']) assert(Number.isFinite(f[key]) && f[key] >= 0.86 - 1e-9 && f[key] <= 1.14 + 1e-9, `${label}.${key}`);
  assert(Number.isFinite(f.materialTemperatureBias));
  assert(Number.isFinite(f.materialBrightnessBias));
}

const malformed = [
  undefined, null, {},
  { slopeDegrees: NaN, aspectDot: Infinity, foldGradient: -Infinity, leeRetention: NaN },
  { slopeDegrees: 'bad', aspectDot: {}, foldGradient: [], leeRetention: 'bad' },
  { slopeDegrees: -1000, aspectDot: 1000, foldGradient: -100, leeRetention: 1000 },
];
for (let i = 0; i < malformed.length; i += 1) {
  const clean = sanitizeTerrainWindSnowSurfaceFabricInput(malformed[i] ?? {});
  assert(Object.isFrozen(clean));
  validateFabric(resolveTerrainWindSnowSurfaceFabricSafely(malformed[i] ?? {}), `safe-${i}`);
}

const heights = [
  [100,100,100,100], [100.001,99.999,100,100], [0,1,0,-1],
  [80,120,80,120], [120,80,120,80], [1e6,-1e6,1e6,-1e6],
];
for (const h of heights) for (const spacing of [0, -10, 1e-9, 1, 10, 100, NaN, Infinity]) {
  const result = terrainWindExposureFromNeighbours(...h, spacing);
  assert(Number.isFinite(result.slopeDegrees));
  assert(Number.isFinite(result.aspectDot));
  assert(result.windward >= 0 && result.windward <= 1);
  assert(result.lee >= 0 && result.lee <= 1);
  validateFabric(result.surfaceFabric, `stencil-${h.join('.')}-${spacing}`);
}

for (const slope of [0,5,10,20,30,45,60,90]) {
  const positive = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: slope, aspectDot: 0.9, foldGradient: 0.12 });
  const negative = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: slope, aspectDot: -0.9, foldGradient: 0.12 });
  validateFabric(positive, `positive-${slope}`);
  validateFabric(negative, `negative-${slope}`);
  assert(positive.ridgeCrust >= 0);
  assert(negative.leePowder >= 0);
  if (slope >= 46) assert(negative.cliff >= 0);
}

for (const fold of [0,0.01,0.025,0.05,0.1,0.2,0.4,1]) {
  const f = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: 0.75, foldGradient: fold });
  validateFabric(f, `fold-${fold}`);
}

for (const aspect of [-1,-0.8,-0.5,-0.2,0,0.2,0.5,0.8,1]) {
  const f = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 30, aspectDot: aspect, foldGradient: 0.14 });
  validateFabric(f, `aspect-${aspect}`);
}

const adjustments = [
  { windward:0, lee:0, permanentIce:0, tundra:0 },
  { windward:1, lee:0, permanentIce:1, tundra:1 },
  { windward:0, lee:1, permanentIce:1, tundra:1 },
  { windward:1, lee:1, permanentIce:0.5, tundra:0.5, ridgelineExposure:1, shelterPocket:1, snowMobility:1 },
];
for (const [i, input] of adjustments.entries()) {
  const result = resolveTerrainWindSnowAdjustment(input);
  for (const key of ['windwardScour','leeDeposit','scourMax','depositMax','scourProfile','depositProfile','ridgelineExposure','shelterPocket','snowMobility','crustScour','packGain']) {
    assert(Number.isFinite(result[key]), `adjustment-${i}.${key}`);
  }
  assert(result.windwardScour >= 0 && result.windwardScour <= 1);
  assert(result.leeDeposit >= 0 && result.leeDeposit <= 1);
}

console.log('[checkTerrainWindSnowEdgeCases] PASS', JSON.stringify({ malformed: malformed.length, stencil: heights.length * 8, adjustmentCases: adjustments.length }));
