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

const scalarKeys = ['macro', 'meso', 'fine', 'micro', 'moisture', 'mineral', 'weathering', 'streak', 'crust'];
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
const summaries = Object.fromEntries([...valuesByKey].map(([key, values]) => [key, summarize(values)]));
for (const key of ['macro', 'meso', 'fine', 'moisture', 'mineral', 'weathering']) {
  assert(summaries[key].range > 0.32, `${key} fabric became visually inert: ${JSON.stringify(summaries[key])}`);
  assert(summaries[key].sd > 0.09, `${key} fabric became too uniform: ${JSON.stringify(summaries[key])}`);
}

const base = [0.42, 0.39, 0.31];
const surfaces = ['soil', 'rock', 'snow', 'lake', 'sea'];
const deltas = {};
for (const [surfaceIndex, surface] of surfaces.entries()) {
  const color = new THREE.BufferAttribute(new Float32Array(base), 3);
  const changed = applyWesternReferenceSurfaceFabricToColorAttribute(color, 0, {
    surface,
    worldX: -6100 + surfaceIndex * 430,
    worldZ: 1700 - surfaceIndex * 280,
  });
  const delta = Math.hypot(color.getX(0) - base[0], color.getY(0) - base[1], color.getZ(0) - base[2]);
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
  deltas,
}));
