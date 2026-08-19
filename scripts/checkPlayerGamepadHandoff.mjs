import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent !== 'function') {
	globalThis.CustomEvent = class CustomEvent extends Event {
		constructor(type, init = {}) { super(type); this.detail = init.detail; }
	};
}

const emitted = [];
const previousDispatch = globalThis.dispatchEvent;
globalThis.dispatchEvent = (event) => { emitted.push({ type: event.type, detail: event.detail }); return true; };
let pads = [];
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
const { KeyboardInput } = await import('../src/3d/input.js');

function makePad({ index, axes = [0, 0], buttons = {}, connected = true, mapping = 'standard' }) {
	return { index, connected, mapping, axes, buttons: Array.from({ length: 12 }, (_, buttonIndex) => ({ pressed: Boolean(buttons[buttonIndex]) })) };
}
function combatEvents(kind = null) { return emitted.filter((event) => event.type === 'aapw:player-combat-input' && (!kind || event.detail?.kind === kind)); }
function deviceEvents() { return emitted.filter((event) => event.type === 'aapw:player-input-device'); }
const target = new EventTarget();
const input = new KeyboardInput(target);

try {
	pads = [makePad({ index: 0, mapping: '', axes: [1, -1, 1, -1], buttons: { 0: true, 2: true, 3: true, 4: true, 10: true } })];
	const unsupported = input.getAxes();
	assert.deepEqual({ forward: unsupported.forward, strafe: unsupported.strafe, running: unsupported.running, guarding: unsupported.guarding, jumpRequested: unsupported.jumpRequested }, { forward: 0, strafe: 0, running: false, guarding: false, jumpRequested: false });
	assert.equal(combatEvents().length, 0);
	assert.equal(deviceEvents().length, 0);

	pads = [makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true, 4: true, 10: true } })];
	const first = input.getAxes();
	assert.ok(first.forward > 0.6 && first.strafe > 0.25);
	assert.equal(first.running, true);
	assert.equal(first.guarding, true);
	assert.equal(first.jumpRequested, false);
	assert.equal(combatEvents().length, 0);
	assert.deepEqual(deviceEvents().at(-1)?.detail, { device: 'gamepad', gamepadIndex: 1, reason: 'selected' });

	pads = [makePad({ index: 1, axes: [0.4, -0.8] })]; input.getAxes();
	pads = [makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true } })]; input.getAxes();
	assert.equal(combatEvents('light').length, 1);
	input.getAxes(); assert.equal(combatEvents('light').length, 1);

	pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true } }), makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true } })];
	const sticky = input.getAxes();
	assert.ok(sticky.forward > 0.6 && sticky.strafe > 0);
	assert.equal(combatEvents('heavy').length, 0);
	assert.equal(deviceEvents().filter((event) => event.detail?.gamepadIndex === 0).length, 0);

	pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true, 4: true } }), makePad({ index: 1, connected: false })];
	const handoff = input.getAxes();
	assert.ok(handoff.strafe < -0.95);
	assert.equal(handoff.guarding, true);
	assert.equal(combatEvents('heavy').length, 0);
	assert.deepEqual(deviceEvents().at(-1)?.detail, { device: 'gamepad', gamepadIndex: 0, reason: 'selected' });

	pads = [makePad({ index: 0, axes: [-1, 0] })]; input.getAxes();
	pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true } })]; input.getAxes();
	assert.equal(combatEvents('heavy').length, 1);

	pads = [makePad({ index: 4, mapping: '', axes: [1, -1], buttons: { 2: true, 3: true } })];
	const lostStandard = input.getAxes();
	assert.equal(lostStandard.forward, 0);
	assert.equal(lostStandard.strafe, 0);
	assert.equal(combatEvents('light').length, 1);
	assert.equal(combatEvents('heavy').length, 1);
	assert.deepEqual(deviceEvents().at(-1)?.detail, { device: 'keyboard-pointer', gamepadIndex: null, reason: 'disconnected' });

	pads = [];
	const noPad = input.getAxes();
	assert.equal(noPad.forward, 0); assert.equal(noPad.strafe, 0); assert.equal(noPad.running, false); assert.equal(noPad.guarding, false);

	pads = [makePad({ index: 0, buttons: { 0: true, 2: true, 3: true } })];
	const reconnectHeld = input.getAxes();
	assert.equal(reconnectHeld.jumpRequested, false);
	assert.equal(combatEvents('light').length, 1);
	assert.equal(combatEvents('heavy').length, 1);
	pads = [makePad({ index: 0 })]; input.getAxes();
	pads = [makePad({ index: 0, buttons: { 0: true } })];
	const jumpEdge = input.getAxes();
	assert.equal(jumpEdge.jumpRequested, true);
	assert.equal(input.getAxes().jumpRequested, false);
	console.log('[checkPlayerGamepadHandoff] PASS: Standard-only sticky selection, disconnect/reconnect and phantom-action suppression are deterministic.');
} finally {
	input.dispose();
	globalThis.dispatchEvent = previousDispatch;
	if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
}
