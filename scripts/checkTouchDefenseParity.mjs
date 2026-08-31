#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TouchJoystick } from '../src/3d/ui/touchJoystick.js';

class FakeClassList {
	constructor() { this.values = new Set(); }
	add(value) { this.values.add(value); }
	remove(value) { this.values.delete(value); }
	toggle(value, force) { if (force ?? !this.values.has(value)) this.values.add(value); else this.values.delete(value); }
}
class FakeElement extends EventTarget {
	constructor() { super(); this.style = {}; this.classList = new FakeClassList(); this.attributes = new Map(); this.children = []; this.capturedPointerId = null; this.textContent = ''; this.className = ''; }
	appendChild(child) { this.children.push(child); return child; }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	setPointerCapture(id) { this.capturedPointerId = id; }
	hasPointerCapture(id) { return this.capturedPointerId === id; }
	releasePointerCapture(id) { if (this.capturedPointerId === id) this.capturedPointerId = null; }
	remove() {}
}
class FakeDocument extends EventTarget {
	constructor() { super(); this.hidden = false; this.body = new FakeElement(); }
	createElement() { return new FakeElement(); }
	querySelector() { return null; }
}
function pointer(target, type, pointerId = 1, clientX = 0, clientY = 0) {
	const event = new Event(type, { cancelable: true });
	Object.defineProperties(event, { pointerId: { value: pointerId }, clientX: { value: clientX }, clientY: { value: clientY }, button: { value: 0 } });
	target.dispatchEvent(event);
}

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
const document = new FakeDocument();
const window = new EventTarget();
globalThis.document = document;
globalThis.window = window;
let blocked = false;
const touch = new TouchJoystick(document.body, { isInputBlocked: () => blocked });
try {
	assert.equal(touch._dodgeButton.getAttribute('aria-label'), 'Kaçın');
	assert.equal(touch._parryButton.getAttribute('aria-label'), 'Savuştur');

	pointer(touch._base, 'pointerdown', 7, 10, 10);
	pointer(touch._base, 'pointermove', 7, 45, 10);
	pointer(touch._dodgeButton, 'pointerdown', 8);
	const dodgeAxes = touch.getAxes();
	assert.equal(dodgeAxes.running, true, 'touch dodge must reuse the existing run+jump dodge contract');
	assert.notEqual(dodgeAxes.strafe, 0, 'touch dodge requires the live joystick direction to reach Player');
	assert.equal(touch.consumeJumpRequested(), true, 'touch dodge must feed the canonical edge-triggered jump/dodge channel');
	assert.equal(touch.consumeJumpRequested(), false, 'touch dodge request must be one-shot');

	pointer(touch._base, 'pointerup', 7);
	pointer(touch._parryButton, 'pointerdown', 9);
	assert.equal(touch.getAxes().guarding, true, 'touch parry must create one canonical guard-press frame');
	assert.equal(touch.getAxes().guarding, false, 'touch parry must be one-shot and not become a held guard');

	blocked = true;
	pointer(touch._dodgeButton, 'pointerdown', 10);
	pointer(touch._parryButton, 'pointerdown', 11);
	assert.deepEqual(touch.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false }, 'blocked touch defense input must fail closed');
	assert.equal(touch.consumeJumpRequested(), false, 'blocked dodge must not leak across pause');

	blocked = false;
	pointer(touch._dodgeButton, 'pointerdown', 12);
	pointer(touch._parryButton, 'pointerdown', 13);
	document.hidden = true;
	document.dispatchEvent(new Event('visibilitychange'));
	document.hidden = false;
	assert.deepEqual(touch.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false }, 'visibility reset must clear dodge/parry state');
	assert.equal(touch.consumeJumpRequested(), false, 'visibility reset must clear queued dodge');

	pointer(touch._dodgeButton, 'pointerdown', 14);
	pointer(touch._parryButton, 'pointerdown', 15);
	window.dispatchEvent(new Event('pagehide'));
	assert.deepEqual(touch.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false }, 'pagehide must clear defense actions');
	assert.equal(touch.consumeJumpRequested(), false, 'pagehide must clear queued dodge');
} finally {
	touch.dispose();
	if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
	if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
}

console.log(JSON.stringify({ ok: true, contract: 'touch-defense-input-parity', touch: ['dodge', 'parry'], reuse: { dodge: 'run+jump -> Player dodge', parry: 'guard edge -> Player parry window' }, pauseFailClosed: true, pwaLifecycleReset: true }, null, 2));
