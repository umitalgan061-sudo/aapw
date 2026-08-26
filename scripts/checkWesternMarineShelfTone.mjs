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

assert.equal(P.renderOnly, true);
assert.equal(P.canonicalSeaOnly, true);
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.fadeEndNormalizedX, 0.34);
assert(P.maxBlend > 0.65 && P.maxBlend < 0.85);
for (const policy of [PINDEX01_DETAIL_POLICY, PINDEX02_DETAIL_POLICY, PINDEX03_DETAIL_POLICY]) {
  assert.equal(policy.westernMarineShelfTone, true, `Pindex ${policy.pindex} lost shared shelf tone wiring`);
}

// Canonical class authority: no lake, soil, rock or snow vertex may receive this sea-floor tone.
for (const surface of ['lake', 'soil', 'rock', 'snow']) {
  assert.equal(westernMarineShelfToneWeight({ surface, normalizedX: 0.05, normalizedY: 0.5 }), 0);
}
assert.equal(westernMarineShelfToneWeight({ surface: 'sea', normalizedX: Number.NaN, normalizedY: 0.5 }), 0);

// The western shelf must grade continuously into the interior sea instead of forming a Pindex stripe.
const west = sea(0.04);
const middle = sea(0.17);
const inner = sea(0.29);
const outside = sea(0.34);
assert(west > middle && middle > inner && inner > 0, `west-to-east tone is not monotonic enough: ${west}/${middle}/${inner}`);
assert.equal(outside, 0, 'western shelf tone must reach exact-neutral before the interior sea');
for (const boundary of [0.10, 0.20]) {
  const left = sea(boundary - 1e-7, 0.63);
  const right = sea(boundary + 1e-7, 0.63);
  assert(Math.abs(left - right) < 1e-5, `Pindex boundary ${boundary} exposed a shelf-tone seam: ${left}/${right}`);
}

// Colour application must produce a decisive submerged-ocean read while leaving lake/interior sea bytes untouched.
const data = new Float32Array([
  0.36, 0.34, 0.28,
  0.36, 0.34, 0.28,
  0.36, 0.34, 0.28,
]);
const color = new THREE.BufferAttribute(data, 3);
const before = Array.from(data);
const appliedWest = applyWesternMarineShelfToneToColorAttribute(color, 0, { surface: 'sea', normalizedX: 0.04, normalizedY: 0.47 });
const appliedLake = applyWesternMarineShelfToneToColorAttribute(color, 1, { surface: 'lake', normalizedX: 0.04, normalizedY: 0.47 });
const appliedInterior = applyWesternMarineShelfToneToColorAttribute(color, 2, { surface: 'sea', normalizedX: 0.50, normalizedY: 0.47 });
assert(appliedWest > 0.65 && appliedWest < 0.85);
assert.equal(appliedLake, 0);
assert.equal(appliedInterior, 0);
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
assert(
  luminance(color.getX(0), color.getY(0), color.getZ(0)) < luminance(before[0], before[1], before[2]) - 0.16,
  'western canonical sea should become decisively darker than the terrestrial-looking shelf input',
);
for (const index of [1, 2]) {
  assert.equal(color.getX(index), before[index * 3]);
  assert.equal(color.getY(index), before[index * 3 + 1]);
  assert.equal(color.getZ(index), before[index * 3 + 2]);
}

// Integration remains deliberately narrow: only the three western Pindex detail passes consume it.
for (const pindex of ['01', '02', '03']) {
  const source = readFileSync(resolve(HERE, `../src/3d/world/worldReferencePindex${pindex}Detail.js`), 'utf8');
  assert.match(source, /from '\.\/westernMarineShelfTone\.js'/);
  assert.match(source, /applyWesternMarineShelfToneToColorAttribute\(color, index, c\);/);
}

console.log('[checkWesternMarineShelfTone] PASS', JSON.stringify({ west, middle, inner, outside }));
