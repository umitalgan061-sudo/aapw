import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent !== 'function') {
	globalThis.CustomEvent = class CustomEvent extends Event {
		constructor(type, init = {}) {
			super(type);
			this.detail = init.detail;
		}
	};
}

const emitted = [];
const previousDispatch = globalThis.dispatchEvent;
globalThis.dispatchEvent = (event) => {
	emitted.push({ type: event.type, detail: event.detail });
	return true;
};

let pads = [];
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: { getGamepads: () => pads },
});

const { KeyboardInput } = await import('../src/3d/input.js');

function makePad({ index, axes = [0, 0], buttons = {}, connected = true, mapping = 'standard' }) {
	return {
		index,
		connected,
		mapping,
		axes,
		buttons: Array.from({ length: 12 }, (_, buttonIndex) => ({ pressed: Boolean(buttons[buttonIndex]) })),
	};
}

function combatEvents(kind = null) {
	return emitted.filter((event) => event.type === 'aapw:player-combat-input' && (!kind || event.detail?.kind === kind));
}

function deviceEvents() {
	return emitted.filter((event) => event.type === 'aapw:player-input-device');
}

const target = new EventTarget();
const input = new KeyboardInput(target);

try {
	pads = [makePad({ index: 0, mapping: '', axes: [1, -1, 1, -1], buttons: { 0: true, 2: true, 3: true, 4: true, 10: true } })];
	const unsupported = input.getAxes();
	assert.deepEqual(
		{ forward: unsupported.forward, strafe: unsupported.strafe, running: unsupported.running, guarding: unsupported.guarding, jumpRequested: unsupported.jumpRequested },
		{ forward: 0, strafe: 0, running: false, guarding: false, jumpRequested: false },
		'unmapped hotplug must remain inert instead of guessing Standard Gamepad indices',
	);
	assert.equal(combatEvents().length, 0, 'unmapped hotplug must not emit guessed combat actions');
	assert.equal(deviceEvents().length, 0, 'unmapped hotplug must not claim the active gamepad slot');

	pads = [makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true, 4: true, 10: true } })];
	const first = input.getAxes();
	assert.ok(first.forward > 0.6, 'newly selected controller movement must become live immediately');
	assert.ok(first.strafe > 0.25, 'newly selected controller strafe must become live immediately');
	assert.equal(first.running, true, 'newly selected controller sprint hold must become live immediately');
	assert.equal(first.guarding, true, 'newly selected controller guard hold must become live immediately');
	assert.equal(first.jumpRequested, false);
	assert.equal(combatEvents().length, 0, 'held face button on initial connection must not create phantom attack');
	assert.deepEqual(deviceEvents().at(-1)?.detail, { device: 'gamepad', gamepadIndex: 1, reason: 'selected' });

	pads = [makePad({ index: 1, axes: [0.4, -0.8] })];
	input.getAxes();
	pads = [makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true } })];
	input.getAxes();
	assert.equal(combatEvents('light').length, 1, 'release then X re-press must emit exactly one light attack');
	input.getAxes();
	assert.equal(combatEvents('light').length, 1, 'held X must not retrigger light attack every poll');

	pads = [
		makePad({ index: 0, axes: [-1, 0], buttons: { 3: true } }),
		makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true } }),
	];
	const sticky = input.getAxes();
	assert.ok(sticky.forward > 0.6 && sticky.strafe > 0, 'lower-index hotplug must not steal the active controller');
	assert.equal(combatEvents('heavy').length, 0, 'inactive controller held Y must not leak a heavy attack');
	assert.equal(deviceEvents().filter((event) => event.detail?.gamepadIndex === 0).length, 0, 'hotplug without handoff must not emit selection change');

	pads = [
		makePad({ index: 0, axes: [-1, 0], buttons: { 3: true, 4: true } }),
		makePad({ index: 1, connected: false }),
	];
	const handoff = input.getAxes();
	assert.ok(handoff.strafe < -0.95, 'fallback Standard controller analog movement must become live on disconnect handoff');
	assert.equal(handoff.guarding, true, 'held guard may safely carry through controller handoff');
	assert.equal(combatEvents('heavy').length, 0, 'held Y on fallback controller must be seeded, not emitted as phantom heavy');
	assert.deepEqual(deviceEvents().at(-1)?.detail, { device: 'gamepad', gamepadIndex: 0, reason: 'selected' });

	pads = [makePad({ index: 0, axes: [-1, 0] })];
	input.getAxes();
	pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true } })];
	input.getAxes();
	assert.equal(combatEvents('heavy').length, 1, 'fallback controller must emit heavy after real release/repress edge');

	pads = [makePad({ index: 4, mapping: '', axes: [1, -1], buttons: { 2: true, 3: true } })];
	const lostStandard = input.getAxes();
	assert.equal(lostStandard.forward, 0, 'losing the last Standard controller must not fall back to an unmapped pad');
	assert.equal(lostStandard.strafe, 0);
	assert.equal(combatEvents('light').length, 1);
	assert.equal(combatEvents('heavy').length, 1);
	assert.deepEqual(deviceEvents().at(-1)?.detail, { device: 'keyboard-pointer', gamepadIndex: null, reason: 'disconnected' });

	pads = [];
	const noPad = input.getAxes();
	assert.equal(noPad.forward, 0);
	assert.equal(noPad.strafe, 0);
	assert.equal(noPad.running, false);
	assert.equal(noPad.guarding, false);

	pads = [makePad({ index: 0, buttons: { 0: true, 2: true, 3: true } })];
	const reconnectHeld = input.getAxes();
	assert.equal(reconnectHeld.jumpRequested, false, 'held A on reconnect must not create phantom jump');
	assert.equal(combatEvents('light').length, 1, 'held X on reconnect must not create phantom light');
	assert.equal(combatEvents('heavy').length, 1, 'held Y on reconnect must not create phantom heavy');

	pads = [makePad({ index: 0 })];
	input.getAxes();
	pads = [makePad({ index: 0, buttons: { 0: true } })];
	const jumpEdge = input.getAxes();
	assert.equal(jumpEdge.jumpRequested, true, 'A must trigger jump after reconnect release/repress');
	assert.equal(input.getAxes().jumpRequested, false, 'held A must be consumed as a single jump edge');

	console.log('[checkPlayerGamepadHandoff] PASS: Standard-only sticky selection, disconnect/reconnect and phantom-action suppression are deterministic.');
} finally {
	input.dispose();
	globalThis.dispatchEvent = previousDispatch;
	if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
	else delete globalThis.navigator;
}
