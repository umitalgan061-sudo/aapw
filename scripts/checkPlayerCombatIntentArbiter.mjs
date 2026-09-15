import assert from 'node:assert/strict';
import {
  arbitratePlayerCombatIntent,
  validatePlayerCombatIntentDecision,
} from '../src/3d/gameplay/playerCombatIntentArbiter.js';

const decision = arbitratePlayerCombatIntent({
  phase: 'idle',
  stamina: 20,
  parryWindow: 0.08,
  dodgeCooldown: 0,
  maxChoices: 2,
  intents: [
    { action: 'lightAttack', serial: 1, pressedAt: 2 },
    { action: 'heavyAttack', serial: 2, pressedAt: 1, staminaCost: 24 },
    { action: 'dodge', serial: 3, pressedAt: 3, staminaCost: 18 },
    { action: 'parry', serial: 4, pressedAt: 4 },
    { action: 'guard', serial: 5, pressedAt: 5 },
  ],
});
assert.equal(decision.selected[0].action, 'parry');
assert.equal(decision.selected[1].action, 'dodge');
assert.equal(decision.selected.length, 2);
assert.equal(decision.reason, 'priority-and-gates');
assert.equal(validatePlayerCombatIntentDecision(decision), true);

const blocked = arbitratePlayerCombatIntent({
  phase: 'attack-active',
  stamina: 100,
  parryWindow: 0,
  dodgeCooldown: 0.2,
  intents: [{ action: 'heavy' }, { action: 'light' }, { action: 'parry' }],
});
assert.equal(blocked.selected.length, 0);
assert.equal(blocked.reason, 'no-safe-intent');
assert.equal(validatePlayerCombatIntentDecision(blocked), true);

const deterministicA = arbitratePlayerCombatIntent({
  phase: 'idle', stamina: 50, intents: [{ action: 'light', pressedAt: 3 }, { action: 'heavy', pressedAt: 3, staminaCost: 40 }],
});
const deterministicB = arbitratePlayerCombatIntent({
  phase: 'idle', stamina: 50, intents: [{ action: 'light', pressedAt: 3 }, { action: 'heavy', pressedAt: 3, staminaCost: 40 }],
});
assert.deepEqual(deterministicA, deterministicB);
console.log('PLAYER_COMBAT_INTENT_ARBITER_OK');
