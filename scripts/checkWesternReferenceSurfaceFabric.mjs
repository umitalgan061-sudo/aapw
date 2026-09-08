#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  WESTERN_REFERENCE_SURFACE_FABRIC_POLICY,
  applyWesternReferenceSurfaceFabricToColorAttribute,
  sampleWesternReferenceSurfaceFabric,
} from '../src/3d/world/westernReferenceSurfaceFabric.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = WESTERN_REFERENCE_SURFACE_FABRIC_POLICY;
assert.equal(P.renderOnly, true);
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.hydrologyAuthorityUnchanged, true);
assert.equal(P.colliderAuthorityUnchanged, true);
assert(P.macroMeters > P.mesoMeters && P.mesoMeters > P.fineMeters && P.fineMeters > P.microMeters);
assert(P.warpMeters > 0 && P.warpMeters < P.mesoMeters);
assert(P.drainageMeters > P.mesoMeters && P.drainageMeters < P.macroMeters);
assert(P.alluviumMeters > P.drainageMeters);
assert(P.aerialReliefMeters > P.mesoMeters && P.aerialReliefMeters < P.macroMeters,
  'aerial relief carrier must stay between meso and macro scales');
assert(P.surfaceCarrierMeters > P.fineMeters && P.surfaceCarrierMeters < P.mesoMeters,
  'surface carrier must stay between fine and meso scales');
assert(P.aerialReliefMeters > P.surfaceCarrierMeters,
  'aerial relief carrier must remain broader than the surface carrier');

const scalarKeys = [
  'macro', 'meso', 'fine', 'micro', 'aerialRelief', 'surfaceCarrier', 'moisture', 'mineral', 'weathering',
  'streak', 'crust', 'drainageThread', 'alluvium', 'exposedInterfluve',
];
const valuesByKey = new Map(scalarKeys.map((key) => [key, []]));
for (let z = -4200; z <= 4200; z += 350) {
  for (let x = -8200; x <= -400; x += 350) {
    const a = sampleWesternReferenceSurfaceFabric(x, z);
    const b = sampleWesternReferenceSurfaceFabric(x, z);
    assert.deepEqual(a, b, `fabric lost determinism at ${x}/${z}`);
    for (const key of scalarKeys) {
      assert(Number.isFinite(a[key]), `${key} is not finite at ${x}/${z}`);
      assert(a[key] >= 0 && a[key] <= 1, `${key} escaped unit interval at ${x}/${z}: ${a[key]}`);
      valuesByKey.get(key).push(a[key]);
    }
  }
}

const summarize = (values) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { min, max, range: max - min, mean, sd: Math.sqrt(variance) };
};
const correlation = (a, b) => {
  assert.equal(a.length, b.length, 'carrier correlation sample lengths diverged');
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0;
  let energyA = 0;
  let energyB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    numerator += da * db;
    energyA += da * da;
    energyB += db * db;
  }
  const denominator = Math.sqrt(energyA * energyB);
  return denominator > 1e-12 ? numerator / denominator : 1;
};

const summaries = Object.fromEntries([...valuesByKey].map(([key, values]) => [key, summarize(values)]));
for (const key of ['macro', 'meso', 'fine', 'moisture', 'mineral', 'weathering']) {
  assert(summaries[key].range > 0.32, `${key} fabric became visually inert: ${JSON.stringify(summaries[key])}`);
  assert(summaries[key].sd > 0.09, `${key} fabric became too uniform: ${JSON.stringify(summaries[key])}`);
}
for (const key of ['aerialRelief', 'surfaceCarrier']) {
  assert(summaries[key].range > 0.55, `${key} carrier became visually inert: ${JSON.stringify(summaries[key])}`);
  assert(summaries[key].sd > 0.12, `${key} carrier became too uniform: ${JSON.stringify(summaries[key])}`);
}
const carrierCorrelation = correlation(valuesByKey.get('aerialRelief'), valuesByKey.get('surfaceCarrier'));
assert(Math.abs(carrierCorrelation) < 0.65,
  `western aerial carriers became too correlated and may reintroduce long material bands: ${carrierCorrelation}`);
assert(summaries.drainageThread.range > 0.25, `drainage threading became inert: ${JSON.stringify(summaries.drainageThread)}`);
assert(summaries.alluvium.range > 0.25, `alluvial weathering became inert: ${JSON.stringify(summaries.alluvium)}`);
assert(summaries.exposedInterfluve.range > 0.15, `interfluve exposure became inert: ${JSON.stringify(summaries.exposedInterfluve)}`);
assert(summaries.drainageThread.mean < 0.20, 'drainage threads spread too broadly and would read as invented rivers');
assert(summaries.alluvium.mean < 0.35, 'alluvium spread too broadly across western land');

const base = [0.42, 0.39, 0.31];
const surfaces = ['soil', 'rock', 'snow', 'lake', 'sea'];
const deltas = {};
for (const [surfaceIndex, surface] of surfaces.entries()) {
  const color = new THREE.BufferAttribute(new Float32Array(base), 3);
  const before = [color.getX(0), color.getY(0), color.getZ(0)];
  const changed = applyWesternReferenceSurfaceFabricToColorAttribute(color, 0, {
    surface,
    worldX: -6100 + surfaceIndex * 430,
    worldZ: 1700 - surfaceIndex * 280,
  });
  const delta = Math.hypot(color.getX(0) - before[0], color.getY(0) - before[1], color.getZ(0) - before[2]);
  deltas[surface] = delta;
  if (surface === 'sea') {
    assert.equal(changed, false);
    assert.equal(delta, 0, 'sea must remain owned exclusively by westernMarineShelfTone');
  } else {
    assert.equal(changed, true);
    assert(delta > 0.002, `${surface} fabric became visually inert: delta=${delta}`);
    assert(delta < 0.18, `${surface} fabric became overpowering: delta=${delta}`);
  }
}

for (const pindex of ['01', '02', '03']) {
  const source = readFileSync(resolve(HERE, `../src/3d/world/worldReferencePindex${pindex}Detail.js`), 'utf8');
  assert.match(source, /westernReferenceSurfaceFabric\.js/);
  assert.match(source, /applyWesternReferenceSurfaceFabricToColorAttribute\(color, index, c\)/);
  assert(!source.includes('normalizedX * 1024'), `Pindex ${pindex} regressed to normalized-map micro hash`);
  assert(!source.includes('function hash01'), `Pindex ${pindex} regressed to a local single-frequency hash`);
}

console.log('[checkWesternReferenceSurfaceFabric] PASS', JSON.stringify({
  policyId: P.id,
  summaries,
  carrierCorrelation,
  deltas,
}));
