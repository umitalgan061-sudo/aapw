import assert from 'node:assert/strict';
import { resolvePlayerCombatResourceEnvelope, validatePlayerCombatResourceEnvelope } from '../src/3d/gameplay/playerCombatResourceEnvelope.js';

const profile = {
  mainHand: { id: 'sword', damageMultiplier: 1, reachMultiplier: 1, staminaMultiplier: 1, poiseMultiplier: 1, projectile: false },
  offHand: { id: 'shield', kind: 'shield' },
  shieldEquipped: true,
  ranged: false,
  twoHanded: false,
  armor: { staminaDrainMultiplier: 1, movementMultiplier: 1, poiseBonus: 0, dodgeDistanceMultiplier: 1 },
  effectiveGuardMultiplier: 1,
  sourceIds: { head: 'head', chest: 'chest', back: 'back', mainHand: 'sword', offHand: 'shield' },
};

const light = resolvePlayerCombatResourceEnvelope(profile, { action: 'light', stamina: 100, maxStamina: 100, grounded: true });
assert.equal(light.action, 'light');
assert.equal(light.accepted, true);
assert.equal(light.stamina.spent, light.stamina.cost);
assert.ok(light.stamina.next < light.stamina.current);

const blocked = resolvePlayerCombatResourceEnvelope(profile, { action: 'heavy', stamina: 0, maxStamina: 100, grounded: true });
assert.equal(blocked.accepted, false);
assert.equal(blocked.stamina.spent, 0);

const dodge = resolvePlayerCombatResourceEnvelope(profile, { action: 'dodge', stamina: 100, maxStamina: 100, grounded: true, attackBusy: false, guardBreak: false });
assert.equal(dodge.accepted, true);
assert.equal(dodge.stamina.cost, 28);

const guard = resolvePlayerCombatResourceEnvelope(profile, { action: 'parry', stamina: 100, maxStamina: 100, guardInput: true, parryWindowOpen: true });
assert.equal(guard.accepted, true);

const result = validatePlayerCombatResourceEnvelope(profile, { action: 'light', stamina: 50, maxStamina: 100, deltaSeconds: 0.1 });
assert.equal(result.ok, true);
assert.deepEqual(result.envelope, resolvePlayerCombatResourceEnvelope(profile, { action: 'light', stamina: 50, maxStamina: 100, deltaSeconds: 0.1 }));

console.log('player combat resource envelope: ok');
