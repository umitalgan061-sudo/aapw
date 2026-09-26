import assert from 'node:assert/strict';
import { derivePlayerCombatPresentationWindow, isPlayerCombatPresentationWindow } from '../src/3d/gameplay/playerCombatPresentationWindow.ts';

const active = derivePlayerCombatPresentationWindow({ revision: 4, phase: 'active', movement: { grounded: true, staminaRatio: 0.8, poiseRatio: 0.7 }, attack: { kind: 'light', comboStep: 2, activeStart: 0.25, activeEnd: 0.55 } });
assert.equal(active.actionable, true);
assert.equal(active.parryable, true);
assert.equal(isPlayerCombatPresentationWindow(active), true);

const airborne = derivePlayerCombatPresentationWindow({ revision: 5, phase: 'active', movement: { grounded: false }, attack: { kind: 'heavy', activeStart: 0.4, activeEnd: 0.2 } });
assert.equal(airborne.activeEnd, 0.4);
assert.equal(airborne.actionable, false);
assert.equal(airborne.parryable, false);

const replay = derivePlayerCombatPresentationWindow({ revision: 4, phase: 'active', movement: { grounded: true, staminaRatio: 0.8, poiseRatio: 0.7 }, attack: { kind: 'light', comboStep: 2, activeStart: 0.25, activeEnd: 0.55 } });
assert.equal(active.key, replay.key);
console.log('player combat presentation window proof: ok');
