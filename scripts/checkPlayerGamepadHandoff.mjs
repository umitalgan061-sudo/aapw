import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent !== 'function') globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
const emitted = [];
const previousDispatch = globalThis.dispatchEvent;
globalThis.dispatchEvent = (event) => { emitted.push({ type: event.type, detail: event.detail }); return true; };
let pads = [];
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
const { KeyboardInput } = await import('../src/3d/input.js');
function makePad({ index, axes = [0, 0], buttons = {}, connected = true, mapping = 'standard' }) { return { index, connected, mapping, axes, buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: Boolean(buttons[i]) })) }; }
const combatEvents = (kind = null) => emitted.filter((e) => e.type === 'aapw:player-combat-input' && (!kind || e.detail?.kind === kind));
const deviceEvents = () => emitted.filter((e) => e.type === 'aapw:player-input-device');
const target = new EventTarget();
Object.defineProperty(target, 'hidden', { configurable: true, writable: true, value: false });
const input = new KeyboardInput(target);
try {
	pads = [makePad({ index: 0, mapping: '', axes: [1, -1, 1, -1], buttons: { 0: true, 2: true, 3: true, 4: true, 10: true } })];
	const unsupported = input.getAxes(); assert.deepEqual({ forward: unsupported.forward, strafe: unsupported.strafe, running: unsupported.running, guarding: unsupported.guarding, jumpRequested: unsupported.jumpRequested }, { forward: 0, strafe: 0, running: false, guarding: false, jumpRequested: false }); assert.equal(combatEvents().length, 0); assert.equal(deviceEvents().length, 0);
	pads = [makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true, 4: true, 10: true } })]; const first = input.getAxes(); assert.ok(first.forward > 0.6 && first.strafe > 0.25); assert.equal(first.running, true); assert.equal(first.guarding, true); assert.equal(combatEvents().length, 0);
	pads = [makePad({ index: 1, axes: [0.4, -0.8] })]; input.getAxes(); pads = [makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true } })]; input.getAxes(); assert.equal(combatEvents('light').length, 1); input.getAxes(); assert.equal(combatEvents('light').length, 1);
	pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true } }), makePad({ index: 1, axes: [0.4, -0.8], buttons: { 2: true } })]; const sticky = input.getAxes(); assert.ok(sticky.forward > 0.6 && sticky.strafe > 0); assert.equal(combatEvents('heavy').length, 0); assert.equal(deviceEvents().filter((e) => e.detail?.gamepadIndex === 0).length, 0);
	pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true, 4: true } }), makePad({ index: 1, connected: false })]; const handoff = input.getAxes(); assert.ok(handoff.strafe < -0.95); assert.equal(handoff.guarding, true); assert.equal(combatEvents('heavy').length, 0); assert.equal(deviceEvents().at(-1)?.detail.gamepadIndex, 0);
	pads = [makePad({ index: 0, axes: [-1, 0] })]; input.getAxes(); pads = [makePad({ index: 0, axes: [-1, 0], buttons: { 3: true } })]; input.getAxes(); assert.equal(combatEvents('heavy').length, 1);
	pads = [makePad({ index: 4, mapping: '', axes: [1, -1], buttons: { 2: true, 3: true } })]; const lost = input.getAxes(); assert.equal(lost.forward, 0); assert.equal(lost.strafe, 0); assert.equal(deviceEvents().at(-1)?.detail.device, 'keyboard-pointer');
	pads = [makePad({ index: 0, buttons: { 0: true, 2: true, 3: true } })]; const reconnectHeld = input.getAxes(); assert.equal(reconnectHeld.jumpRequested, false); assert.equal(combatEvents('light').length, 1); assert.equal(combatEvents('heavy').length, 1);
	pads = [makePad({ index: 0 })]; input.getAxes(); pads = [makePad({ index: 0, buttons: { 0: true } })]; assert.equal(input.getAxes().jumpRequested, true); assert.equal(input.getAxes().jumpRequested, false);

	pads = [makePad({ index: 0, axes: [0, -1], buttons: { 2: true, 4: true, 10: true } })]; input.getAxes(); const beforeBlurCombat = combatEvents().length, beforeBlurLight = combatEvents('light').length; target.dispatchEvent(new Event('blur')); assert.equal(deviceEvents().at(-1)?.detail.reason, 'focus-lost'); const heldAfterBlur = input.getAxes(); assert.ok(heldAfterBlur.forward > 0.95); assert.equal(heldAfterBlur.running, true); assert.equal(heldAfterBlur.guarding, true); assert.equal(combatEvents().length, beforeBlurCombat); pads = [makePad({ index: 0 })]; input.getAxes(); pads = [makePad({ index: 0, buttons: { 2: true } })]; input.getAxes(); assert.equal(combatEvents('light').length, beforeBlurLight + 1);

	pads = [makePad({ index: 0, axes: [0.5, -0.7], buttons: { 3: true, 4: true } })]; input.getAxes(); const beforePageHideCombat = combatEvents().length, beforePageHideHeavy = combatEvents('heavy').length; target.dispatchEvent(new Event('pagehide')); assert.equal(deviceEvents().at(-1)?.detail.reason, 'page-hidden'); const heldAfterPageHide = input.getAxes(); assert.ok(heldAfterPageHide.forward > 0.5 && heldAfterPageHide.strafe > 0.25); assert.equal(heldAfterPageHide.guarding, true); assert.equal(combatEvents().length, beforePageHideCombat); pads = [makePad({ index: 0 })]; input.getAxes(); pads = [makePad({ index: 0, buttons: { 3: true } })]; input.getAxes(); assert.equal(combatEvents('heavy').length, beforePageHideHeavy + 1);

	pads = [makePad({ index: 0, axes: [0, -0.8], buttons: { 0: true, 2: true } })]; input.getAxes(); const beforeHiddenCombat = combatEvents().length, beforeHiddenLight = combatEvents('light').length; target.hidden = true; target.dispatchEvent(new Event('visibilitychange')); assert.equal(deviceEvents().at(-1)?.detail.reason, 'visibility-hidden'); const heldAfterHidden = input.getAxes(); assert.ok(heldAfterHidden.forward > 0.7); assert.equal(heldAfterHidden.jumpRequested, false); assert.equal(combatEvents().length, beforeHiddenCombat, 'hidden restore must seed held face buttons'); target.hidden = false; pads = [makePad({ index: 0 })]; input.getAxes(); pads = [makePad({ index: 0, buttons: { 2: true } })]; input.getAxes(); assert.equal(combatEvents('light').length, beforeHiddenLight + 1, 'visibility restore release/repress must fire exactly once');
	console.log('[checkPlayerGamepadHandoff] PASS');
} finally {
	input.dispose(); globalThis.dispatchEvent = previousDispatch;
	if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
}
