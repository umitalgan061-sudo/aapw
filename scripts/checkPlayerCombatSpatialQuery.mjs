import assert from 'node:assert/strict';
import { buildPlayerCombatSpatialQuery, rankPlayerCombatSpatialCandidates, validatePlayerCombatSpatialQuery } from '../src/3d/gameplay/playerCombatSpatialQuery.js';

const descriptor = {
  grounded: true,
  hurtbox: { height: 1.72, radius: 0.3 },
  hitbox: { activeReachMeters: 2.05, widthMeters: 0.7, heightMeters: 0.7, attackKind: 'heavy' },
  separation: { visualColliderParityRequired: true, groundedContactRequired: true },
};
const query = buildPlayerCombatSpatialQuery({
  descriptor,
  origin: { x: 1, y: 2, z: 3 },
  forward: { x: 0, y: 0, z: 4 },
  queryId: 7,
  maxTargets: 2,
});
assert.equal(validatePlayerCombatSpatialQuery(query).ok, true);
assert.equal(query.hitbox.reachMeters, 2.05);
assert.equal(query.hurtbox.shape, 'capsule');
assert.equal(query.filters.requireLineOfSight, true);
assert.equal(query.bounds.maxTargets, 2);

const ranked = rankPlayerCombatSpatialCandidates(query, [
  { id: 'far', position: { x: 1, y: 2, z: 10 }, alive: true },
  { id: 'near', position: { x: 1, y: 2, z: 4.2 }, alive: true },
  { id: 'side', position: { x: 4, y: 2, z: 4 }, alive: true },
  { id: 'dead', position: { x: 1, y: 2, z: 4 }, alive: false },
]);
assert.deepEqual(ranked.map((entry) => entry.id), ['near']);
assert.ok(ranked[0].score > 0.7);

const repeat = rankPlayerCombatSpatialCandidates(query, [
  { id: 'near', position: { x: 1, y: 2, z: 4.2 }, alive: true },
]);
assert.deepEqual(repeat, rankPlayerCombatSpatialCandidates(query, [
  { id: 'near', position: { x: 1, y: 2, z: 4.2 }, alive: true },
]));

const bounded = buildPlayerCombatSpatialQuery({ descriptor, maxTargets: 999 });
assert.equal(bounded.bounds.maxTargets, 32);
assert.equal(validatePlayerCombatSpatialQuery({}).ok, false);
console.log('player combat spatial query checks passed');
