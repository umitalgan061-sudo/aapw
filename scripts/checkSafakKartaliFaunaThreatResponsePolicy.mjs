import assert from 'node:assert/strict';
import { auditFaunaThreatResponsePlan, planFaunaThreatResponse } from '../src/3d/gameplay/livingWorldFaunaThreatResponsePolicy.js';

const actors = [
  { id: 'deer-1', species: 'deer', state: 'roam', position: { x: 0, z: 0 }, threatLevel: 0.1, groundValid: true, navReachable: true },
  { id: 'deer-2', species: 'deer', state: 'threat', position: { x: 12, z: 0 }, perception: { threat: 0.62 }, groundValid: true, navReachable: true },
  { id: 'wolf-1', species: 'wolf', state: 'roam', position: { x: 6, z: 0 }, threatLevel: 0.9, groundValid: true, navReachable: true },
  { id: 'invalid', species: 'deer', state: 'roam', position: { x: 0, z: 0 }, groundValid: false, navReachable: true },
];

const input = { actors, threatPosition: { x: 8, z: 0 } };
const first = planFaunaThreatResponse(input);
const second = planFaunaThreatResponse({ ...input, actors: [...actors].reverse() });
assert.deepEqual(first, second, 'threat response must be actor-order invariant');
assert.equal(first.transitions.length, 3);
assert.equal(first.transitions.find((item) => item.actorId === 'wolf-1')?.to, 'flee');
assert.equal(first.transitions.find((item) => item.actorId === 'deer-2')?.to, 'flee');
assert.equal(first.transitions.find((item) => item.actorId === 'deer-1')?.to, 'threat');
assert.equal(first.transitions.some((item) => item.actorId === 'invalid'), false);
assert.equal(auditFaunaThreatResponsePlan(first).ok, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.transitions[0]), true);

const calm = planFaunaThreatResponse({ actors: [{ id: 'deer-1', state: 'flee', position: { x: 100, z: 100 }, groundValid: true, navReachable: true }], threatPosition: { x: 0, z: 0 } });
assert.equal(calm.transitions[0].to, 'roam', 'flee must recover to roam after threat leaves');

console.log('Safak Kartali fauna threat-response policy proof passed.');
