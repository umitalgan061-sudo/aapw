import assert from 'node:assert/strict';

class FakeClassList {
	constructor() { this._values = new Set(); }
	add(value) { this._values.add(value); }
	remove(value) { this._values.delete(value); }
	contains(value) { return this._values.has(value); }
	oggle(value, force) {
		const active = force ?? !this._values.has(value);
		if (active) this._values.add(value);
		else this._values.delete(value);
		return active;
	}
}

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this.className = '';
		this.classList = new FakeClassList();
		this.style = {};
		this.attributes = new Map();
		this.textContent = '';
		this.type = '';
		this.removed = false;
		this._listeners = new Map();
		this.capturedPointerIds = [];
		this.releasedPointerIds = [];
	}
	appendChild(child) { this.children.push(child); return child; }
	addEventListener(type, handler) { this._listeners.set(type, handler); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	removeEventListener(type, handler) {
		if (this._listeners.get(type) === handler) this._listeners.delete(type);
	}
	setPointerCapture(pointerId) { this.capturedPointerIds.push(pointerId); }
	hasPointerCapture(pointerId) { return this.capturedPointerIds.includes(pointerId) && !this.releasedPointerIds.includes(pointerId); }
	releasePointerCapture(pointerId) { if (this.hasPointerCapture(pointerId)) this.releasedPointerIds.push(pointerId); }
	dispatch(type, event) { this._listeners.get(type)?.(event); }
	remove() { this.removed = true; }
}

const body = new FakeElement('body');
globalThis.document = {
	body,
	createElement(tagName) { return new FakeElement(tagName); },
};

const { TOUCH_JOYSTICK_CONFIG } = await import('../src/3d/config.js');
const { TouchJoystick } = await import('../src/3d/ui/touchJoystick.js');

const joystick = new TouchJoystick(body);
assert.equal(body.children[0], joystick._base);
assert.equal(joystick._base.children[0], joystick._knob);
assert.equal(body.children[1], joystick._jumpButton);
assert.equal(joystick._jumpButton.type, 'button');
assert.equal(joystick._jumpButton.textContent, 'Zıpla');
assert.equal(joystick._jumpButton.getAttribute('aria-label'), 'Zıpla');
assert.equal(joystick.consumeJumpRequested(), false, 'jump starts unrequested');
joystick._jumpButton.dispatch('click', {});
assert.equal(joystick.consumeJumpRequested(), true, 'one tap produces one jump edge');
assert.equal(joystick.consumeJumpRequested(), false, 'reading the jump edge consumes it');
assert.deepEqual(joystick.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false });

// Guard is held through the same real TouchJoystick instance and lifecycle reset releases capture fail-closed.
assert.equal(body.children[2], joystick._guardButton);
joystick._guardButton.dispatch('pointerdown', { pointerId: 21, preventDefault() {} });
assert.equal(joystick._guardButton.getAttribute('aria-pressed'), 'true');
assert.equal(joystick.getAxes().guarding, true);
assert.deepEqual(joystick._guardButton.capturedPointerIds, [21]);
joystick._resetGameplayState();
assert.deepEqual(joystick._guardButton.releasedPointerIds, [21], 'lifecycle reset releases active guard capture');
assert.equal(joystick._guardButton.getAttribute('aria-pressed'), 'false');
assert.equal(joystick.getAxes().guarding, false);

// Lock-on is an edge-triggered request, while externally confirmed target state stays visible to touch users.
assert.equal(body.children[3], joystick._lockOnButton);
assert.equal(joystick._lockOnButton.getAttribute('aria-label'), 'Hedef kilidi');
assert.equal(joystick._lockOnButton.getAttribute('aria-pressed'), 'false');
assert.equal(joystick.consumeLockOnRequested(), false, 'lock-on starts unrequested');
joystick._lockOnButton.dispatch('pointerdown', { preventDefault() {} });
assert.equal(joystick.consumeLockOnRequested(), true, 'one touch produces one lock-on edge');
assert.equal(joystick.consumeLockOnRequested(), false, 'reading the lock-on edge consumes it');
joystick.setLockOnActive(true);
assert.equal(joystick._lockOnButton.getAttribute('aria-pressed'), 'true');
assert.equal(joystick._lockOnButton.textContent, 'Kilitli');
assert.equal(joystick._lockOnButton.classList.contains('g3d-touch-lock-on-active'), true);
joystick.setLockOnActive(false);
assert.equal(joystick._lockOnButton.getAttribute('aria-pressed'), 'false');
assert.equal(joystick._lockOnButton.textContent, 'Hedef');
assert.equal(joystick._lockOnButton.classList.contains('g3d-touch-lock-on-active'), false);

let prevented = 0;
joystick._base.dispatch('pointerdown', {
	pointerId: 7,
	clientX: 100,
	clientY: 100,
	preventDefault() { prevented += 1; },
});
assert.equal(joystick._pointerId, 7);
assert.deepEqual(joystick._base.capturedPointerIds, [7]);
assert.equal(joystick._base.classList.contains('g3d-joystick-active'), true);

// A second finger must not steal control while the first pointer is captured.
joystick._base.dispatch('pointerdown', {
	pointerId: 8,
	clientX: 50,
	clientY: 50,
	preventDefault() { prevented += 1; },
});
assert.equal(joystick._pointerId, 7);
assert.deepEqual(joystick._base.capturedPointerIds, [7]);

// Small movement below the configured deadzone stays neutral.
const deadzoneDistance = joystick._radiusPx * TOUCH_JOYSTICK_CONFIG.DEADZONE_RATIO * 0.5;
joystick._base.dispatch('pointermove', {
	pointerId: 7,
	clientX: 100 + deadzoneDistance,
	clientY: 100,
	preventDefault() { prevented += 1; },
});
assert.deepEqual(joystick.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false });

// Full-right movement clamps at radius, yields strafe=1, and cannot exceed the analog range.
joystick._base.dispatch('pointermove', {
	pointerId: 7,
	clientX: 100 + joystick._radiusPx * 5,
	clientY: 100,
	preventDefault() { prevented += 1; },
});
let axes = joystick.getAxes();
assert.equal(axes.strafe, 1);
if (Object.is(axes.forward, -0)) axes.forward = 0;
assert.equal(axes.forward, 0);
assert.equal(axes.running, true);
assert.equal(Math.hypot(joystick._dragX, joystick._dragY) <= joystick._radiusPx, true);

// Full-up movement maps to forward=1 and preserves the same deterministic clamp.
joystick._base.dispatch('pointermove', {
	pointerId: 7,
	clientX: 100,
	clientY: 100 - joystick._radiusPx * 3,
	preventDefault() { prevented += 1; },
});
axes = joystick.getAxes();
assert.equal(axes.forward, 1);
if (Object.is(axes.strafe, -0)) axes.strafe = 0;
assert.equal(axes.strafe, 0);
assert.equal(axes.running, true);

// Unrelated pointers cannot mutate the active drag.
const beforeForeignMove = { x: joystick._dragX, y: joystick._dragY };
joystick._base.dispatch('pointermove', {
	pointerId: 8,
	clientX: 0,
	clientY: 0,
	preventDefault() { prevented += 1; },
});
assert.deepEqual({ x: joystick._dragX, y: joystick._dragY }, beforeForeignMove);

// pointercancel uses the same release path and must reset state completely.
joystick._base.dispatch('pointercancel', { pointerId: 7 });
assert.equal(joystick._pointerId, null);
assert.equal(joystick._base.classList.contains('g3d-joystick-active'), false);
assert.equal(joystick._knob.style.transform, '');
assert.deepEqual(joystick.getAxes(), { forward: 0, strafe: 0, running: false, guarding: false });

assert.equal(prevented, 4, 'only accepted pointerdown/move events prevent default');

// Disposing during active movement + guard must release both captures before DOM teardown.
joystick._base.dispatch('pointerdown', {
	pointerId: 42,
	clientX: 100,
	clientY: 100,
	preventDefault() {},
});
joystick._guardButton.dispatch('pointerdown', { pointerId: 43, preventDefault() {} });
assert.equal(joystick._pointerId, 42);
assert.equal(joystick.getAxes().guarding, true);
assert.equal(joystick._base.hasPointerCapture(42), true);
assert.equal(joystick._guardButton.hasPointerCapture(43), true);

joystick.dispose();
assert.equal(joystick._base.releasedPointerIds.includes(42), true, 'dispose releases active movement capture');
assert.equal(joystick._guardButton.releasedPointerIds.includes(43), true, 'dispose releases active guard capture');
assert.equal(joystick._base.removed, true);
assert.equal(joystick._jumpButton.removed, true);
assert.equal(joystick._jumpButton._listeners.has('click'), false, 'jump click listener removed on dispose');
assert.equal(joystick._lockOnButton._listeners.has('pointerdown'), false, 'lock-on pointer listener removed on dispose');
assert.equal(joystick.consumeJumpRequested(), false, 'dispose clears pending jump state');
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
	assert.equal(joystick._base._listeners.has(type), false, `${type} listener removed on dispose`);
}

console.log('Touch joystick input contract PASS: movement capture, guard lifecycle release, lock-on accessibility state, deadzone, clamp, axis mapping, cancel reset, dispose capture release and listener cleanup preserved.');