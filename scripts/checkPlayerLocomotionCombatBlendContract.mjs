import assert from 'node:assert/strict';
import { resolvePlayerLocomotionCombatBlend, validatePlayerLocomotionCombatBlend } from '../src/3d/gameplay/playerLocomotionCombatBlendContract.js';

const active = resolvePlayerLocomotionCombatBlend({ state: 'attack-heavy', speedMps: 4.2, grounded: true, attackKind: 'heavy' });
assert.equal(active.priority, 'attack-heavy');
assert.equal(active.combat.attackHeavy, 1);
assert.equal(active.locomotion.blend, 0);
assert.equal(validatePlayerLocomotionCombatBlend(active), true);
assert.equal(Object.isFrozen(active), true);
assert.equal(Object.isFrozen(active.combat), true);

const malformed = resolvePlayerLocomotionCombatBlend({ state: 'unknown', speedMps: Number.NaN, grounded: false, guardHeld: true });
assert.equal(malformed.state, 'idle');
assert.equal(malformed.speedMps, 0);
assert.equal(malformed.priority, 'guard');
assert.equal(validatePlayerLocomotionCombatBlend(malformed), true);

const a = resolvePlayerLocomotionCombatBlend({ speedMps: 3, state: 'walk', grounded: true });
const b = resolvePlayerLocomotionCombatBlend({ grounded: true, state: 'walk', speedMps: 3 });
assert.deepEqual(a, b);
console.log('player locomotion combat blend contract: PASS');
