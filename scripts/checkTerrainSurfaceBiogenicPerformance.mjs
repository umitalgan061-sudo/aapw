#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveTerrainBiogenicState } from '../src/3d/world/terrainSurfaceBiogenic.js';

const width = 128;
const height = 96;
const samples = width * height;
let checksum = 0;
let minimum = 1;
let maximum = 0;
const start = performance.now();
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const state = resolveTerrainBiogenicState({
      worldX: (x - width * 0.5) * 39.5,
      worldZ: (y - height * 0.5) * 43.25,
      heightMeters: -2 + ((x * 19 + y * 23) % 530),
      slopeDegrees: 2 + ((x * 11 + y * 7) % 410) / 10,
      moisture: ((x * 37 + y * 17) % 101) / 100,
      baseColor: {
        r: 0.22 + ((x * 5) % 15) / 100,
        g: 0.32 + ((y * 7) % 21) / 100,
        b: 0.16 + ((x + y) % 13) / 100,
      },
    });
    checksum += state.litter * 0.27 + state.humus * 0.23 + state.moss * 0.19 + state.mineralExposure * 0.17;
    minimum = Math.min(minimum, state.litter, state.humus, state.moss, state.mineralExposure);
    maximum = Math.max(maximum, state.litter, state.humus, state.moss, state.mineralExposure);
  }
}
const elapsedMs = performance.now() - start;
assert(Number.isFinite(checksum));
assert(minimum >= 0);
assert(maximum <= 1);
assert((elapsedMs * 1000) / samples < 90, 'biogenic state exceeds 90 us/sample budget');
console.log(JSON.stringify({ samples, elapsedMs: Number(elapsedMs.toFixed(3)), perSampleUs: Number(((elapsedMs * 1000) / samples).toFixed(3)), checksum: Number(checksum.toFixed(8)), pass: true }));
