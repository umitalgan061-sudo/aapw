import assert from 'node:assert/strict';
import { createPlayerCombatIntentFrame, resolvePlayerCombatIntent, serializePlayerCombatIntentFrame } from '../src/3d/gameplay/playerCombatIntentArbitration.js';

const simultaneous = resolvePlayerCombatIntent({ heavyPressed: true, lightPressed: true, dodgePressed: true, source: 'gamepad' }, { stamina: 100 });
assert.equal(simultaneous.intent, 'dodge');
assert.equal(simultaneous.accepted, true);
assert.equal(simultaneous.comboEligible, false);

const parryWins = resolvePlayerCombatIntent({ parryPressed: true, heavyPressed: true }, { stamina: 100 });
assert.equal(parryWins.intent, 'parry');
assert.equal(parryWins.staminaCost, 8);

const heavyWinsAttack = resolvePlayerCombatIntent({ heavyPressed: true, lightPressed: true }, { stamina: 100 });
assert.equal(heavyWinsAttack.intent, 'heavy');
assert.equal(heavyWinsAttack.comboEligible, true);

const lowStamina = resolvePlayerCombatIntent({ heavyPressed: true }, { stamina: 5 });
assert.equal(lowStamina.accepted, false);
assert.equal(lowStamina.rejectedReason, 'stamina');

const recovery = resolvePlayerCombatIntent({ dodgePressed: true }, { stamina: 100, inRecovery: true });
assert.equal(recovery.accepted, false);
assert.equal(recovery.rejectedReason, 'recovery');

const frame = createPlayerCombatIntentFrame({ lightPressed: true, magnitude: 2, lookX: 0.33333, source: 'touch', running: true }, { stamina: 100 });
assert.equal(frame.intent, 'light');
assert.equal(frame.movementMagnitude, 1);
assert.equal(frame.source, 'touch');
assert.equal(frame.running, true);
assert.equal(serializePlayerCombatIntentFrame(frame), serializePlayerCombatIntentFrame(frame));

console.log('Player combat intent arbitration contract: PASS');
