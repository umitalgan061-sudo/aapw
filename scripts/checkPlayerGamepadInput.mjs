import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KeyboardInput, applyGamepadRadialDeadzone, applyGamepadTriggerDeadzone, pulsePlayerGamepadAction, pulsePlayerGamepadCombatFeedback, pulsePlayerGamepadMelee, resolveGamepadSprintIntent, resolvePlayerCombatFeedbackHaptic, samplePlayerGamepad, selectPlayerGamepad } from '../src/3d/input.js';
function makePad({ index = 0, mapping = 'standard', axes = [0, 0], buttons = {}, values = {}, connected = true } = {}) {
	return { index, mapping, connected, axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: Boolean(buttons[i]) || Number(values[i] ?? 0) > 0.5, value: Number(values[i] ?? (buttons[i] ? 1 : 0)) })) };
}
const idle = samplePlayerGamepad(makePad());
assert.deepEqual({ forward: idle.forward, strafe: idle.strafe, lookX: idle.lookX, lookY: idle.lookY, cameraZoom: idle.cameraZoom, running: idle.running, guarding: idle.guarding, dodgePressed: idle.dodgePressed, parryPressed: idle.parryPressed }, { forward: 0, strafe: 0, lookX: 0, lookY: 0, cameraZoom: 0, running: false, guarding: false, dodgePressed: false, parryPressed: false });
for (const [x, y] of [[0.08, -0.12], [0.17, 0], [0, -0.18]]) { const s = samplePlayerGamepad(makePad({ axes: [x, y] })); assert.equal(s.magnitude, 0); }
const smallDiag = samplePlayerGamepad(makePad({ axes: [0.12, -0.17] })); assert.ok(smallDiag.magnitude > 0 && smallDiag.forward > 0 && smallDiag.strafe > 0);
const diagonal = applyGamepadRadialDeadzone(0.7, -0.7); assert.ok(diagonal.magnitude <= 1 && Math.hypot(diagonal.x, diagonal.y) <= 1.000000001);
const movement = samplePlayerGamepad(makePad({ axes: [0.59, -0.72], buttons: { 4: true, 10: true } })); assert.ok(movement.forward > 0.55 && movement.strafe > 0.4 && movement.magnitude > 0.6); assert.equal(movement.running, true); assert.equal(movement.guarding, true);
const driftSprint = samplePlayerGamepad(makePad({ axes: [0, -0.35], buttons: { 10: true } })); assert.ok(driftSprint.magnitude > 0 && driftSprint.magnitude < 0.3, 'fixture must remain live movement above deadzone'); assert.equal(driftSprint.running, false, 'L3 plus weak/drifting stick must not request stamina sprint');
const deliberateSprint = samplePlayerGamepad(makePad({ axes: [0, -0.85], buttons: { 10: true } })); assert.ok(deliberateSprint.magnitude > 0.72); assert.equal(deliberateSprint.running, true, 'L3 plus deliberate analog travel must request sprint');
assert.equal(resolveGamepadSprintIntent(0.71, true, false), false, 'fresh sprint must not start below activation threshold');
assert.equal(resolveGamepadSprintIntent(0.72, true, false), true, 'fresh sprint must start at activation threshold');
assert.equal(resolveGamepadSprintIntent(0.65, true, true), true, 'active sprint must survive bounded threshold noise');
assert.equal(resolveGamepadSprintIntent(0.54, true, true), false, 'active sprint must release below hysteresis floor');
assert.equal(resolveGamepadSprintIntent(1, false, true), false, 'releasing L3 must end sprint immediately');
const hysteresisPad = makePad({ axes: [0, -0.72], buttons: { 10: true } }); const hysteresisSample = samplePlayerGamepad(hysteresisPad, {}, true); assert.equal(hysteresisSample.running, true, 'sampler must carry previous sprint state into release threshold');
const dpadSprint = samplePlayerGamepad(makePad({ buttons: { 10: true, 12: true } })); assert.equal(dpadSprint.magnitude, 1); assert.equal(dpadSprint.running, true, 'digital D-pad movement must retain sprint parity');
const dpadForward = samplePlayerGamepad(makePad({ buttons: { 12: true } })); assert.equal(dpadForward.forward, 1); assert.equal(dpadForward.strafe, 0); assert.equal(dpadForward.magnitude, 1);
const dpadDiagonal = samplePlayerGamepad(makePad({ buttons: { 12: true, 15: true } })); assert.ok(Math.abs(dpadDiagonal.forward - Math.SQRT1_2) < 1e-9); assert.ok(Math.abs(dpadDiagonal.strafe - Math.SQRT1_2) < 1e-9); assert.equal(dpadDiagonal.magnitude, 1); assert.ok(Math.hypot(dpadDiagonal.forward, dpadDiagonal.strafe) <= 1.000000001);
const analogWins = samplePlayerGamepad(makePad({ axes: [-0.5, 0], buttons: { 15: true } })); assert.ok(analogWins.strafe < 0, 'live analog stick must take precedence over opposing D-pad input');
assert.equal(applyGamepadTriggerDeadzone(0.05), 0, 'small trigger drift must be neutral'); assert.equal(applyGamepadTriggerDeadzone(0.08), 0); assert.equal(applyGamepadTriggerDeadzone(1), 1); assert.ok(applyGamepadTriggerDeadzone(0.5) > 0.45 && applyGamepadTriggerDeadzone(0.5) < 0.46);
const triggerDrift = samplePlayerGamepad(makePad({ values: { 6: 0.04, 7: 0.06 } })); assert.equal(triggerDrift.cameraZoom, 0, 'unequal sub-deadzone trigger noise must not move camera');
const camera = samplePlayerGamepad(makePad({ axes: [0, 0, 0.72, -0.59], values: { 6: 0.2, 7: 0.7 } })); assert.ok(camera.lookX > 0.6 && camera.lookY < -0.45); assert.ok(camera.cameraZoom > 0.54 && camera.cameraZoom < 0.55); assert.equal(camera.forward, 0); assert.equal(camera.strafe, 0);
const zoomOut = samplePlayerGamepad(makePad({ values: { 6: 1, 7: 0.25 } })).cameraZoom; assert.ok(zoomOut < -0.81 && zoomOut > -0.82);
const first = samplePlayerGamepad(makePad({ buttons: { 0: true, 1: true, 2: true, 3: true, 5: true } }), { jump: false, dodge: false, light: false, heavy: false, parry: false }); assert.equal(first.jumpPressed, true); assert.equal(first.dodgePressed, true); assert.equal(first.lightPressed, true); assert.equal(first.heavyPressed, true); assert.equal(first.parryPressed, true);
const held = samplePlayerGamepad(makePad({ buttons: { 0: true, 1: true, 2: true, 3: true, 5: true } }), first.buttons); assert.equal(held.jumpPressed, false); assert.equal(held.dodgePressed, false); assert.equal(held.lightPressed, false); assert.equal(held.heavyPressed, false); assert.equal(held.parryPressed, false);
const released = samplePlayerGamepad(makePad(), held.buttons); const dodgeAgain = samplePlayerGamepad(makePad({ axes: [0, -1], buttons: { 1: true } }), released.buttons); assert.equal(dodgeAgain.dodgePressed, true); assert.ok(dodgeAgain.magnitude > 0.99); const parryAgain = samplePlayerGamepad(makePad({ buttons: { 5: true } }), released.buttons); assert.equal(parryAgain.parryPressed, true);
const calls = []; const hapticPad = { ...makePad(), vibrationActuator: { playEffect: (type, options) => { calls.push({ type, options }); return Promise.resolve(); } } };
assert.equal(pulsePlayerGamepadAction(hapticPad, 'dodge'), true);
assert.equal(pulsePlayerGamepadAction(hapticPad, 'parry'), true);
assert.equal(pulsePlayerGamepadMelee(hapticPad, 'light'), true);
assert.equal(pulsePlayerGamepadMelee(hapticPad, 'heavy'), true);
assert.equal(calls.length, 4); assert.ok(calls.every((call) => call.type === 'dual-rumble'));
assert.ok(calls[0].options.duration < calls[2].options.duration, 'dodge feedback must stay shorter than light melee');
assert.ok(calls[1].options.duration < calls[0].options.duration, 'parry intent must remain a crisp pulse');
assert.ok(calls[1].options.strongMagnitude > calls[0].options.strongMagnitude, 'parry intent must be sharper than dodge feedback');
assert.ok(calls[3].options.strongMagnitude > calls[2].options.strongMagnitude, 'heavy melee must remain stronger than light melee');
for (const call of calls) { assert.equal(call.options.startDelay, 0); assert.ok(call.options.duration > 0 && call.options.duration <= 100); assert.ok(call.options.weakMagnitude >= 0 && call.options.weakMagnitude <= 1); assert.ok(call.options.strongMagnitude >= 0 && call.options.strongMagnitude <= 1); }
assert.equal(pulsePlayerGamepadAction(hapticPad, 'unknown'), false); assert.equal(pulsePlayerGamepadAction({ ...hapticPad, mapping: '' }, 'parry'), false);
const feedbackCases = [
	['dodge', { blockedAmount: 12 }, 34],
	['parry', { blockedAmount: 12 }, 72],
	['guard', { blockedAmount: 7.2 }, 54],
	['guard-break', { appliedAmount: 4.8 }, 135],
	['hit', { appliedAmount: 12 }, 78],
	['hit-stagger', { appliedAmount: 12 }, 128],
];
for (const [outcome, evidence, duration] of feedbackCases) {
	const profile = resolvePlayerCombatFeedbackHaptic({ outcome, ...evidence });
	assert.ok(profile, `${outcome} authoritative feedback must resolve a haptic profile`);
	assert.equal(profile.duration, duration, `${outcome} haptic duration must stay intentional`);
	const before = calls.length;
	assert.equal(pulsePlayerGamepadCombatFeedback(hapticPad, { outcome, ...evidence }), true);
	assert.equal(calls.length, before + 1);
	assert.equal(calls.at(-1).type, 'dual-rumble');
	assert.equal(calls.at(-1).options.duration, duration);
}
for (const feedback of [
	{ outcome: 'dodge', blockedAmount: 0 },
	{ outcome: 'parry', blockedAmount: NaN },
	{ outcome: 'guard', blockedAmount: Infinity },
	{ outcome: 'hit', appliedAmount: 0 },
	{ outcome: 'hit-stagger', appliedAmount: -1 },
	{ outcome: 'guard-break', appliedAmount: 0, blockedAmount: 0 },
	{ outcome: 'unknown', appliedAmount: 10 },
	{ outcome: new String('hit'), appliedAmount: 10 },
	{ outcome: '__proto__', appliedAmount: 10 },
]) assert.equal(resolvePlayerCombatFeedbackHaptic(feedback), null, `invalid combat receipt must not vibrate: ${String(feedback.outcome)}`);
assert.equal(pulsePlayerGamepadCombatFeedback({ ...hapticPad, connected: false }, { outcome: 'hit', appliedAmount: 10 }), false, 'disconnected gamepad must not receive combat feedback');
assert.equal(pulsePlayerGamepadCombatFeedback({ ...hapticPad, mapping: '' }, { outcome: 'hit', appliedAmount: 10 }), false, 'non-standard gamepad must not receive combat feedback');
class FakeInputTarget {
	constructor() { this.hidden = false; this.listeners = new Map(); }
	addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
	removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
	dispatch(type, event = {}) { for (const handler of this.listeners.get(type) ?? []) handler({ type, ...event }); }
}
const lifecycleCalls = [];
const lifecyclePad = { ...makePad({ index: 4 }), vibrationActuator: { playEffect: (type, options) => { lifecycleCalls.push({ type, options }); return Promise.resolve(); } } };
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [lifecyclePad] } });
try {
	const target = new FakeInputTarget();
	const controller = new KeyboardInput(target);
	controller._activeGamepadIndex = 4;
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 11, outcome: 'hit', appliedAmount: 12 } });
	assert.equal(lifecycleCalls.length, 1, 'active Standard controller must receive authoritative combat feedback');
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 11, outcome: 'hit-stagger', appliedAmount: 12 } });
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 10, outcome: 'parry', blockedAmount: 12 } });
	assert.equal(lifecycleCalls.length, 1, 'duplicate and out-of-order serials must never replay haptics');
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 12, outcome: 'hit', appliedAmount: 0 } });
	assert.equal(lifecycleCalls.length, 1, 'invalid evidence must not consume the next serial');
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 12, outcome: 'guard-break', blockedAmount: 5 } });
	assert.equal(lifecycleCalls.length, 2, 'same serial may still play after an invalid receipt was rejected');
	target.dispatch('blur');
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 13, outcome: 'hit', appliedAmount: 12 } });
	assert.equal(lifecycleCalls.length, 2, 'focus loss must disarm gamepad combat feedback');
	controller._activeGamepadIndex = 4;
	controller.dispose();
	target.dispatch('aapw:player-combat-feedback', { detail: { serial: 14, outcome: 'hit', appliedAmount: 12 } });
	assert.equal(lifecycleCalls.length, 2, 'dispose must remove the combat feedback listener');
} finally {
	if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
}
const unmapped = samplePlayerGamepad(makePad({ mapping: '', axes: [1, -1, 1, -1], buttons: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 10: true, 12: true, 15: true }, values: { 6: 1, 7: 1 } })); assert.equal(unmapped.forward, 0); assert.equal(unmapped.lookX, 0); assert.equal(unmapped.running, false); assert.equal(unmapped.dodgePressed, false); assert.equal(unmapped.parryPressed, false); assert.equal(unmapped.lightPressed, false);
const pads = [makePad({ index: 3, mapping: '' }), makePad({ index: 2 }), makePad({ index: 1 })]; assert.equal(selectPlayerGamepad(pads)?.index, 1); assert.equal(selectPlayerGamepad(pads, 2)?.index, 2); assert.equal(selectPlayerGamepad([pads[0]], 3), null);
const source = fs.readFileSync(new URL('../src/3d/input.js', import.meta.url), 'utf8');
for (const contract of ["JUMP: 0", "DODGE: 1", "LIGHT: 2", "HEAVY: 3", "GUARD: 4", "PARRY: 5", "ZOOM_OUT: 6", "ZOOM_IN: 7", "SPRINT: 10", "DPAD_UP: 12", "DPAD_DOWN: 13", "DPAD_LEFT: 14", "DPAD_RIGHT: 15", "readGamepadDpad", "stick.magnitude > 0 ? stick : dpad", "GAMEPAD_TRIGGER_DEADZONE = 0.08", "applyGamepadTriggerDeadzone", "GAMEPAD_SPRINT_MIN_MAGNITUDE = 0.72", "GAMEPAD_SPRINT_RELEASE_MAGNITUDE = 0.55", "GAMEPAD_DODGE_MIN_MAGNITUDE = 0.45", "resolveGamepadSprintIntent", "this._gamepadSprintActive", "sample.dodgePressed && sample.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE", "gamepad.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE", "GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3", "Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, nowSeconds - this._lastPollSeconds)", "dodgePressed: buttons.dodge && !previousButtons.dodge", "parryPressed: buttons.parry && !previousButtons.parry", "if (gamepad.parryPressed) guarding = true", "pulsePlayerGamepadAction(gamepad, 'dodge')", "pulsePlayerGamepadAction(gamepad, 'parry')", "gamepad.axes?.[2]", "gamepad.axes?.[3]", "pad.mapping === 'standard'", "GAMEPAD_ACTION_HAPTICS", "GAMEPAD_COMBAT_FEEDBACK_HAPTICS", "resolvePlayerCombatFeedbackHaptic", "pulsePlayerGamepadCombatFeedback", "Object.hasOwn", "COMBAT_FEEDBACK_EVENT", "dual-rumble", "visibilitychange", "visibility-hidden"]) assert.ok(source.includes(contract), `missing ${contract}`);
const movementSource = fs.readFileSync(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');
for (const contract of ['const inputMagnitude = Math.min(1, Math.hypot(axes.forward, axes.strafe))', '_move.normalize().multiplyScalar(inputMagnitude)', 'export function applyGamepadCameraLook(camera, controls, axes)', 'GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND', 'GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3', 'Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, Number.isFinite(axes?.lookDeltaSeconds)']) assert.ok(movementSource.includes(contract), `missing ${contract}`);
assert.ok(!source.includes('Math.min(0.05, nowSeconds - this._lastPollSeconds)'), 'legacy 50ms input clamp must stay removed');
assert.ok(!movementSource.includes('Math.min(0.05, Number.isFinite(axes?.lookDeltaSeconds)'), 'legacy 50ms camera clamp must stay removed');
assert.ok(!source.includes('gamepad?.buttons?.[0]?.pressed'));
console.log('[checkPlayerGamepadInput] PASS');