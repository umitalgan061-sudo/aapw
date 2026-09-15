#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_SEDIMENT_CALIBRATION, sedimentCalibrationAt } from '../src/3d/world/terrainSurfaceSedimentCalibration.js';

assert.equal(TERRAIN_SEDIMENT_CALIBRATION.length, 512);
for (let i = 0; i < TERRAIN_SEDIMENT_CALIBRATION.length; i += 1) {
  const row = TERRAIN_SEDIMENT_CALIBRATION[i];
  assert.equal(row[0], i, `calibration row ${i} index drift`);
  assert.equal(row.length, 6, `calibration row ${i} schema drift`);
  for (let column = 1; column < row.length; column += 1) {
    assert(Number.isFinite(row[column]), `calibration row ${i} column ${column} must be finite`);
    assert(row[column] >= 0 && row[column] <= 1, `calibration row ${i} column ${column} outside 0..1`);
  }
  assert.deepEqual(sedimentCalibrationAt(i), {
    profile: row[0], deposit: row[1], wash: row[2], film: row[3], crust: row[4], cool: row[5],
  });
}
for (const a of [0, 32, 64, 128, 256, 384, 511]) {
  for (const b of [0, 32, 64, 128, 256, 384, 511]) {
    const left = sedimentCalibrationAt(a);
    const right = sedimentCalibrationAt(b);
    assert(Number.isFinite(left.deposit - right.deposit));
    assert(Number.isFinite(left.wash - right.wash));
  }
}
console.log(JSON.stringify({ rows: TERRAIN_SEDIMENT_CALIBRATION.length, pass: true }));
