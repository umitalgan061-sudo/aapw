import assert from 'node:assert/strict';

class FakeEventTarget {
	constructor() {
		this._listeners = new Map();
	}
	addEventListener(type, handler) {
		if (!this._listeners.has(type)) this._listeners.set(type, new Set());
		this._listeners.get(type).add(handler);
	}
	removeEventListener(type, handler) {
		this._listeners.get(type)?.delete(handler);
	}
	dispatch(type, code) {
		for (const handler of this._listeners.get(type) ?? []) handler({ code });
	}
	listenerCount(type) {
		return this._listeners.get(type)?.size ?? 0;
	}
}

const { KeyboardInput } = await import('../src/3d/input.js');

const target = new FakeEventTarget();
const input = new KeyboardInput(target);

assert.equal(target.listenerCount('keydown'), 1);
assert.equal(target.listenerCount('keyup'), 1);
assert.deepEqual(input.getAxes(), {
	forward: 0,
	strafe: 0,
	running: false,
	jumpRequested: false,
});

// WASD movement maps to local forward/strafe axes and clamps diagonal input per axis.
target.dispatch('keydown', 'KeyW');
target.dispatch('keydown', 'KeyD');
assert.deepEqual(input.getAxes(), {
	forward: 1,
	strafe: 1,
	running: false,
	jumpRequested: false,
});

// Opposing inputs cancel deterministically instead of exceeding the documented [-1, 1] range.
target.dispatch('keydown', 'KeyS');
target.dispatch('keydown', 'KeyA');
assert.deepEqual(input.getAxes(), {
	forward: 0,
	strafe: 0,
	running: false,
	jumpRequested: false,
});

// Releasing WASD reveals the equivalent arrow-key contract.
for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) target.dispatch('keyup', code);
target.dispatch('keydown', 'ArrowUp');
target.dispatch('keydown', 'ArrowLeft');
assert.deepEqual(input.getAxes(), {
	forward: 1,
	strafe: -1,
	running: false,
	jumpRequested: false,
});

// Either Shift key enables running while held.
target.dispatch('keydown', 'ShiftRight');
assert.equal(input.getAxes().running, true);
target.dispatch('keyup', 'ShiftRight');
assert.equal(input.getAxes().running, false);

// Jump is edge-triggered: one true read per physical Space press, not one per held frame.
target.dispatch('keydown', 'Space');
assert.equal(input.getAxes().jumpRequested, true);
assert.equal(input.getAxes().jumpRequested, false);
target.dispatch('keydown', 'Space');
assert.equal(input.getAxes().jumpRequested, false, 'repeat keydown while Space is held must not re-arm jump');
target.dispatch('keyup', 'Space');
target.dispatch('keydown', 'Space');
assert.equal(input.getAxes().jumpRequested, true, 'new Space press after keyup re-arms jump');

// Unmapped keys may be tracked internally but must not affect the public axes contract.
target.dispatch('keydown', 'KeyQ');
const withUnmapped = input.getAxes();
assert.equal(withUnmapped.forward, 1);
assert.equal(withUnmapped.strafe, -1);
assert.equal(withUnmapped.running, false);
assert.equal(withUnmapped.jumpRequested, false);

target.dispatch('keyup', 'ArrowUp');
target.dispatch('keyup', 'ArrowLeft');
target.dispatch('keyup', 'Space');
target.dispatch('keyup', 'KeyQ');
assert.deepEqual(input.getAxes(), {
	forward: 0,
	strafe: 0,
	running: false,
	jumpRequested: false,
});

// Memory-leak contract: dispose removes listeners and clears held/jump state.
target.dispatch('keydown', 'KeyW');
target.dispatch('keydown', 'Space');
input.dispose();
assert.equal(target.listenerCount('keydown'), 0);
assert.equal(target.listenerCount('keyup'), 0);
assert.deepEqual(input.getAxes(), {
	forward: 0,
	strafe: 0,
	running: false,
	jumpRequested: false,
});

console.log('Keyboard input contract PASS: WASD/arrows, opposing-key cancellation, run modifier, edge-triggered jump and listener cleanup preserved.');
