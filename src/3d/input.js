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

function isInteractiveTarget(target) {
	return Boolean(target?.closest?.('button, a, input, textarea, select, [contenteditable="true"]'));
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
		this._gamepadLightHeld = false;
		this._gamepadHeavyHeld = false;
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

	_pollGamepadCombat() {
		const gamepad = globalThis.navigator?.getGamepads?.()?.find?.((candidate) => candidate?.connected) ?? globalThis.navigator?.getGamepads?.()?.[0] ?? null;
		const lightHeld = Boolean(gamepad?.buttons?.[0]?.pressed);
		const heavyHeld = Boolean(gamepad?.buttons?.[2]?.pressed);
		if (lightHeld && !this._gamepadLightHeld) emitPlayerCombatIntent('light', 'gamepad');
		if (heavyHeld && !this._gamepadHeavyHeld) emitPlayerCombatIntent('heavy', 'gamepad');
		this._gamepadLightHeld = lightHeld;
		this._gamepadHeavyHeld = heavyHeld;
	}

	getAxes() {
		this._pollGamepadCombat();
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
		return { forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)), running, jumpRequested, guarding };
	}

	dispose() {
		this._target.removeEventListener('keydown', this._onKeyDown);
		this._target.removeEventListener('keyup', this._onKeyUp);
		this._target.removeEventListener('pointerdown', this._onPointerDown);
		this._target.removeEventListener('pointerup', this._onPointerUp);
		this._target.removeEventListener('pointercancel', this._onPointerUp);
		this._target.removeEventListener('contextmenu', this._onContextMenu);
		this._keys.clear(); this._jumpRequested = false; this._guardPointerHeld = false; this._gamepadLightHeld = false; this._gamepadHeavyHeld = false;
	}
}
