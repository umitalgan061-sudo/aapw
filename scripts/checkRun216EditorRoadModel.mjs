import assert from 'node:assert/strict';
import {
  EDITOR_ROAD_POLICY,
  appendEditorRoadPoint,
  buildEditorRoadRibbonBuffers,
  createEditorRoadRecord,
  isRenderableEditorRoad,
  removeLastEditorRoadPoint,
  serializeEditorRoad,
  validateSerializedEditorRoad
} from '../src/3d/editor/EditorRoadModel.js';

assert.equal(EDITOR_ROAD_POLICY.defaultWidthMeters, 8);
assert.equal(EDITOR_ROAD_POLICY.verticalOffsetMeters, 0.4);

const empty = createEditorRoadRecord({ id: 'road-0001', name: 'Ana Yol' });
assert.equal(empty.widthMeters, 8);
assert.equal(empty.points.length, 0);
assert.equal(isRenderableEditorRoad(empty), false);

const one = appendEditorRoadPoint(empty, { x: 0, y: 2, z: 0 });
const two = appendEditorRoadPoint(one, { x: 10, y: 2, z: 0 });
assert.equal(empty.points.length, 0, 'append must not mutate prior record');
assert.equal(one.points.length, 1);
assert.equal(two.points.length, 2);
assert.equal(isRenderableEditorRoad(two), true);

const buffers = buildEditorRoadRibbonBuffers(two);
assert.deepEqual([...buffers.positions], [
  0, 2.4, 4,
  0, 2.4, -4,
  10, 2.4, 4,
  10, 2.4, -4
]);
assert.deepEqual([...buffers.indices], [0, 1, 2, 1, 3, 2]);

const backToOne = removeLastEditorRoadPoint(two);
assert.equal(backToOne.points.length, 1);
assert.equal(two.points.length, 2, 'remove-last must not mutate prior record');

const serialized = serializeEditorRoad(two);
assert.deepEqual(serialized, {
  id: 'road-0001',
  name: 'Ana Yol',
  widthMeters: 8,
  points: [[0, 2, 0], [10, 2, 0]]
});
const validated = validateSerializedEditorRoad(JSON.parse(JSON.stringify(serialized)));
assert.deepEqual(serializeEditorRoad(validated), serialized, 'road JSON round-trip drifted');

assert.throws(() => createEditorRoadRecord({ id: '', points: [] }), /id is required/);
assert.throws(() => createEditorRoadRecord({ id: 'bad-width', widthMeters: 0 }), /width/);
assert.throws(() => appendEditorRoadPoint(empty, { x: Number.NaN, y: 0, z: 0 }), /finite/);
assert.throws(() => validateSerializedEditorRoad({ id: 'bad-point', widthMeters: 8, points: [[1, 2]] }), /\[x,y,z\]/);

console.log('PASS Run216 editor road model: immutable control points, 8m deterministic ribbon, 0.4m surface offset, validation and JSON round-trip.');
