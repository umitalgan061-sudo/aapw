#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPlayerCombatPresentationSnapshot, serializePlayerCombatPresentationSnapshot, validatePlayerCombatPresentationSnapshot } from '../src/3d/gameplay/playerCombatPresentationSnapshot.js';

const input = {
  motion: { state: 'attack-heavy', stamina: 40, maxStamina: 100, poise: 75, maxPoise: 100, speedMps: 3.2, isGrounded: true, attackKind: 'heavy', attackPhase: 'active', attackComboStep: 4, attackActive: true, attackRemaining: 0.18, guarding: false, parryWindowRemaining: 0, isDodgeInvulnerable: false, defenseResult: 'none', position: { x: 10, y: 2, z: -4 } },
  equipment: { weaponId: 'viking-sword', armorSetId: 'north-mail', mainHandSocket: 'mixamorigRightHand' },
  target: { id: 'wolf-07', locked: true, distanceMeters: 2.4, facingDot: 0.83 },
  feedback: { outcome: 'hit', serial: 7, intensity: 1.4, cue: 'steel-impact' },
};
const snapshot = createPlayerCombatPresentationSnapshot(input);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.action, 'attack-heavy');
assert.equal(snapshot.attack.comboStep, 3);
assert.equal(snapshot.attack.kind, 'heavy');
assert.equal(snapshot.resources.staminaRatio, 0.4);
assert.equal(snapshot.target.id, 'wolf-07');
assert.equal(snapshot.feedback.cue, 'steel-impact');
assert(Object.isFrozen(snapshot));
assert(Object.isFrozen(snapshot.resources));
assert.equal(validatePlayerCombatPresentationSnapshot(snapshot).valid, true);
assert.deepEqual(JSON.parse(serializePlayerCombatPresentationSnapshot(input)), snapshot);

const malformed = createPlayerCombatPresentationSnapshot({ motion: { state: 'unknown', stamina: NaN, maxStamina: 0, poise: Infinity, attackComboStep: -4, position: { x: 'x' } }, feedback: { outcome: '???' }, target: { id: '' } });
assert.equal(malformed.action, 'idle');
assert.equal(malformed.resources.staminaRatio, 0);
assert.equal(malformed.resources.poiseRatio, 0);
assert.equal(malformed.attack.comboStep, 0);
assert.equal(malformed.target.id, null);
assert.equal(malformed.feedback.outcome, 'none');
assert.equal(validatePlayerCombatPresentationSnapshot(malformed).valid, true);

const fromPlayer = createPlayerCombatPresentationSnapshot({ player: { getMotionState: () => ({ state: 'walk', stamina: 50, maxStamina: 100, poise: 100, maxPoise: 100 }) } });
assert.equal(fromPlayer.action, 'walk');
assert.equal(fromPlayer.resources.staminaRatio, 0.5);
console.log('PLAYER_COMBAT_PRESENTATION_SNAPSHOT_OK');
