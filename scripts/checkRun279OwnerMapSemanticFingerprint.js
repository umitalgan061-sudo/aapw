#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  WORLD_REFERENCE_BASE_SURFACE_MASK,
  WORLD_REFERENCE_PINDEXES,
  classifyReferenceBaseSurface,
  referencePindexFromNormalizedX,
} from '../src/3d/world/worldReferenceSurfacePindexes.js';

const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const EXPECTED_MASK_SHA = 'afe62a77fcc9b15887540b49b3b60b199e416f5e033aefb987a192411c25ae44';
const EXPECTED_PINDEX_COUNTS = Object.freeze([
  Object.freeze({ sea: 601, lake: 0, soil: 21, rock: 8, snow: 10 }),
  Object.freeze({ sea: 261, lake: 1, soil: 148, rock: 96, snow: 70 }),
  Object.freeze({ sea: 513, lake: 0, soil: 84, rock: 35, snow: 8 }),
  Object.freeze({ sea: 427, lake: 0, soil: 149, rock: 0, snow: 0 }),
  Object.freeze({ sea: 453, lake: 0, soil: 187, rock: 0, snow: 0 }),
  Object.freeze({ sea: 380, lake: 0, soil: 260, rock: 0, snow: 0 }),
  Object.freeze({ sea: 321, lake: 0, soil: 194, rock: 31, snow: 30 }),
  Object.freeze({ sea: 404, lake: 5, soil: 157, rock: 61, snow: 13 }),
  Object.freeze({ sea: 370, lake: 0, soil: 206, rock: 0, snow: 0 }),
  Object.freeze({ sea: 316, lake: 0, soil: 232, rock: 92, snow: 0 }),
]);

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
assert.equal(mask.sourceMapSha256, EXPECTED_SOURCE_SHA, 'owner map provenance changed');
assert.equal(mask.maskSha256, EXPECTED_MASK_SHA, 'declared semantic mask fingerprint changed');
assert.equal(mask.rowsHex.length, 64, 'semantic mask row count changed');
assert.ok(mask.rowsHex.every((row) => /^[0-9a-f]{72}$/.test(row)), 'semantic mask row encoding changed');

const packedMask = Buffer.concat(mask.rowsHex.map((row) => Buffer.from(row, 'hex')));
const packedMaskSha = createHash('sha256').update(packedMask).digest('hex');
assert.equal(packedMaskSha, EXPECTED_MASK_SHA, 'packed semantic mask bytes drifted');

assert.equal(WORLD_REFERENCE_PINDEXES.length, 10, 'pindex partition count changed');
const observedCounts = Array.from({ length: 10 }, () => ({ sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 }));
const spatial = createHash('sha256');
for (let y = 0; y < mask.height; y += 1) {
  for (let x = 0; x < mask.width; x += 1) {
    const nx = (x + 0.5) / mask.width;
    const ny = (y + 0.5) / mask.height;
    const surface = classifyReferenceBaseSurface(nx, ny);
    const pindex = referencePindexFromNormalizedX(nx);
    observedCounts[pindex - 1][surface] += 1;
    spatial.update(`${x},${y}:${surface}:${pindex};`);
  }
}
assert.deepEqual(observedCounts, EXPECTED_PINDEX_COUNTS, 'pindex semantic composition drifted');
for (let index = 0; index < WORLD_REFERENCE_PINDEXES.length; index += 1) {
  assert.deepEqual(WORLD_REFERENCE_PINDEXES[index].baseCellCounts, EXPECTED_PINDEX_COUNTS[index], `pindex ${index + 1} declared counts drifted`);
}

console.log('[Run279] owner-map semantic fingerprint PASS', JSON.stringify({
  sourceMapSha256: mask.sourceMapSha256,
  maskSha256: packedMaskSha,
  spatialFingerprint: spatial.digest('hex'),
  pindexes: observedCounts,
}));
