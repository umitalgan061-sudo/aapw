#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  G61_HYDROLOGY_POLICY,
  measureG61Hydrology,
} from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';

assert.equal(G61_HYDROLOGY_POLICY.geoCell, 'G61');
assert.deepEqual(G61_HYDROLOGY_POLICY.pixelBounds, { xMin: 1152, xMax: 1344, yMin: 128, yMax: 256 });
assert.deepEqual(G61_HYDROLOGY_POLICY.maskCellBounds, { xMin: 72, xMax: 84, yMin: 8, yMax: 16 });
assert.equal(G61_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');

const first = measureG61Hydrology();
const second = measureG61Hydrology();
assert.deepEqual(first, second, 'G61 qualification must be deterministic');
assert.equal(first.baseCells, 96, 'G61 must cover exactly 12x8 canonical mask cells');
assert.equal(first.waterCells, 96, 'G61 canonical water-cell count drifted');
assert.equal(first.landCells, 0, 'G61 must not invent canonical land');
assert.equal(first.seaCells, 96, 'G61 must remain canonical sea');
assert.equal(first.lakeCells, 0, 'G61 must not invent an enclosed lake');
assert.equal(first.boundaryEdges, 0, 'G61 has no internal coastline to interpolate');
assert.equal(first.needsCoastInterpolation, false, 'uniform G61 sea must not create pointless coastline refinement');
assert.equal(first.semanticChecksum, 848461253, 'G61 semantic fingerprint changed');

console.log('NE_G61_HYDROLOGY_QUALIFIED', JSON.stringify(first));
