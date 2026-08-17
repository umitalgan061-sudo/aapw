/**
 * Keyboard/mouse input state tracking for the playable third-person controller.
 * Direction/run/jump keep their existing contracts; guard is a held action shared by Q and the
 * secondary mouse button so combat never needs a second input framework.
 * @module input
 */

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP_KEYS = new Set(['Space']);
const GUARD_KEYS = new Set(['KeyQ']);
const GUARD_POINTER_BUTTON = 2;

export class KeyboardInput {
	/** @param {EventTarget} [target] Defaults to `window`. Passed explicitly so this stays testable. */
	constructor(target = window) {
		this._keys = new Set();
		this._jumpRequested = false;
		this._guardPointerHeld = false;
		this._target = target;
		this._onKeyDown = (event) => {
			if (JUMP_KEYS.has(event.code) && !this._keys.has(event.code)) this._jumpRequested = true;
			this._keys.add(event.code);
		};
		this._onKeyUp = (event) => this._keys.delete(event.code);
		this._onPointerDown = (event) => {
			if (event.button !== GUARD_POINTER_BUTTON) return;
			this._guardPointerHeld = true;
			event.preventDefault?.();
		};
		this._onPointerUp = (event) => {
			if (event.button !== GUARD_POINTER_BUTTON) return;
			this._guardPointerHeld = false;
		};
		this._onContextMenu = (event) => {
			if (this._guardPointerHeld) event.preventDefault?.();
		};
		target.addEventListener('keydown', this._onKeyDown);
		target.addEventListener('keyup', this._onKeyUp);
		target.addEventListener('pointerdown', this._onPointerDown);
		target.addEventListener('pointerup', this._onPointerUp);
		target.addEventListener('pointercancel', this._onPointerUp);
		target.addEventListener('contextmenu', this._onContextMenu);
	}

	/**
	 * @returns {{forward:number, strafe:number, running:boolean, jumpRequested:boolean, guarding:boolean}}
	 */
	getAxes() {
		let forward = 0;
		let strafe = 0;
		let running = false;
		let guarding = this._guardPointerHeld;
		for (const code of this._keys) {
			if (FORWARD_KEYS.has(code)) forward += 1;
			else if (BACK_KEYS.has(code)) forward -= 1;
			else if (RIGHT_KEYS.has(code)) strafe += 1;
			else if (LEFT_KEYS.has(code)) strafe -= 1;
			else if (RUN_KEYS.has(code)) running = true;
			else if (GUARD_KEYS.has(code)) guarding = true;
		}
		const jumpRequested = this._jumpRequested;
		this._jumpRequested = false;
		return {
			forward: Math.max(-1, Math.min(1, forward)),
			strafe: Math.max(-1, Math.min(1, strafe)),
			running,
			jumpRequested,
			guarding,
		};
	}

	/** Removes listeners and clears held/edge-triggered state. */
	dispose() {
		this._target.removeEventListener('keydown', this._onKeyDown);
		this._target.removeEventListener('keyup', this._onKeyUp);
		this._target.removeEventListener('pointerdown', this._onPointerDown);
		this._target.removeEventListener('pointerup', this._onPointerUp);
		this._target.removeEventListener('pointercancel', this._onPointerUp);
		this._target.removeEventListener('contextmenu', this._onContextMenu);
		this._keys.clear();
		this._jumpRequested = false;
		this._guardPointerHeld = false;
	}
}
