/**
 * Keyboard/mouse/gamepad input state tracking for the playable third-person controller.
 * Direction/run/jump/guard keep their existing contracts. Melee attacks are edge-triggered combat
 * intents shared with touch so Player remains the single gameplay state machine.
 * @module input
 */

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP_KEYS = new Set(['Space']);
const GUARD_KEYS = new Set(['KeyQ']);
const LIGHT_ATTACK_KEYS = new Set(['KeyE']);
const HEAVY_ATTACK_KEYS = new Set(['KeyR']);
const GUARD_POINTER_BUTTON = 2;
const LIGHT_ATTACK_POINTER_BUTTON = 0;
const COMBAT_INPUT_EVENT = 'aapw:player-combat-input';
const GAMEPAD_DEADZONE = 0.18;
const GAMEPAD_BUTTON = Object.freeze({
	JUMP: 0,        // Xbox A / standard bottom face
	LIGHT: 2,       // Xbox X / standard left face
	HEAVY: 3,       // Xbox Y / standard top face
	GUARD: 4,       // LB / L1
	SPRINT: 10,     // left stick press
});

function isInteractiveTarget(target) {
	return Boolean(target?.closest?.('button, a, input, textarea, select, [contenteditable="true"]'));
}

function buttonPressed(gamepad, index) {
	return Boolean(gamepad?.buttons?.[index]?.pressed);
}

function applyGamepadDeadzone(value) {
	const numeric = Number.isFinite(value) ? value : 0;
	const magnitude = Math.abs(numeric);
	if (magnitude <= GAMEPAD_DEADZONE) return 0;
	const normalized = (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
	return Math.sign(numeric) * Math.min(1, normalized);
}

/**
 * Pure standard-gamepad sampler. The left stick maps onto the same forward/strafe axes as keyboard
 * and touch; buttons intentionally use the browser Standard Gamepad layout instead of maintaining
 * the old attack-only A/X mapping that prevented jump/guard/sprint parity.
 */
export function samplePlayerGamepad(gamepad, previousButtons = {}) {
	if (!gamepad?.connected) {
		return {
			forward: 0, strafe: 0, running: false, guarding: false,
			jumpPressed: false, lightPressed: false, heavyPressed: false,
			buttons: { jump: false, light: false, heavy: false },
		};
	}
	const jump = buttonPressed(gamepad, GAMEPAD_BUTTON.JUMP);
	const light = buttonPressed(gamepad, GAMEPAD_BUTTON.LIGHT);
	const heavy = buttonPressed(gamepad, GAMEPAD_BUTTON.HEAVY);
	return {
		forward: -applyGamepadDeadzone(gamepad.axes?.[1] ?? 0),
		strafe: applyGamepadDeadzone(gamepad.axes?.[0] ?? 0),
		running: buttonPressed(gamepad, GAMEPAD_BUTTON.SPRINT),
		guarding: buttonPressed(gamepad, GAMEPAD_BUTTON.GUARD),
		jumpPressed: jump && !previousButtons.jump,
		lightPressed: light && !previousButtons.light,
		heavyPressed: heavy && !previousButtons.heavy,
		buttons: { jump, light, heavy },
	};
}

export function emitPlayerCombatIntent(kind, source = 'unknown') {
	if ((kind !== 'light' && kind !== 'heavy') || typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return false;
	globalThis.dispatchEvent(new globalThis.CustomEvent(COMBAT_INPUT_EVENT, { detail: Object.freeze({ kind, source }) }));
	return true;
}

export class KeyboardInput {
	constructor(target = window) {
		this._keys = new Set();
		this._jumpRequested = false;
		this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, light: false, heavy: false };
		this._target = target;
		this._onKeyDown = (event) => {
			const firstPress = !this._keys.has(event.code);
			if (JUMP_KEYS.has(event.code) && firstPress) this._jumpRequested = true;
			if (firstPress && LIGHT_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('light', 'keyboard');
			if (firstPress && HEAVY_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('heavy', 'keyboard');
			this._keys.add(event.code);
		};
		this._onKeyUp = (event) => this._keys.delete(event.code);
		this._onPointerDown = (event) => {
			if (event.button === GUARD_POINTER_BUTTON) {
				this._guardPointerHeld = true;
				event.preventDefault?.();
				return;
			}
			if (event.button === LIGHT_ATTACK_POINTER_BUTTON && !isInteractiveTarget(event.target)) emitPlayerCombatIntent('light', 'mouse');
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

	_pollGamepad() {
		const pads = globalThis.navigator?.getGamepads?.() ?? [];
		const gamepad = Array.from(pads).find((candidate) => candidate?.connected) ?? null;
		const sample = samplePlayerGamepad(gamepad, this._gamepadButtons);
		if (sample.jumpPressed) this._jumpRequested = true;
		if (sample.lightPressed) emitPlayerCombatIntent('light', 'gamepad');
		if (sample.heavyPressed) emitPlayerCombatIntent('heavy', 'gamepad');
		this._gamepadButtons = sample.buttons;
		return sample;
	}

	getAxes() {
		const gamepad = this._pollGamepad();
		let forward = gamepad.forward;
		let strafe = gamepad.strafe;
		let running = gamepad.running;
		let guarding = this._guardPointerHeld || gamepad.guarding;
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
		return { forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)), running, jumpRequested, guarding };
	}

	dispose() {
		this._target.removeEventListener('keydown', this._onKeyDown);
		this._target.removeEventListener('keyup', this._onKeyUp);
		this._target.removeEventListener('pointerdown', this._onPointerDown);
		this._target.removeEventListener('pointerup', this._onPointerUp);
		this._target.removeEventListener('pointercancel', this._onPointerUp);
		this._target.removeEventListener('contextmenu', this._onContextMenu);
		this._keys.clear(); this._jumpRequested = false; this._guardPointerHeld = false; this._gamepadButtons = { jump: false, light: false, heavy: false };
	}
}
