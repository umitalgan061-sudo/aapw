import assert from 'node:assert/strict';
import { resolvePlayerCombatPhase, isPlayerCombatPhaseFrame } from '../src/3d/gameplay/playerCombatPhaseDirector.ts';

const equipment = {
  mainHand: { id: 'sword', type: 'sword', damage: 12 },
  chest: { id: 'plate', armor: 30 },
};

const light = resolvePlayerCombatPhase({ kind: 'light', equipment, staminaRatio: 1 });
assert.equal(light.accepted, true);
assert.equal(light.kind, 'light');
assert.equal(light.startup + light.active + light.recovery, light.total);
assert.equal(isPlayerCombatPhaseFrame(light), true);

const heavy = resolvePlayerCombatPhase({ kind: 'heavy', equipment, staminaRatio: 1 });
assert.equal(heavy.accepted, true);
assert.ok(heavy.total > light.total);

const exhausted = resolvePlayerCombatPhase({ kind: 'heavy', equipment, staminaRatio: 0 });
assert.equal(exhausted.accepted, false);
assert.equal(exhausted.reason, 'stamina-gated');

const parry = resolvePlayerCombatPhase({ kind: 'parry', equipment, staminaRatio: 1, parryWindowOpen: true });
assert.equal(parry.accepted, true);
assert.ok(parry.active > 0);

const dodge = resolvePlayerCombatPhase({ kind: 'dodge', equipment, staminaRatio: 1, grounded: true });
assert.equal(dodge.accepted, true);
assert.equal(dodge.invulnerable, true);

const ranged = resolvePlayerCombatPhase({
  kind: 'ranged',
  equipment: { mainHand: { id: 'bow', type: 'bow', damage: 8, ranged: true, twoHanded: true } },
  staminaRatio: 1,
});
assert.equal(ranged.accepted, true);
assert.equal(ranged.ranged, true);

const repeat = resolvePlayerCombatPhase({ kind: 'heavy', equipment, staminaRatio: 0.73 });
assert.deepEqual(repeat, resolvePlayerCombatPhase({ kind: 'heavy', equipment, staminaRatio: 0.73 }));

console.log('player-combat-phase-director: ok');
