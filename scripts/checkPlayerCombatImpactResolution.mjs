import assert from 'node:assert/strict';
import { isPlayerCombatImpactResolution, resolvePlayerCombatImpactResolution } from '../src/3d/gameplay/playerCombatImpactResolution.ts';

const profile = {
  mainHand: { id: 'sword', damageMultiplier: 1.2, poiseMultiplier: 1, reachMultiplier: 1 },
  armor: { staminaDrainMultiplier: 1, poiseBonus: 0, dodgeDistanceMultiplier: 1, movementMultiplier: 1 },
  shieldEquipped: false,
  ranged: false,
  twoHanded: false,
  effectiveGuardMultiplier: 0.5,
};

const hit = resolvePlayerCombatImpactResolution(profile, {
  kind: 'heavy',
  staminaRatio: 0.9,
  target: { alive: true, inRange: true, inArc: true, guarding: false, poise: 10, maxPoise: 100 },
});
assert.equal(hit.outcome, 'hit');
assert.equal(hit.contact, true);
assert.equal(isPlayerCombatImpactResolution(hit), true);
assert.equal(Object.isFrozen(hit), true);

const blocked = resolvePlayerCombatImpactResolution(profile, {
  kind: 'light',
  target: { alive: true, inRange: true, inArc: true, guarding: true },
});
assert.equal(blocked.outcome, 'blocked');

const miss = resolvePlayerCombatImpactResolution(profile, {
  kind: 'light',
  target: { alive: true, inRange: false, inArc: true },
});
assert.equal(miss.outcome, 'miss');

const parried = resolvePlayerCombatImpactResolution(profile, {
  kind: 'light',
  guardInput: true,
  parryWindowOpen: true,
  incoming: { parryable: true, rawAmount: 20 },
  target: { alive: true, inRange: true, inArc: true },
});
assert.equal(parried.outcome, 'parried');

const replay = resolvePlayerCombatImpactResolution(profile, {
  kind: 'heavy',
  staminaRatio: 0.9,
  target: { alive: true, inRange: true, inArc: true },
});
assert.deepEqual(replay, resolvePlayerCombatImpactResolution(profile, {
  kind: 'heavy',
  staminaRatio: 0.9,
  target: { alive: true, inRange: true, inArc: true },
}));

const tampered = { ...hit, impactKey: 'tampered' };
assert.equal(isPlayerCombatImpactResolution(tampered), false);
console.log('player combat impact resolution proof: PASS');
