import assert from 'node:assert/strict';
import {
  EDITOR_TERRAIN_CELL_POLICY,
  editorTerrainCellKey,
  snapEditorTerrainCell
} from '../src/3d/editor/EditorTerrainCellModel.js';

assert.equal(EDITOR_TERRAIN_CELL_POLICY.defaultCellSizeMeters, 10);
assert.equal(EDITOR_TERRAIN_CELL_POLICY.landSurfaceOffsetMeters, 0.02);
assert.equal(EDITOR_TERRAIN_CELL_POLICY.waterSurfaceOffsetMeters, 0.08);

const snapped = snapEditorTerrainCell({ x: 14, y: 3.5, z: -16 }, 10);
assert.deepEqual({ ...snapped }, { x: 10, y: 3.5, z: -20, size: 10 });
assert.equal(editorTerrainCellKey('land', snapped), 'land:10:-20:10');
assert.equal(editorTerrainCellKey('water', snapped), 'water:10:-20:10');

const precise = snapEditorTerrainCell({ x: 1.24, y: 0, z: 2.76 }, 0.5);
assert.deepEqual({ ...precise }, { x: 1, y: 0, z: 3, size: 0.5 });

assert.throws(() => snapEditorTerrainCell({ x: 0, y: 0, z: 0 }, 0), /positive finite/);
assert.throws(() => snapEditorTerrainCell({ x: Number.NaN, y: 0, z: 0 }, 10), /finite x\/y\/z/);
assert.throws(() => editorTerrainCellKey('lava', snapped), /land or water/);

console.log('PASS Run216 terrain cell model: deterministic snapping, configurable metric cell size, land/water identity and surface offsets.');
