import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  G75_HYDROLOGY_POLICY,
  buildG75Terrain3DProbe,
  isInsideG75,
  measureG75Hydrology,
  sampleG75WaterConfidence,
} from '../godot/terrain-authoring/geocells/se/g75_hydrology.mjs';

assert.equal(G75_HYDROLOGY_POLICY.geoCell, 'G75');
assert.deepEqual(G75_HYDROLOGY_POLICY.pixelBounds, { xMin: 1344, xMax: 1536, yMin: 640, yMax: 768 });
assert.deepEqual(G75_HYDROLOGY_POLICY.maskBounds, { xMin: 84, xMax: 95, yMin: 40, yMax: 47 });
assert.deepEqual(G75_HYDROLOGY_POLICY.haloBounds, { xMin: 83, xMax: 96, yMin: 39, yMax: 48 });
assert.equal(G75_HYDROLOGY_POLICY.terrain3dRegionSize, 256);
assert.equal(G75_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG75(0.875, 0.625), true);
assert.equal(isInsideG75(1, 0.75), true);
assert.equal(isInsideG75(0.8749, 0.7), false);
assert.equal(sampleG75WaterConfidence(0.5, 0.7), null);
assert.throws(() => sampleG75WaterConfidence(Number.NaN, 0.7), TypeError);

const metrics = measureG75Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 0, 'G75 canonical dry-land inventory changed');
assert.equal(metrics.landCells, 96, 'G75 must not invent water');
assert.equal(metrics.boundaryEdges, 0, 'G75 uniform dry-land topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 0, 'uniform G75 must not synthesize coastline');
assert.equal(metrics.hardCellMaxStep, 0);
assert.equal(metrics.maxAdjacentStep, 0, 'uniform G75 must remain seam-free internally');
assert.equal(metrics.confidenceChecksum, 4145742303, 'G75 confidence checksum changed');
assert.deepEqual(measureG75Hydrology(), metrics, 'G75 metrics must be deterministic');

const probe = buildG75Terrain3DProbe();
assert.equal(probe.width, 14);
assert.equal(probe.height, 10);
assert.equal(probe.rows.length, 10);
assert.ok(probe.rows.every((row) => row.length === 14));
assert.ok(probe.rows.flat().every((value) => value === 0), 'G75 guard band must remain canonical dry land');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = resolve(emitArg.slice('--emit-probe='.length));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(probe)}\n`, 'utf8');
  console.log(`G75_TERRAIN3D_PROBE_WRITTEN=${output}`);
}

console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G75_HYDROLOGY_VALIDATION_OK');
