import assert from 'node:assert/strict';
import { createFaunaThreatPolicy } from '../src/3d/gameplay/livingWorldFaunaThreatPolicy.js';

const policy = createFaunaThreatPolicy({ threatRadius: 20, fleeRadius: 5, investigateRadius: 12 });
const actors = [
  { id: 'wolf-2', kind: 'wolf', position: { x: 4, y: 0, z: 0 }, perception: { visualConfidence: 1, hearingConfidence: 0 }, state: 'flee' },
  { id: 'wolf-1', kind: 'wolf', position: { x: 8, y: 0, z: 0 }, perception: { visualConfidence: 0.5, hearingConfidence: 0.5 }, state: 'investigate' },
  { id: 'stag', kind: 'deer', position: { x: 30, y: 0, z: 0 }, perception: { visualConfidence: 1 }, state: 'roam' },
];

const first = policy.snapshot({ actors, origin: { x: 0, y: 0, z: 0 } });
const second = policy.snapshot({ actors, origin: { x: 0, y: 0, z: 0 } });
assert.deepEqual(first, second);
assert.deepEqual(first.actors.map((actor) => actor.id), ['wolf-2', 'wolf-1']);
assert.equal(first.threatCount, 2);
assert.equal(first.fleeingCount, 1);
assert.equal(first.reactingCount, 2);
assert.equal(first.actors[0].zone, 'flee');
assert.equal(first.actors[1].zone, 'investigate');

const bounded = policy.snapshot({ actors, maxActors: 1 });
assert.equal(bounded.scanned, 1);
assert.equal(bounded.truncated, true);

const target = {};
assert.equal(policy.writeTelemetry(target, first), true);
assert.deepEqual(target.userData.livingWorldFaunaThreat, {
  threatCount: 2,
  fleeingCount: 1,
  reactingCount: 2,
  truncated: false,
});

console.log('LIVING_WORLD_FAUNA_THREAT_POLICY_OK');
