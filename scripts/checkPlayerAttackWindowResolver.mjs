import assert from 'node:assert/strict';
import { resolvePlayerAttackWindow, validatePlayerAttackWindowEvidence } from '../src/3d/gameplay/playerAttackWindowResolver.js';

const active = resolvePlayerAttackWindow({ phase: 'active', kind: 'heavy', comboStep: 2, active: true, reachMeters: 2.05, damageScale: 1.65, commitRemainingMeters: 0.4, facing: { x: 3, z: 4 } });
assert.equal(active.accepted, true);
assert.deepEqual(active.facing, { x: 0.6, z: 0.8 });
assert.equal(active.commitRemainingMeters, 0.4);
assert.equal(validatePlayerAttackWindowEvidence(active), true);
assert.equal(Object.isFrozen(active), true);
assert.equal(Object.isFrozen(active.facing), true);

const inactive = resolvePlayerAttackWindow({ phase: 'start', kind: 'light', active: true, reachMeters: 1.65, damageScale: 1 });
assert.equal(inactive.accepted, false);

const malformed = resolvePlayerAttackWindow({ phase: 'active', kind: 'heavy', active: true, reachMeters: Infinity, damageScale: 'bad', commitRemainingMeters: 9, facing: { x: NaN, z: 0 } });
assert.equal(malformed.reachMeters, 0);
assert.equal(malformed.damageScale, 0);
assert.equal(malformed.accepted, false);
assert.deepEqual(malformed.facing, { x: 0, z: 1 });

const first = JSON.stringify(resolvePlayerAttackWindow({ kind: 'light', phase: 'active', active: true, reachMeters: 1, damageScale: 1, facing: { z: 1, x: 0 } }));
const second = JSON.stringify(resolvePlayerAttackWindow({ facing: { x: 0, z: 1 }, damageScale: 1, reachMeters: 1, active: true, phase: 'active', kind: 'light' }));
assert.equal(first, second);

console.log('player attack window resolver: PASS');
