#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPlayerCombatFrame, serializePlayerCombatFrame, validatePlayerCombatFrame } from '../src/3d/gameplay/playerCombatFrame.js';

const input = { motion: { state: 'attack-heavy', attackKind: 'heavy', attackActive: true, attackElapsed: 0.36, attackComboStep: 2, stamina: 55, maxStamina: 100, poise: 40, maxPoise: 100, isGrounded: true, position: { x: 1, y: 2, z: 3 } }, equipment: { mainHand: { id: 'longsword' }, chest: { id: 'chain' } }, target: { id: 'wolf-7', locked: true, distanceMeters: 2.2 } };
const frame = createPlayerCombatFrame(input);
assert.equal(frame.version, 1);
assert.equal(frame.attack.kind, 'heavy');
assert.equal(frame.attack.active, true);
assert(frame.attack.progress > 0 && frame.attack.progress < 1);
assert.equal(frame.hitbox.enabled, true);
assert.equal(frame.hurtbox.invulnerable, false);
assert.equal(frame.lockOn.id, 'wolf-7');
assert.equal(validatePlayerCombatFrame(frame).valid, true);
assert.deepEqual(JSON.parse(serializePlayerCombatFrame(input)), frame);
const idle = createPlayerCombatFrame({ motion: { state: 'idle', position: { x: 'bad' } } });
assert.equal(idle.attack.active, false);
assert.equal(idle.hitbox.enabled, false);
assert.equal(idle.hurtbox.origin.x, 0);
console.log('PLAYER_COMBAT_FRAME_OK');
