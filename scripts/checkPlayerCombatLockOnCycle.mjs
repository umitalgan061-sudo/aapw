import assert from 'node:assert/strict';
import { buildPlayerLockOnCycleCandidates, selectPlayerLockOnCycleTarget, cyclePlayerLockOnTarget } from '../src/3d/gameplay/playerCombatLockOnCycle.js';

const makeEntity = (id, x, z) => ({ id, object3D: { visible: true, position: { x, y: 0, z }, userData: {} } });
const playerPosition = { x: 0, y: 0, z: 0 };
const forward = { x: 0, z: 1 };
const candidates = [makeEntity('left', -2, 8), makeEntity('center', 0, 6), makeEntity('right', 2, 8), makeEntity('far', 0, 40)];

const entries = buildPlayerLockOnCycleCandidates({ playerPosition, forward, candidates });
assert.deepEqual(entries.map((entry) => entry.evaluation.id), ['center', 'left', 'right']);
assert.equal(selectPlayerLockOnCycleTarget(entries, { currentTargetId: 'center', direction: 1 }).targetId, 'left');
assert.equal(selectPlayerLockOnCycleTarget(entries, { currentTargetId: 'center', direction: -1 }).targetId, 'right');
assert.equal(selectPlayerLockOnCycleTarget(entries, { currentTargetId: null, direction: 1 }).targetId, 'center');
assert.equal(selectPlayerLockOnCycleTarget(entries, { currentTargetId: null, direction: -1 }).targetId, 'right');
assert.equal(cyclePlayerLockOnTarget({ playerPosition, forward, candidates, currentTargetId: 'left', direction: 1 }).targetId, 'right');
assert.equal(cyclePlayerLockOnTarget({ playerPosition, forward, candidates, currentTargetId: 'right', direction: 1 }).targetId, 'center');
assert.equal(cyclePlayerLockOnTarget({ playerPosition, forward, candidates: [], direction: 1 }), null);

const reordered = buildPlayerLockOnCycleCandidates({ playerPosition, forward, candidates: [candidates[2], candidates[0], candidates[1]] });
assert.deepEqual(reordered.map((entry) => entry.evaluation.id), ['center', 'left', 'right']);
assert.throws(() => { entries[0].evaluation.score = 1; }, TypeError);
console.log('[checkPlayerCombatLockOnCycle] PASS');
