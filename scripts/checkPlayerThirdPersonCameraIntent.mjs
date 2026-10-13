import assert from 'node:assert/strict';
import { composePlayerThirdPersonCameraIntent, isPlayerThirdPersonCameraIntent } from '../src/3d/gameplay/playerThirdPersonCameraIntent.ts';

const base = { motion: { state: 'idle', isGrounded: true, speedMps: 2.5 }, combat: {}, input: { moveX: 0.4, moveZ: 0.8, shoulder: 'right' }, lockOn: {}, profile: {} };
const idle = composePlayerThirdPersonCameraIntent(base);
assert.equal(idle.mode, 'explore');
assert.equal(isPlayerThirdPersonCameraIntent(idle), true);
assert.equal(idle.lockOn.active, false);

const combat = composePlayerThirdPersonCameraIntent({ ...base, motion: { state: 'attack-light', isGrounded: true, speedMps: 1.2 }, combat: { attackKind: 'light' }, lockOn: { targetId: 'wolf-01' }, profile: { ranged: false } });
assert.equal(combat.mode, 'combat');
assert.equal(combat.lockOn.snapYaw, true);
assert.equal(isPlayerThirdPersonCameraIntent(combat), true);

const dodge = composePlayerThirdPersonCameraIntent({ ...base, motion: { state: 'dodge', isGrounded: true, speedMps: 10 }, lockOn: { targetId: 'wolf-01' } });
assert.equal(dodge.mode, 'dodge');
assert.equal(dodge.lockOn.preserveTargetThroughDodge, true);
assert.equal(isPlayerThirdPersonCameraIntent(dodge), true);

const replay = composePlayerThirdPersonCameraIntent(base);
assert.deepEqual(replay, idle);
assert.throws(() => { idle.lockOn.active = true; }, TypeError);
const tampered = { ...idle, replayKey: 'tampered' };
assert.equal(isPlayerThirdPersonCameraIntent(tampered), false);
console.log('player third-person camera intent proof: PASS');
