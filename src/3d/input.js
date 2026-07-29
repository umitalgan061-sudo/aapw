/**
 * Keyboard input state tracking (WASD/arrow keys + Shift-to-run) — core infrastructure any future
 * gameplay system can read directional input from. Deliberately camera-agnostic: `getAxes()`
 * returns input-local forward/strafe values, not a world-space direction — callers combine that
 * with their own camera facing (see `gameplay/player.js` / `game3d.js`).
 *
 * Touch/joystick input (FAZ 4's other input requirement, for mobile) is a separate, not-yet-built
 * concern — this module intentionally covers keyboard only. See 3D_GAME_PROGRESS.md.
 * @module input
 */

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

export class KeyboardInput {
	/** @param {EventTarget} [target] Defaults to `window`. Passed explicitly so this stays testable. */
	constructor(target = window) {
		this._keys = new Set();
		this._target = target;
		this._onKeyDown = (event) => this._keys.add(event.code);
		this._onKeyUp = (event) => this._keys.delete(event.code);
		target.addEventListener('keydown', this._onKeyDown);
		target.addEventListener('keyup', this._onKeyUp);
	}

	/**
	 * @returns {{forward: number, strafe: number, running: boolean}} `forward`/`strafe` are each
	 *   -1, 0, or 1 (input-local — positive forward is "the key the player pressed for forward",
	 *   not a world-space axis). `running` is true while any Shift key is held.
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
		return {
			forward: Math.max(-1, Math.min(1, forward)),
			strafe: Math.max(-1, Math.min(1, strafe)),
			running,
		};
	}

	/** Removes listeners and clears held-key state. Call on teardown (memory-leak checklist). */
	dispose() {
		this._target.removeEventListener('keydown', this._onKeyDown);
		this._target.removeEventListener('keyup', this._onKeyUp);
		this._keys.clear();
	}
}
