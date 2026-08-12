import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  G52_HYDROLOGY_POLICY,
  buildG52Terrain3DProbe,
  isInsideG52,
  measureG52Hydrology,
  sampleG52WaterConfidence,
} from '../godot/terrain-authoring/geocells/ne/g52_hydrology.mjs';

assert.equal(G52_HYDROLOGY_POLICY.geoCell, 'G52');
assert.deepEqual(G52_HYDROLOGY_POLICY.pixelBounds, { xMin: 960, xMax: 1152, yMin: 256, yMax: 384 });
assert.deepEqual(G52_HYDROLOGY_POLICY.maskBounds, { xMin: 60, xMax: 71, yMin: 16, yMax: 23 });
assert.deepEqual(G52_HYDROLOGY_POLICY.haloBounds, { xMin: 59, xMax: 72, yMin: 15, yMax: 24 });
assert.equal(G52_HYDROLOGY_POLICY.terrain3dRegionSize, 256);
assert.equal(G52_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG52(0.625, 0.25), true);
assert.equal(isInsideG52(0.75, 0.375), true);
assert.equal(isInsideG52(0.6249, 0.3), false);
assert.equal(sampleG52WaterConfidence(0, 0), null);
assert.throws(() => sampleG52WaterConfidence(Number.NaN, 0.3), TypeError);

const metrics = measureG52Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 84, 'G52 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 12, 'G52 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 14, 'G52 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 220, 'G52 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G52 refined coastline step changed');
assert.equal(metrics.confidenceChecksum, 1827349787, 'G52 confidence checksum changed');
assert.deepEqual(measureG52Hydrology(), metrics, 'G52 metrics must be deterministic');

const probe = buildG52Terrain3DProbe();
assert.equal(probe.width, 14);
assert.equal(probe.height, 10);
assert.equal(probe.rows.length, 10);
assert.ok(probe.rows.every((row) => row.length === 14));
assert.ok(probe.rows.flat().every((value) => value === 0 || value === 1));

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = resolve(emitArg.slice('--emit-probe='.length));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(probe)}\n`, 'utf8');
  console.log(`G52_TERRAIN3D_PROBE_WRITTEN=${output}`);
}

console.log(JSON.stringify(metrics, null, 2));
console.log('NE_G52_HYDROLOGY_VALIDATION_OK');
