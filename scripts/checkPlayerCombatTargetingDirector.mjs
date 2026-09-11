import assert from 'node:assert/strict';
import { selectPlayerCombatTarget } from '../src/3d/gameplay/playerCombatTargetingDirector.js';
const actors = [{ id: 'far', position: { x: 0, z: 12 }, priority: 0 }, { id: 'near', position: { x: 1, z: 5 }, priority: 1 }, { id: 'blocked', position: { x: 12, z: 0 }, priority: 99 }, { id: 'locked', position: { x: -2, z: 7 }, priority: 0 }];
const result = selectPlayerCombatTarget({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors, lockedTargetId: 'locked' });
assert.equal(result.targetId, 'locked'); assert.equal(result.candidateCount, 3); assert.equal(result.candidates.some((candidate) => candidate.id === 'blocked'), false); assert.ok(result.angleRadians < Math.PI * 0.75);
const repeat = selectPlayerCombatTarget({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: [...actors].reverse(), lockedTargetId: null }); assert.equal(repeat.targetId, 'near');
const tie = selectPlayerCombatTarget({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: [{ id: 'zeta', position: { x: -1, z: 5 }, priority: 0 }, { id: 'alpha', position: { x: 1, z: 5 }, priority: 0 }] }); assert.equal(tie.targetId, 'alpha'); assert.equal(selectPlayerCombatTarget({ actors: null }).target, null); console.log('player combat targeting director: PASS');
