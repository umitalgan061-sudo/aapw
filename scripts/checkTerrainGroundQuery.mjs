import assert from 'node:assert/strict';
import {
  createTerrainGroundEvidence,
  evaluateTerrainPlacement,
  queryTerrainGround,
} from '../src/3d/world/terrainGroundQuery.js';

const authorities = {
  seaLevel: 0,
  heightAt: ({ x, z }) => (x === 0 && z === 0 ? 4 : -2),
  colliderHeightAt: ({ x, z }) => (x === 0 && z === 0 ? 4.5 : -2),
  waterConfidenceAt: ({ x, z }) => (x === 0 && z === 0 ? 0 : 1),
  surfaceMaskAt: ({ x, z }) => (x === 0 && z === 0 ? 'land' : 'water'),
  biomeAt: ({ x, z }) => (x === 0 && z === 0 ? 'north' : 'sea'),
  slopeAt: ({ x, z }) => (x === 0 && z === 0 ? 0.2 : 0),
  roadDistanceAt: () => 25,
  settlementDistanceAt: () => 140,
};

const land = queryTerrainGround({ x: 0, z: 0 }, authorities);
assert.equal(land.valid, true);
assert.equal(land.isWater, false);
assert.equal(land.colliderHeight, 4.5);
assert.equal(land.surfaceMask, 'land');

const tree = evaluateTerrainPlacement({ x: 0, z: 0 }, { category: 'tree' }, authorities);
assert.equal(tree.accepted, true);
assert.deepEqual(tree.reasons, []);
assert.deepEqual(tree.groundTransform, { x: 0, y: 4.5, z: 0 });

const waterTree = evaluateTerrainPlacement({ x: 20, z: 20 }, { category: 'tree' }, authorities);
assert.equal(waterTree.accepted, false);
assert.ok(waterTree.reasons.includes('canonical-water'));

const bridge = evaluateTerrainPlacement({ x: 20, z: 20 }, { category: 'bridge', waterAllowed: true }, authorities);
assert.equal(bridge.accepted, true);

const steep = evaluateTerrainPlacement({ x: 0, z: 0 }, { category: 'house', maxSlope: 0.1 }, authorities);
assert.equal(steep.accepted, false);
assert.ok(steep.reasons.includes('slope-limit'));

const evidenceA = createTerrainGroundEvidence(tree);
const evidenceB = createTerrainGroundEvidence(tree);
assert.deepEqual(evidenceA, evidenceB);
assert.equal(evidenceA.source, 'terrain-ground-query-v1');

const malformed = queryTerrainGround({ x: Number.NaN, z: Infinity }, {
  heightAt: () => { throw new Error('sampler failure'); },
});
assert.equal(malformed.valid, true);
assert.equal(malformed.height, 0);
assert.equal(malformed.isWater, false);

console.log('TERRAIN_GROUND_QUERY_CONTRACT_PASS');
