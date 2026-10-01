import assert from 'node:assert/strict';
import { resolvePlayerCombatContactPlan, isPlayerCombatContactPlan } from '../src/3d/gameplay/playerCombatContactPlan.ts';

const stable = resolvePlayerCombatContactPlan({ kind: 'light', grounded: true, groundConfidence: 0.92, groundY: 4, visualY: 4.01, colliderY: 4.02 });
assert.equal(stable.status, 'stable');
assert.equal(stable.parity.safe, true);
assert.equal(isPlayerCombatContactPlan(stable), true);
assert.equal(Object.isFrozen(stable), true);
assert.equal(Object.isFrozen(stable.boxes), true);

const unsafe = resolvePlayerCombatContactPlan({ kind: 'heavy', grounded: true, groundConfidence: 0.95, groundY: 2, visualY: 2.06, colliderY: 2.01 });
assert.equal(unsafe.status, 'unsafe');
assert.equal(unsafe.parity.safe, false);

const airborne = resolvePlayerCombatContactPlan({ grounded: false, groundConfidence: 1, groundY: 0, visualY: 1, colliderY: 1 });
assert.equal(airborne.status, 'airborne');
assert.equal(airborne.contactWeight, 0);

const reordered = resolvePlayerCombatContactPlan({ kind: 'light', grounded: true, groundConfidence: 0.92, groundY: 4, visualY: 4.01, colliderY: 4.02 });
assert.equal(reordered.key, stable.key);

assert.throws(() => { stable.key = 'tampered'; }, TypeError);
const tampered = { ...stable, key: 'tampered' };
assert.equal(isPlayerCombatContactPlan(tampered), false);
console.log('PLAYER_COMBAT_CONTACT_PLAN_OK');
