#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  G70_HYDROLOGY_POLICY,
  measureG70Hydrology,
} from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';

assert.equal(G70_HYDROLOGY_POLICY.geoCell, 'G70');
assert.deepEqual(G70_HYDROLOGY_POLICY.pixelBounds, { xMin: 1344, xMax: 1536, yMin: 0, yMax: 128 });
assert.deepEqual(G70_HYDROLOGY_POLICY.maskCellBounds, { xMin: 84, xMax: 96, yMin: 0, yMax: 8 });
assert.equal(G70_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');

const first = measureG70Hydrology();
const second = measureG70Hydrology();
assert.deepEqual(first, second, 'G70 qualification must be deterministic');
assert.equal(first.baseCells, 96, 'G70 must cover exactly 12x8 canonical mask cells');
assert.equal(first.waterCells, 96, 'G70 canonical water-cell count drifted');
assert.equal(first.landCells, 0, 'G70 must not invent canonical land');
assert.equal(first.seaCells, 96, 'G70 must remain border-connected sea');
assert.equal(first.lakeCells, 0, 'G70 must not invent an enclosed lake');
assert.equal(first.boundaryEdges, 0, 'G70 has no internal coastline to interpolate');
assert.equal(first.needsCoastInterpolation, false, 'uniform G70 sea must not create pointless coastline refinement');
assert.equal(first.semanticChecksum, 848461253, 'G70 semantic fingerprint changed');

console.log('NE_G70_HYDROLOGY_QUALIFIED', JSON.stringify(first));
