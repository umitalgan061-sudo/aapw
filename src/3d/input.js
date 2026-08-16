/**
 * Keyboard input state tracking (WASD/arrow keys + Shift-to-run) — core infrastructure any future
 * gameplay system can read directional input from. Deliberately camera-agnostic: `getAxes()`
 * returns input-local forward/strafe values, not a world-space direction — callers combine that
 * with their own camera facing (see `gameplay/player.js` / `game3d.js`).
 *
 * Touch/joystick input (FAZ 4's other input requirement, for mobile) lives in its own module,
 * `ui/touchJoystick.js` — this module intentionally covers keyboard only. `game3d.js` combines
 * both via `gameLoopHelpers.js`'s `combineAxes()` before computing camera-relative movement.
 * @module input
 */

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP_KEYS = new Set(['Space']);
const DODGE_KEYS = new Set(['ControlLeft', 'ControlRight']);

export class KeyboardInput {
	/** @param {EventTarget} [target] Defaults to `window`. Passed explicitly so this stays testable. */
	constructor(target = window) {
		this._keys = new Set();
		this._jumpRequested = false;
		this._dodgeRequested = false;
		this._target = target;
		this._onKeyDown = (event) => {
			if (JUMP_KEYS.has(event.code) && !this._keys.has(event.code)) this._jumpRequested = true;
			if (DODGE_KEYS.has(event.code) && !this._keys.has(event.code)) this._dodgeRequested = true;
			this._keys.add(event.code);
		};
		this._onKeyUp = (event) => this._keys.delete(event.code);
		target.addEventListener('keydown', this._onKeyDown);
		target.addEventListener('keyup', this._onKeyUp);
	}

	/**
	 * @returns {{forward: number, strafe: number, running: boolean, jumpRequested: boolean, dodgeRequested: boolean}}
	 *   Direction values remain input-local. Jump and dodge are edge-triggered and consumed once.
	 */
	getAxes() {
		let forward = 0;
		let strafe = 0;
		let running = false;
		for (const code of this._keys) {
			if (FORWARD_KEYS.has(code)) forward += 1;
			else if (BACK_KEYS.has(code)) forward -= 1;
			else if (RIGHT_KEYS.has(code)) strafe += 1;
			else if (LEFT_KEYS.has(code)) strafe -= 1;
			else if (RUN_KEYS.has(code)) running = true;
		}
		const jumpRequested = this._jumpRequested;
		const dodgeRequested = this._dodgeRequested;
		this._jumpRequested = false;
		this._dodgeRequested = false;
		return {
			forward: Math.max(-1, Math.min(1, forward)),
			strafe: Math.max(-1, Math.min(1, strafe)),
			running,
			jumpRequested,
			dodgeRequested,
		};
	}

	/** Removes listeners and clears held-key state. Call on teardown (memory-leak checklist). */
	dispose() {
		this._target.removeEventListener('keydown', this._onKeyDown);
		this._target.removeEventListener('keyup', this._onKeyUp);
		this._keys.clear();
		this._jumpRequested = false;
		this._dodgeRequested = false;
	}
}
