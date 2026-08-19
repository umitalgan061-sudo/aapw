import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	applyGamepadRadialDeadzone,
	samplePlayerGamepad,
	selectPlayerGamepad,
} from '../src/3d/input.js';

function makePad({ index = 0, mapping = 'standard', axes = [0, 0], buttons = {}, connected = true } = {}) {
	const mapped = Array.from({ length: 12 }, (_, buttonIndex) => ({ pressed: Boolean(buttons[buttonIndex]) }));
	return { index, mapping, connected, axes, buttons: mapped };
}

const idle = samplePlayerGamepad(makePad());
assert.deepEqual(
	{ forward: idle.forward, strafe: idle.strafe, magnitude: idle.magnitude, lookX: idle.lookX, lookY: idle.lookY, running: idle.running, guarding: idle.guarding },
	{ forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0, running: false, guarding: false },
	'idle Standard Gamepad must not create movement, camera or defense input',
);
assert.equal(Object.is(idle.forward, -0), false, 'idle forward axis must be canonical +0');

for (const [x, y] of [[0.08, -0.12], [0.17, 0], [0, -0.18]]) {
	assert.ok(Math.hypot(x, y) <= 0.18, 'neutral fixture must remain inside the radial deadzone');
	const sample = samplePlayerGamepad(makePad({ axes: [x, y] }));
	assert.equal(sample.forward, 0, 'radial stick input inside deadzone must remain neutral');
	assert.equal(sample.strafe, 0, 'radial stick input inside deadzone must remain neutral');
	assert.equal(sample.magnitude, 0, 'radial stick magnitude inside deadzone must remain zero');
}

const componentSmallDiagonal = samplePlayerGamepad(makePad({ axes: [0.12, -0.17] }));
assert.ok(Math.hypot(0.12, -0.17) > 0.18, 'diagonal fixture must be outside the radial deadzone by vector magnitude');
assert.ok(componentSmallDiagonal.magnitude > 0, 'radial deadzone must not suppress a diagonal vector whose magnitude exceeds the threshold');
assert.ok(componentSmallDiagonal.forward > 0 && componentSmallDiagonal.strafe > 0, 'radial deadzone must preserve the diagonal movement direction');

const diagonal = applyGamepadRadialDeadzone(0.7, -0.7);
assert.ok(diagonal.magnitude <= 1, 'radial deadzone output magnitude must not exceed one');
assert.ok(Math.abs(Math.abs(diagonal.x) - Math.abs(diagonal.y)) < 1e-9, 'radial deadzone must preserve diagonal direction');
assert.ok(Math.hypot(diagonal.x, diagonal.y) <= 1.000000001, 'diagonal analog movement must not gain extra speed');

const movement = samplePlayerGamepad(makePad({ axes: [0.59, -0.72], buttons: { 4: true, 10: true } }));
assert.ok(movement.forward > 0.55 && movement.forward <= 1, 'negative browser Y must map to positive Player forward');
assert.ok(movement.strafe > 0.4 && movement.strafe <= 1, 'positive browser X must map to positive Player strafe');
assert.ok(movement.magnitude > 0.6 && movement.magnitude <= 1, 'stick magnitude must remain analog after deadzone');
assert.equal(movement.running, true, 'standard left-stick press must feed Player sprint intent');
assert.equal(movement.guarding, true, 'standard LB/L1 must feed Player guard intent');

const camera = samplePlayerGamepad(makePad({ axes: [0, 0, 0.72, -0.59] }));
assert.ok(camera.lookX > 0.6 && camera.lookX <= 1, 'standard right-stick X must feed camera yaw');
assert.ok(camera.lookY < -0.45 && camera.lookY >= -1, 'standard right-stick Y must feed camera pitch');
assert.ok(camera.lookMagnitude > 0.6 && camera.lookMagnitude <= 1, 'right-stick camera magnitude must remain radial and bounded');
assert.equal(camera.forward, 0, 'right stick must not leak into player movement');
assert.equal(camera.strafe, 0, 'right stick must not leak into player movement');

const firstActions = samplePlayerGamepad(makePad({ buttons: { 0: true, 2: true, 3: true } }), { jump: false, light: false, heavy: false });
assert.equal(firstActions.jumpPressed, true, 'standard A/bottom-face must edge-trigger jump');
assert.equal(firstActions.lightPressed, true, 'standard X/left-face must edge-trigger light attack');
assert.equal(firstActions.heavyPressed, true, 'standard Y/top-face must edge-trigger heavy attack');

const heldActions = samplePlayerGamepad(makePad({ buttons: { 0: true, 2: true, 3: true } }), firstActions.buttons);
assert.equal(heldActions.jumpPressed, false, 'held jump must not retrigger every poll');
assert.equal(heldActions.lightPressed, false, 'held light attack must not retrigger every poll');
assert.equal(heldActions.heavyPressed, false, 'held heavy attack must not retrigger every poll');

const released = samplePlayerGamepad(makePad(), heldActions.buttons);
const pressedAgain = samplePlayerGamepad(makePad({ buttons: { 2: true } }), released.buttons);
assert.equal(pressedAgain.lightPressed, true, 'attack must retrigger after a real release edge');

const saturated = samplePlayerGamepad(makePad({ axes: [5, -5, 5, -5] }));
assert.ok(Math.hypot(saturated.strafe, saturated.forward) <= 1.000000001, 'saturated diagonal left stick must remain unit-bounded');
assert.ok(Math.hypot(saturated.lookX, saturated.lookY) <= 1.000000001, 'saturated diagonal right stick must remain unit-bounded');

const disconnected = samplePlayerGamepad(null, { jump: true, light: true, heavy: true });
assert.deepEqual(disconnected.buttons, { jump: false, light: false, heavy: false }, 'disconnect must clear edge state');
assert.equal(disconnected.forward, 0);
assert.equal(disconnected.strafe, 0);
assert.equal(disconnected.lookX, 0);
assert.equal(disconnected.lookY, 0);

const pads = [
	makePad({ index: 3, mapping: '', axes: [0, -1] }),
	makePad({ index: 2, mapping: 'standard', axes: [0, -1] }),
	makePad({ index: 1, mapping: 'standard', axes: [0, -1] }),
];
assert.equal(selectPlayerGamepad(pads)?.index, 1, 'initial selection must prefer lowest-index Standard Gamepad');
assert.equal(selectPlayerGamepad(pads, 2)?.index, 2, 'connected preferred controller must stay sticky');
assert.equal(selectPlayerGamepad([pads[0], { ...pads[1], connected: false }, pads[2]], 2)?.index, 1, 'disconnect must fall back deterministically');
assert.equal(selectPlayerGamepad([pads[0]], 2)?.index, 3, 'non-standard pad may be fallback when no Standard pad remains');
assert.equal(selectPlayerGamepad([], 2), null, 'no connected controller must return null');

const source = fs.readFileSync(new URL('../src/3d/input.js', import.meta.url), 'utf8');
for (const contract of [
	"JUMP: 0", "LIGHT: 2", "HEAVY: 3", "GUARD: 4", "SPRINT: 10",
	"gamepad.axes?.[2]", "gamepad.axes?.[3]", "lookDeltaSeconds",
	"applyGamepadRadialDeadzone", "selectPlayerGamepad", "this._activeGamepadIndex",
	"emitPlayerCombatIntent('light', 'gamepad')", "emitPlayerCombatIntent('heavy', 'gamepad')", "'aapw:player-input-device'",
]) assert.ok(source.includes(contract), `missing shipped gamepad contract: ${contract}`);

const movementSource = fs.readFileSync(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');
for (const contract of [
	'const inputMagnitude = Math.min(1, Math.hypot(axes.forward, axes.strafe))',
	'_move.normalize().multiplyScalar(inputMagnitude)',
	'export function applyGamepadCameraLook(camera, controls, axes)',
	'GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND',
	'GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND',
	'computeCameraRelativeMove(camera, controls, axes)',
]) assert.ok(movementSource.includes(contract), `missing camera-relative gamepad contract: ${contract}`);

assert.ok(!source.includes('gamepad?.buttons?.[0]?.pressed'), 'legacy A-as-light direct polling must stay removed');
console.log('[checkPlayerGamepadInput] PASS: dual-stick radial analog, camera orbit, deterministic selection, sprint/guard and combat edge parity are bounded.');
