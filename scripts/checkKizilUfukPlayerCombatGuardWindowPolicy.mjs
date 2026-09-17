import assert from 'node:assert/strict';
import {
  resolvePlayerCombatGuardWindowPolicy,
  validatePlayerCombatGuardWindowReceipt,
} from '../src/3d/gameplay/playerCombatGuardWindowPolicy.js';

const config = {
  guardWindowMs: 260,
  parryWindowMs: 120,
  guardRecoveryMs: 180,
  parryRecoveryMs: 260,
  guardStaminaCost: 6,
  parryStaminaCost: 10,
  guardPoiseCost: 4,
  parryPoiseCost: 0,
};

const sample = {
  action: 'perfect-guard',
  elapsedMs: 80,
  staminaRatio: 0.75,
  poiseRatio: 1,
  isGrounded: true,
  config,
};

const first = resolvePlayerCombatGuardWindowPolicy(sample);
const second = resolvePlayerCombatGuardWindowPolicy(sample);
assert.deepEqual(first, second, 'guard policy must replay deterministically');
assert.equal(first.outcome, 'parry');
assert.equal(first.reason, 'perfect-window');
assert.equal(first.phase, 'active');
assert.equal(first.ok, true);
assert.equal(validatePlayerCombatGuardWindowReceipt(first), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.timing), true);

const late = resolvePlayerCombatGuardWindowPolicy({ ...sample, elapsedMs: 180 });
assert.equal(late.outcome, 'guard');
assert.equal(late.phase, 'recovery');

const airborne = resolvePlayerCombatGuardWindowPolicy({ ...sample, isGrounded: false });
assert.equal(airborne.outcome, 'rejected');
assert.equal(airborne.reason, 'airborne');

const exhausted = resolvePlayerCombatGuardWindowPolicy({ ...sample, staminaRatio: 0.01 });
assert.equal(exhausted.outcome, 'exhausted');
assert.equal(exhausted.reason, 'stamina');

const defeated = resolvePlayerCombatGuardWindowPolicy({ ...sample, isDefeated: true });
assert.equal(defeated.outcome, 'rejected');
assert.equal(defeated.reason, 'defeated');

const aliases = resolvePlayerCombatGuardWindowPolicy({ ...sample, action: 'block' });
assert.equal(aliases.outcome, 'guard');

console.log(JSON.stringify({
  ok: true,
  contract: 'kizil-ufuk-player-combat-guard-window-policy',
  deterministic: true,
  outcomes: [first.outcome, late.outcome, airborne.outcome, exhausted.outcome, defeated.outcome],
}));
