#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  G60_HYDROLOGY_POLICY,
  measureG60Hydrology,
} from '../godot/terrain-authoring/geocells/ne/g60_hydrology.mjs';

assert.equal(G60_HYDROLOGY_POLICY.geoCell, 'G60');
assert.deepEqual(G60_HYDROLOGY_POLICY.pixelBounds, { xMin: 1152, xMax: 1344, yMin: 0, yMax: 128 });
assert.deepEqual(G60_HYDROLOGY_POLICY.maskCellBounds, { xMin: 72, xMax: 84, yMin: 0, yMax: 8 });
assert.equal(G60_HYDROLOGY_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');

const first = measureG60Hydrology();
const second = measureG60Hydrology();
assert.deepEqual(first, second, 'G60 qualification must be deterministic');
assert.equal(first.baseCells, 96, 'G60 must cover exactly 12x8 canonical mask cells');
assert.equal(first.waterCells, 96, 'G60 canonical water-cell count drifted');
assert.equal(first.landCells, 0, 'G60 must not invent canonical land');
assert.equal(first.seaCells, 96, 'G60 must remain canonical sea');
assert.equal(first.lakeCells, 0, 'G60 must not invent an enclosed lake');
assert.equal(first.boundaryEdges, 0, 'G60 has no internal coastline to interpolate');
assert.equal(first.needsCoastInterpolation, false, 'uniform G60 sea must not create pointless coastline refinement');
assert.equal(first.semanticChecksum, 848461253, 'G60 semantic fingerprint changed');

console.log('NE_G60_HYDROLOGY_QUALIFIED', JSON.stringify(first));
