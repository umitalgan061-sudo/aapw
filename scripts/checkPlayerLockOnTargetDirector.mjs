import assert from 'node:assert/strict';
import {
  buildPlayerLockOnTargetPlan,
  buildPlayerLockOnCyclePlan,
  buildPlayerLockOnEvidence,
} from '../src/3d/gameplay/playerLockOnTargetDirector.js';

const input = {
  facing: { x: 0, y: 1 },
  currentTargetId: 'far',
  candidates: [
    { id: 'left', distanceMeters: 8, angleRadians: 0.4, visibility: 1, threat: 0.4, direction: { x: -0.5, y: 0.9 }, faction: 'enemy' },
    { id: 'center', distanceMeters: 6, angleRadians: 0.1, visibility: 1, threat: 0.8, direction: { x: 0, y: 1 }, faction: 'enemy' },
    { id: 'friendly', distanceMeters: 2, angleRadians: 0.1, visibility: 1, threat: 1, direction: { x: 0, y: 1 }, faction: 'player' },
    { id: 'far', distanceMeters: 60, angleRadians: 0, visibility: 1, threat: 1, direction: { x: 0, y: 1 }, faction: 'enemy' },
  ],
};

const first = buildPlayerLockOnTargetPlan(input);
const second = buildPlayerLockOnTargetPlan(input);
assert.deepEqual(first, second);
assert.equal(first.selectedTargetId, 'center');
assert.equal(first.hasTarget, true);
assert.equal(first.candidateCount, 2);
assert.equal(first.candidates[0].id, 'center');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.candidates), true);

const right = buildPlayerLockOnCyclePlan(first, 1);
const left = buildPlayerLockOnCyclePlan(first, -1);
assert.equal(right.selectedTargetId, 'left');
assert.equal(left.selectedTargetId, 'left');

const malformed = buildPlayerLockOnTargetPlan({
  facing: { x: NaN, y: Infinity },
  maxCandidates: 'bad',
  candidates: [null, { id: '', distanceMeters: 'nope', angleRadians: Infinity, visibility: NaN, threat: -4, direction: { x: 0, y: 0 }, faction: 'player' }],
});
assert.equal(malformed.selectedTargetId, null);
assert.equal(malformed.hasTarget, false);
assert.equal(malformed.candidates.length, 0);

const evidence = buildPlayerLockOnEvidence(input);
assert.equal(evidence.audit.ok, true);
assert.equal(evidence.cycleRight.version, 1);
assert.equal(typeof JSON.stringify(evidence), 'string');
assert.deepEqual(JSON.parse(JSON.stringify(evidence)), JSON.parse(JSON.stringify(buildPlayerLockOnEvidence(input))));

console.log('checkPlayerLockOnTargetDirector: PASS');
