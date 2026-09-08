import assert from 'node:assert/strict';
import {
  COMBAT_ACTIONS,
  buildCombatHitbox,
  createPlayerCombatState,
  normalizeCombatInput,
  resolveCombatIntent,
  resolveIncomingHit,
  resolveLockOn,
} from '../src/3d/gameplay/playerCombatResolutionDirector.js';

const base = createPlayerCombatState();
const attack = resolveCombatIntent(base, { action: COMBAT_ACTIONS.LIGHT }, 0);
assert.equal(attack.action, 'light');
assert.equal(attack.comboIndex, 1);
assert.equal(attack.stamina, 86);

const combo = resolveCombatIntent(attack, { action: COMBAT_ACTIONS.LIGHT }, 0.4);
assert.equal(combo.comboIndex, 2);

const block = resolveCombatIntent(base, { action: COMBAT_ACTIONS.BLOCK, guardHeld: true }, 1);
const parried = resolveIncomingHit(block, { damage: 40, poiseDamage: 30 }, 1.1);
assert.equal(parried.result.kind, 'parried');
assert.equal(parried.state.health, 100);

const blocked = resolveIncomingHit(block, { damage: 40, poiseDamage: 30 }, 1.4);
assert.equal(blocked.result.kind, 'blocked');
assert.ok(blocked.result.damageApplied < 40);

const dodge = resolveCombatIntent(base, { action: COMBAT_ACTIONS.DODGE }, 2);
const dodged = resolveIncomingHit(dodge, { damage: 999 }, 2.1);
assert.equal(dodged.result.kind, 'dodged');
assert.equal(dodged.state.health, 100);

const hit = resolveIncomingHit(base, { damage: 20, poiseDamage: 100 }, 0);
assert.equal(hit.result.kind, 'hit');
assert.equal(hit.state.health, 80);
assert.equal(hit.result.staggered, true);

const hitbox = buildCombatHitbox({ action: COMBAT_ACTIONS.HEAVY, comboIndex: 4, weaponReach: 2 });
assert.equal(hitbox.comboIndex, 3);
assert.equal(hitbox.arcDegrees, 110);
assert.ok(hitbox.damageMultiplier > 1);

assert.equal(resolveLockOn(null, [{ id: 'b', distance: 4 }, { id: 'a', distance: 4 }]), 'a');
assert.equal(resolveLockOn('b', [{ id: 'b', distance: 4 }, { id: 'a', distance: 4 }]), 'b');
assert.equal(resolveLockOn('missing', [{ id: 'b', distance: 20 }], 18), null);

assert.deepEqual(normalizeCombatInput({ primary: true, gamepadLeftBumper: true, touchDodge: true }), {
  light: true, heavy: false, block: true, dodge: true, lockOn: false,
});

console.log('PLAYER_COMBAT_RESOLUTION_DIRECTOR_PASS');
