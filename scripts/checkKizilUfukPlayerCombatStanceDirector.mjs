import assert from 'node:assert/strict';
import { resolvePlayerCombatStance, validatePlayerCombatStance } from '../src/3d/gameplay/playerCombatStanceDirector.js';

const baseline = { equipment: {}, staminaRatio: 1, poiseRatio: 1, grounded: true };
const neutral = resolvePlayerCombatStance(baseline);
assert.equal(neutral.acceptedKind, 'none');
assert.equal(neutral.stance, 'neutral');
assert.equal(validatePlayerCombatStance(neutral).ok, true);

const light = resolvePlayerCombatStance({ ...baseline, attackKind: 'light', comboStep: 2 });
assert.equal(light.acceptedKind, 'light');
assert.equal(light.stance, 'light-attack');
assert(light.staminaCost > 0 && light.staminaCost <= 100);
assert.equal(validatePlayerCombatStance(light).ok, true);

const guarded = resolvePlayerCombatStance({ ...baseline, guardInput: true });
assert.equal(guarded.acceptedKind, 'guard');
assert.equal(guarded.stance, 'guard');

const parry = resolvePlayerCombatStance({ ...baseline, guardInput: true, parryWindowOpen: true });
assert.equal(parry.acceptedKind, 'parry');
assert.equal(parry.stance, 'parry');

const dodge = resolvePlayerCombatStance({ ...baseline, dodgeInput: true, attackKind: 'heavy' });
assert.equal(dodge.acceptedKind, 'dodge');
assert.equal(dodge.stance, 'evade');
assert.equal(dodge.staminaCost, 28);

const exhausted = resolvePlayerCombatStance({ ...baseline, attackKind: 'heavy', staminaRatio: 0 });
assert.equal(exhausted.acceptedKind, 'none');
assert.equal(exhausted.staminaCost, 0);

const ranged = resolvePlayerCombatStance({ ...baseline, attackKind: 'archery', lockOn: true, moving: false });
assert.equal(ranged.acceptedKind, 'ranged');
assert.equal(ranged.stance, 'ranged-aim');

const repeatA = resolvePlayerCombatStance({ ...baseline, attackKind: 'light', comboStep: 1 });
const repeatB = resolvePlayerCombatStance({ ...baseline, attackKind: 'light', comboStep: 1 });
assert.deepEqual(repeatA, repeatB);
assert(Object.isFrozen(repeatA));
assert(Object.isFrozen(repeatA.ownership));

console.log('KIZIL_UFUK_PLAYER_COMBAT_STANCE_DIRECTOR_OK');
