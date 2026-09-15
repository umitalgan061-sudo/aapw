#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveTerrainSedimentState, TERRAIN_SEDIMENT_POLICY } from '../src/3d/world/terrainSurfaceSediment.js';

const width = 160;
const height = 100;
const samples = [];
for (let z = 0; z < height; z += 1) {
  for (let x = 0; x < width; x += 1) {
    samples.push({
      x: (x - width * 0.5) * 37.5,
      z: (z - height * 0.5) * 41.0,
      height: -2 + ((x * 17 + z * 11) % 530),
      slope: 2 + ((x * 7 + z * 13) % 430) / 10,
    });
  }
}

const start = performance.now();
let checksum = 0;
let min = 1;
let max = 0;
for (const sample of samples) {
  const state = resolveTerrainSedimentState({
    worldX: sample.x,
    worldZ: sample.z,
    heightMeters: sample.height,
    slopeDegrees: sample.slope,
  });
  checksum += state.sedimentLoad * 0.37 + state.wash * 0.23 + state.film * 0.19 + state.crust * 0.11;
  min = Math.min(min, state.sedimentLoad, state.wash, state.film, state.crust);
  max = Math.max(max, state.sedimentLoad, state.wash, state.film, state.crust);
}
const elapsedMs = performance.now() - start;
const perSampleUs = (elapsedMs * 1000) / samples.length;
assert(min >= 0, `minimum state value ${min} is invalid`);
assert(max <= 1, `maximum state value ${max} is invalid`);
assert(Number.isFinite(checksum));
assert(Number.isFinite(perSampleUs));
assert(perSampleUs < 90, `sediment state is too slow: ${perSampleUs.toFixed(3)} us/sample`);

const secondStart = performance.now();
let secondChecksum = 0;
for (const sample of samples) {
  const state = resolveTerrainSedimentState({
    worldX: sample.x,
    worldZ: sample.z,
    heightMeters: sample.height,
    slopeDegrees: sample.slope,
  });
  secondChecksum += state.sedimentLoad * 0.37 + state.wash * 0.23 + state.film * 0.19 + state.crust * 0.11;
}
const secondElapsedMs = performance.now() - secondStart;
assert(Math.abs(checksum - secondChecksum) < 1e-9, 'performance sweep must remain deterministic');
console.log(JSON.stringify({
  policyId: TERRAIN_SEDIMENT_POLICY.id,
  samples: samples.length,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  perSampleUs: Number(perSampleUs.toFixed(3)),
  repeatElapsedMs: Number(secondElapsedMs.toFixed(3)),
  checksum: Number(checksum.toFixed(8)),
  pass: true,
}));
