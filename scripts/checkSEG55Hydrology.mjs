import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  G55_HYDROLOGY_POLICY,
  buildG55Terrain3DProbe,
  isInsideG55,
  measureG55Hydrology,
  sampleG55WaterConfidence,
} from '../godot/terrain-authoring/geocells/se/g55_hydrology.mjs';

assert.equal(G55_HYDROLOGY_POLICY.geoCell, 'G55');
assert.deepEqual(G55_HYDROLOGY_POLICY.pixelBounds, { xMin: 960, xMax: 1152, yMin: 640, yMax: 768 });
assert.deepEqual(G55_HYDROLOGY_POLICY.maskBounds, { xMin: 60, xMax: 71, yMin: 40, yMax: 47 });
assert.deepEqual(G55_HYDROLOGY_POLICY.haloBounds, { xMin: 59, xMax: 72, yMin: 39, yMax: 48 });
assert.equal(G55_HYDROLOGY_POLICY.terrain3dRegionSize, 256);
assert.equal(G55_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(isInsideG55(0.625, 0.625), true);
assert.equal(isInsideG55(0.75, 0.75), true);
assert.equal(isInsideG55(0.6249, 0.7), false);
assert.equal(sampleG55WaterConfidence(0, 0), null);
assert.throws(() => sampleG55WaterConfidence(Number.NaN, 0.7), TypeError);

const metrics = measureG55Hydrology();
assert.equal(metrics.baseCells, 96);
assert.equal(metrics.waterCells, 5, 'G55 canonical water-centre inventory changed');
assert.equal(metrics.landCells, 91, 'G55 canonical land-centre inventory changed');
assert.equal(metrics.boundaryEdges, 8, 'G55 canonical coastline topology changed');
assert.equal(metrics.centreMismatches, 0, 'canonical mask-cell centre semantics must remain exact');
assert.equal(metrics.refinedSamples, 1617);
assert.equal(metrics.fractionalSamples, 146, 'G55 fractional coastline fingerprint changed');
assert.equal(metrics.hardCellMaxStep, 1);
assert.equal(metrics.maxAdjacentStep, 0.25, 'G55 refined coastline step changed');
assert.equal(metrics.confidenceChecksum, 3136049608, 'G55 confidence checksum changed');
assert.deepEqual(measureG55Hydrology(), metrics, 'G55 metrics must be deterministic');

const probe = buildG55Terrain3DProbe();
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
  console.log(`G55_TERRAIN3D_PROBE_WRITTEN=${output}`);
}

console.log(JSON.stringify(metrics, null, 2));
console.log('SE_G55_HYDROLOGY_VALIDATION_OK');
