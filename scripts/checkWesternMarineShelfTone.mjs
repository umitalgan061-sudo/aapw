#!/usr/bin/env node
/** Render-only western marine shelf tone acceptance. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  WESTERN_MARINE_SHELF_TONE_POLICY,
  applyWesternMarineShelfToneToColorAttribute,
  westernMarineShelfToneWeight,
} from '../src/3d/world/westernMarineShelfTone.js';
import { PINDEX01_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex01Detail.js';
import { PINDEX02_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex02Detail.js';
import { PINDEX03_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex03Detail.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = WESTERN_MARINE_SHELF_TONE_POLICY;
const sea = (normalizedX, normalizedY = 0.47) => westernMarineShelfToneWeight({
  surface: 'sea', normalizedX, normalizedY,
});

assert.equal(P.id, 'western-marine-shelf-tone-2026-08-26-v6-bounded-depositional-weathering');
assert.equal(P.renderOnly, true);
assert.equal(P.canonicalSeaOnly, true);
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.fadeEndNormalizedX, 0.40);
assert(P.maxBlend > 0.65 && P.maxBlend < 0.85);
assert(P.fabricGainMin >= 0.70 && P.fabricGainMin < P.fabricGainMax);
assert(P.fabricGainMax <= 0.99, 'fabric must not amplify the canonical west-east envelope');
assert(P.domainWarpNormalized > 0 && P.domainWarpNormalized < 0.03);
assert(P.sedimentBandVariation > 0.05);
assert(P.currentScourVariation > 0.04);
assert(P.turbidityVariation > 0.04);
assert(P.fanVariation > 0.05);
assert(P.bedformVariation > 0.04);
assert(P.mineralRidgeVariation > 0.04);
for (const policy of [PINDEX01_DETAIL_POLICY, PINDEX02_DETAIL_POLICY, PINDEX03_DETAIL_POLICY]) {
  assert.equal(policy.westernMarineShelfTone, true, `Pindex ${policy.pindex} lost shared shelf tone wiring`);
}

for (const surface of ['lake', 'soil', 'rock', 'snow']) {
  assert.equal(westernMarineShelfToneWeight({ surface, normalizedX: 0.05, normalizedY: 0.5 }), 0);
}
assert.equal(westernMarineShelfToneWeight({ surface: 'sea', normalizedX: Number.NaN, normalizedY: 0.5 }), 0);

const west = sea(0.035);
const middle = sea(0.18);
const inner = sea(0.32);
const outside = sea(0.40);
assert(west > middle && middle > inner && inner > 0, `west-to-east tone is not monotonic enough: ${west}/${middle}/${inner}`);
assert.equal(outside, 0, 'western shelf tone must reach exact-neutral before the interior sea');
for (const boundary of [0.10, 0.20, 0.30]) {
  const left = sea(boundary - 1e-7, 0.63);
  const right = sea(boundary + 1e-7, 0.63);
  assert(Math.abs(left - right) < 1e-5, `owner-map boundary ${boundary} exposed a shelf-tone seam: ${left}/${right}`);
}

const shelfSamples = [];
for (const x of [0.07, 0.12, 0.19, 0.26, 0.33]) {
  for (let y = 0.08; y <= 0.92; y += 0.07) shelfSamples.push(sea(x, y));
}
const shelfMin = Math.min(...shelfSamples);
const shelfMax = Math.max(...shelfSamples);
const shelfRange = shelfMax - shelfMin;
assert(shelfRange > 0.025, `shelf fabric became visually uniform: range=${shelfRange}`);
assert(shelfRange < 0.70, `shelf fabric overwhelms canonical west-east envelope: range=${shelfRange}`);
assert(shelfMax <= P.maxBlend * P.fabricGainMax + 1e-12,
  `fabric exceeded bounded optical envelope: ${shelfMax}`);

const transverse = [];
for (let y = 0.06; y <= 0.94; y += 0.055) transverse.push(sea(0.13, y));
const transverseRange = Math.max(...transverse) - Math.min(...transverse);
assert(transverseRange > 0.012, `depositional/current transverse fabric became inert: range=${transverseRange}`);
assert(transverseRange < 0.22, `transverse shelf fabric became noisy/overpowering: range=${transverseRange}`);

const data = new Float32Array([
  0.36, 0.34, 0.28,
  0.36, 0.34, 0.28,
  0.36, 0.34, 0.28,
  0.36, 0.34, 0.28,
]);
const color = new THREE.BufferAttribute(data, 3);
const before = Array.from(data);
const appliedWest = applyWesternMarineShelfToneToColorAttribute(color, 0, { surface: 'sea', normalizedX: 0.04, normalizedY: 0.47 });
const appliedWestAlternate = applyWesternMarineShelfToneToColorAttribute(color, 1, { surface: 'sea', normalizedX: 0.12, normalizedY: 0.76 });
const appliedLake = applyWesternMarineShelfToneToColorAttribute(color, 2, { surface: 'lake', normalizedX: 0.04, normalizedY: 0.47 });
const appliedInterior = applyWesternMarineShelfToneToColorAttribute(color, 3, { surface: 'sea', normalizedX: 0.50, normalizedY: 0.47 });
assert(appliedWest > 0.65 && appliedWest < 0.85);
assert(appliedWestAlternate > 0);
assert.equal(appliedLake, 0);
assert.equal(appliedInterior, 0);
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
assert(
  luminance(color.getX(0), color.getY(0), color.getZ(0)) < luminance(before[0], before[1], before[2]) - 0.16,
  'western canonical sea should become decisively darker than the terrestrial-looking shelf input',
);
const westernColorDelta = Math.hypot(
  color.getX(0) - color.getX(1),
  color.getY(0) - color.getY(1),
  color.getZ(0) - color.getZ(1),
);
assert(westernColorDelta > 0.004, `v6 shelf material collapsed toward a uniform tint: delta=${westernColorDelta}`);
for (const index of [2, 3]) {
  assert.equal(color.getX(index), before[index * 3]);
  assert.equal(color.getY(index), before[index * 3 + 1]);
  assert.equal(color.getZ(index), before[index * 3 + 2]);
}

const deterministicA = new THREE.BufferAttribute(new Float32Array([0.36, 0.34, 0.28]), 3);
const deterministicB = new THREE.BufferAttribute(new Float32Array([0.36, 0.34, 0.28]), 3);
const classification = { surface: 'sea', normalizedX: 0.13, normalizedY: 0.71 };
applyWesternMarineShelfToneToColorAttribute(deterministicA, 0, classification);
applyWesternMarineShelfToneToColorAttribute(deterministicB, 0, classification);
for (let channel = 0; channel < 3; channel += 1) assert.equal(deterministicA.array[channel], deterministicB.array[channel]);

for (const pindex of ['01', '02', '03']) {
  const source = readFileSync(resolve(HERE, `../src/3d/world/worldReferencePindex${pindex}Detail.js`), 'utf8');
  assert.match(source, /from '\.\/westernMarineShelfTone\.js'/);
  assert.match(source, /applyWesternMarineShelfToneToColorAttribute\(color, index, c\)/);
}

console.log('[checkWesternMarineShelfTone] PASS', JSON.stringify({
  west, middle, inner, outside,
  shelfRange,
  transverseRange,
  westernColorDelta,
}));
