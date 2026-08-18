import assert from 'node:assert/strict';
import fs from 'node:fs';
import { samplePlayerGamepad } from '../src/3d/input.js';

function makePad({ axes = [0, 0], buttons = {} } = {}) {
	const mapped = Array.from({ length: 12 }, (_, index) => ({ pressed: Boolean(buttons[index]) }));
	return { connected: true, axes, buttons: mapped };
}

const idle = samplePlayerGamepad(makePad());
assert.deepEqual(
	{ forward: idle.forward, strafe: idle.strafe, running: idle.running, guarding: idle.guarding },
	{ forward: 0, strafe: 0, running: false, guarding: false },
	'idle standard gamepad must not create movement or defense input',
);

const deadzone = samplePlayerGamepad(makePad({ axes: [0.12, -0.17] }));
assert.equal(deadzone.forward, 0, 'left-stick Y inside deadzone must remain neutral');
assert.equal(deadzone.strafe, 0, 'left-stick X inside deadzone must remain neutral');

const movement = samplePlayerGamepad(makePad({ axes: [0.59, -0.72], buttons: { 4: true, 10: true } }));
assert.ok(movement.forward > 0.6 && movement.forward <= 1, 'negative browser Y must map to positive Player forward');
assert.ok(movement.strafe > 0.45 && movement.strafe <= 1, 'positive browser X must map to positive Player strafe');
assert.equal(movement.running, true, 'standard left-stick press must feed Player sprint intent');
assert.equal(movement.guarding, true, 'standard LB/L1 must feed Player guard intent');

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

const saturated = samplePlayerGamepad(makePad({ axes: [5, -5] }));
assert.equal(saturated.forward, 1, 'forward axis must clamp to Player contract');
assert.equal(saturated.strafe, 1, 'strafe axis must clamp to Player contract');

const disconnected = samplePlayerGamepad(null, { jump: true, light: true, heavy: true });
assert.deepEqual(disconnected.buttons, { jump: false, light: false, heavy: false }, 'disconnect must clear edge state');
assert.equal(disconnected.forward, 0);
assert.equal(disconnected.strafe, 0);

const source = fs.readFileSync(new URL('../src/3d/input.js', import.meta.url), 'utf8');
for (const contract of [
	"JUMP: 0",
	"LIGHT: 2",
	"HEAVY: 3",
	"GUARD: 4",
	"SPRINT: 10",
	"samplePlayerGamepad(gamepad, this._gamepadButtons)",
	"if (sample.jumpPressed) this._jumpRequested = true",
	"emitPlayerCombatIntent('light', 'gamepad')",
	"emitPlayerCombatIntent('heavy', 'gamepad')",
]) assert.ok(source.includes(contract), `missing shipped gamepad contract: ${contract}`);

assert.ok(!source.includes('gamepad?.buttons?.[0]?.pressed'), 'legacy A-as-light direct polling must stay removed');
console.log('[checkPlayerGamepadInput] PASS: analog movement, sprint, jump, guard and melee edge parity are deterministic.');
