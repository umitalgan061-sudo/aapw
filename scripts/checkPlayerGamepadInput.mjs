import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyGamepadRadialDeadzone, pulsePlayerGamepadMelee, samplePlayerGamepad, selectPlayerGamepad } from '../src/3d/input.js';
function makePad({ index = 0, mapping = 'standard', axes = [0, 0], buttons = {}, values = {}, connected = true } = {}) {
	return { index, mapping, connected, axes, buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: Boolean(buttons[i]) || Number(values[i] ?? 0) > 0.5, value: Number(values[i] ?? (buttons[i] ? 1 : 0)) })) };
}
const idle = samplePlayerGamepad(makePad());
assert.deepEqual({ forward: idle.forward, strafe: idle.strafe, lookX: idle.lookX, lookY: idle.lookY, cameraZoom: idle.cameraZoom, running: idle.running, guarding: idle.guarding }, { forward: 0, strafe: 0, lookX: 0, lookY: 0, cameraZoom: 0, running: false, guarding: false });
for (const [x, y] of [[0.08, -0.12], [0.17, 0], [0, -0.18]]) { const s = samplePlayerGamepad(makePad({ axes: [x, y] })); assert.equal(s.magnitude, 0); }
const smallDiag = samplePlayerGamepad(makePad({ axes: [0.12, -0.17] })); assert.ok(smallDiag.magnitude > 0 && smallDiag.forward > 0 && smallDiag.strafe > 0);
const diagonal = applyGamepadRadialDeadzone(0.7, -0.7); assert.ok(diagonal.magnitude <= 1 && Math.hypot(diagonal.x, diagonal.y) <= 1.000000001);
const movement = samplePlayerGamepad(makePad({ axes: [0.59, -0.72], buttons: { 4: true, 10: true } })); assert.ok(movement.forward > 0.55 && movement.strafe > 0.4 && movement.magnitude > 0.6); assert.equal(movement.running, true); assert.equal(movement.guarding, true);
const camera = samplePlayerGamepad(makePad({ axes: [0, 0, 0.72, -0.59], values: { 6: 0.2, 7: 0.7 } })); assert.ok(camera.lookX > 0.6 && camera.lookY < -0.45); assert.ok(Math.abs(camera.cameraZoom - 0.5) < 1e-9); assert.equal(camera.forward, 0); assert.equal(camera.strafe, 0);
assert.equal(samplePlayerGamepad(makePad({ values: { 6: 1, 7: 0.25 } })).cameraZoom, -0.75);
const first = samplePlayerGamepad(makePad({ buttons: { 0: true, 2: true, 3: true } }), { jump: false, light: false, heavy: false }); assert.equal(first.jumpPressed, true); assert.equal(first.lightPressed, true); assert.equal(first.heavyPressed, true);
const held = samplePlayerGamepad(makePad({ buttons: { 0: true, 2: true, 3: true } }), first.buttons); assert.equal(held.jumpPressed, false); assert.equal(held.lightPressed, false); assert.equal(held.heavyPressed, false);
const calls = []; const hapticPad = { ...makePad(), vibrationActuator: { playEffect: (type, options) => { calls.push({ type, options }); return Promise.resolve(); } } };
assert.equal(pulsePlayerGamepadMelee(hapticPad, 'light'), true); assert.equal(pulsePlayerGamepadMelee(hapticPad, 'heavy'), true); assert.equal(calls.length, 2); assert.ok(calls[1].options.strongMagnitude > calls[0].options.strongMagnitude); assert.equal(pulsePlayerGamepadMelee({ ...hapticPad, mapping: '' }, 'heavy'), false);
const unmapped = samplePlayerGamepad(makePad({ mapping: '', axes: [1, -1, 1, -1], buttons: { 0: true, 2: true, 3: true, 4: true, 10: true }, values: { 6: 1, 7: 1 } })); assert.equal(unmapped.forward, 0); assert.equal(unmapped.lookX, 0); assert.equal(unmapped.running, false); assert.equal(unmapped.lightPressed, false);
const pads = [makePad({ index: 3, mapping: '' }), makePad({ index: 2 }), makePad({ index: 1 })]; assert.equal(selectPlayerGamepad(pads)?.index, 1); assert.equal(selectPlayerGamepad(pads, 2)?.index, 2); assert.equal(selectPlayerGamepad([pads[0]], 3), null);
const source = fs.readFileSync(new URL('../src/3d/input.js', import.meta.url), 'utf8');
for (const contract of ["JUMP: 0", "LIGHT: 2", "HEAVY: 3", "GUARD: 4", "ZOOM_OUT: 6", "ZOOM_IN: 7", "SPRINT: 10", "gamepad.axes?.[2]", "gamepad.axes?.[3]", "pad.mapping === 'standard'", "pulsePlayerGamepadMelee", "dual-rumble", "visibilitychange", "visibility-hidden"]) assert.ok(source.includes(contract), `missing ${contract}`);
const movementSource = fs.readFileSync(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');
for (const contract of ['const inputMagnitude = Math.min(1, Math.hypot(axes.forward, axes.strafe))', '_move.normalize().multiplyScalar(inputMagnitude)', 'export function applyGamepadCameraLook(camera, controls, axes)', 'GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND']) assert.ok(movementSource.includes(contract), `missing ${contract}`);
assert.ok(!source.includes('gamepad?.buttons?.[0]?.pressed'));
console.log('[checkPlayerGamepadInput] PASS');
