import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  G07_HYDROLOGY_POLICY,
  buildG07Terrain3DProbe,
  isInsideG07,
  measureG07Hydrology,
  sampleG07WaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g07_hydrology.mjs';

assert.equal(G07_HYDROLOGY_POLICY.geoCell, 'G07');
assert.deepEqual(G07_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 896, yMax: 1024 });
assert.deepEqual(G07_HYDROLOGY_POLICY.maskBounds, { xMin: 0, xMax: 11, yMin: 56, yMax: 63 });
assert.deepEqual(G07_HYDROLOGY_POLICY.haloBounds, { xMin: -1, xMax: 12, yMin: 55, yMax: 64 });
assert.equal(G07_HYDROLOGY_POLICY.terrain3dRegionSize, 256);
assert.equal(G07_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG07(0, 0.875), true);
assert.equal(isInsideG07(0.125, 1), true);
assert.equal(isInsideG07(0.1251, 0.95), false);
assert.equal(sampleG07WaterConfidence(0.5, 0.95), null);
assert.throws(() => sampleG07WaterConfidence(Number.NaN, 0.95), TypeError);

const metrics = measureG07Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 96, 'G07 canonical sea inventory changed');
assert.equal(metrics.landCells, 0, 'G07 must not invent land');
assert.equal(metrics.boundaryEdges, 0, 'G07 uniform-sea topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 0, 'uniform G07 must not synthesize coastline');
assert.equal(metrics.hardCellMaxStep, 0);
assert.equal(metrics.maxAdjacentStep, 0, 'uniform G07 must remain seam-free internally');
assert.equal(metrics.confidenceChecksum, 3188080766, 'G07 confidence checksum changed');
assert.deepEqual(measureG07Hydrology(), metrics, 'G07 metrics must be deterministic');

const probe = buildG07Terrain3DProbe();
assert.equal(probe.width, 14);
assert.equal(probe.height, 10);
assert.equal(probe.rows.length, 10);
assert.ok(probe.rows.every((row) => row.length === 14));
assert.ok(probe.rows.flat().every((value) => value === 1), 'G07 halo must remain canonical sea, including clamped map edges');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = resolve(emitArg.slice('--emit-probe='.length));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(probe)}\n`, 'utf8');
  console.log(`G07_TERRAIN3D_PROBE_WRITTEN=${output}`);
}

console.log(JSON.stringify(metrics, null, 2));
console.log('SW_G07_HYDROLOGY_VALIDATION_OK');
