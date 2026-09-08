import assert from 'node:assert/strict';
import {
  applyCombatResourceDelta,
  createCombatResourceSnapshot,
  getCombatResourceFlags,
  resolveDodgeStaminaCost,
  resolveGuardResourceCost,
} from '../src/3d/gameplay/playerCombatResourcePolicy.js';

const initial = createCombatResourceSnapshot({ stamina: 80, health: 90, poise: 40 });
assert.deepEqual(initial, {
  stamina: 80,
  health: 90,
  poise: 40,
  flags: { exhausted: false, defeated: false, staggered: false },
});

const resolved = applyCombatResourceDelta(initial, {
  staminaCost: 15,
  healthDamage: 25,
  poiseDamage: 55,
});
assert.deepEqual(resolved, {
  stamina: 65,
  health: 65,
  poise: 0,
  flags: { exhausted: false, defeated: false, staggered: true },
});

assert.equal(resolveGuardResourceCost({ baseCost: 4, damage: 20, poise: 10, guardMultiplier: 1 }), 29);
assert.equal(resolveDodgeStaminaCost({ baseCost: 10, intensity: 2, encumbrance: 0.5 }), 17.5);
assert.deepEqual(getCombatResourceFlags({ stamina: -5, health: 0, poise: 10 }), {
  exhausted: true,
  defeated: true,
  staggered: false,
});

const repeatA = applyCombatResourceDelta(initial, { staminaCost: 15, healthDamage: 25, poiseDamage: 55 });
const repeatB = applyCombatResourceDelta(initial, { staminaCost: 15, healthDamage: 25, poiseDamage: 55 });
assert.deepEqual(repeatA, repeatB);

console.log('player combat resource policy: ok');
