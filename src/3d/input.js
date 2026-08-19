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
const INPUT_DEVICE_EVENT = 'aapw:player-input-device';
const GAMEPAD_DEADZONE = 0.18;
const GAMEPAD_BUTTON = Object.freeze({
	JUMP: 0,
	LIGHT: 2,
	HEAVY: 3,
	GUARD: 4,
	ZOOM_OUT: 6,
	ZOOM_IN: 7,
	SPRINT: 10,
});
const GAMEPAD_MELEE_HAPTICS = Object.freeze({
	light: Object.freeze({ duration: 55, weakMagnitude: 0.22, strongMagnitude: 0.48 }),
	heavy: Object.freeze({ duration: 90, weakMagnitude: 0.38, strongMagnitude: 0.82 }),
});

function isInteractiveTarget(target) {
	return Boolean(target?.closest?.('button, a, input, textarea, select, [contenteditable="true"]'));
}
function buttonPressed(gamepad, index) { return Boolean(gamepad?.buttons?.[index]?.pressed); }
function buttonValue(gamepad, index) {
	const value = gamepad?.buttons?.[index]?.value;
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (buttonPressed(gamepad, index) ? 1 : 0);
}
function readActionButtons(gamepad) {
	return { jump: buttonPressed(gamepad, GAMEPAD_BUTTON.JUMP), light: buttonPressed(gamepad, GAMEPAD_BUTTON.LIGHT), heavy: buttonPressed(gamepad, GAMEPAD_BUTTON.HEAVY) };
}

export function applyGamepadRadialDeadzone(x, y, deadzone = GAMEPAD_DEADZONE) {
	const nx = Number.isFinite(x) ? x : 0;
	const ny = Number.isFinite(y) ? y : 0;
	const magnitude = Math.min(1, Math.hypot(nx, ny));
	if (magnitude <= deadzone || magnitude === 0) return { x: 0, y: 0, magnitude: 0 };
	const remappedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
	const scale = remappedMagnitude / Math.hypot(nx, ny);
	return { x: (nx * scale) || 0, y: (ny * scale) || 0, magnitude: remappedMagnitude };
}

export function selectPlayerGamepad(gamepads, preferredIndex = null) {
	const standard = Array.from(gamepads ?? []).filter((pad) => pad?.connected && pad.mapping === 'standard');
	if (preferredIndex !== null) {
		const sticky = standard.find((pad) => pad.index === preferredIndex);
		if (sticky) return sticky;
	}
	return standard.sort((a, b) => (a.index ?? 999) - (b.index ?? 999))[0] ?? null;
}

export function samplePlayerGamepad(gamepad, previousButtons = {}) {
	if (!gamepad?.connected || gamepad.mapping !== 'standard') {
		return {
			forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0, lookMagnitude: 0, cameraZoom: 0,
			running: false, guarding: false, jumpPressed: false, lightPressed: false, heavyPressed: false,
			buttons: { jump: false, light: false, heavy: false },
		};
	}
	const stick = applyGamepadRadialDeadzone(gamepad.axes?.[0] ?? 0, gamepad.axes?.[1] ?? 0);
	const look = applyGamepadRadialDeadzone(gamepad.axes?.[2] ?? 0, gamepad.axes?.[3] ?? 0);
	const buttons = readActionButtons(gamepad);
	return {
		forward: (-stick.y) || 0,
		strafe: stick.x,
		magnitude: stick.magnitude,
		lookX: look.x,
		lookY: look.y,
		lookMagnitude: look.magnitude,
		cameraZoom: buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_IN) - buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_OUT),
		running: buttonPressed(gamepad, GAMEPAD_BUTTON.SPRINT),
		guarding: buttonPressed(gamepad, GAMEPAD_BUTTON.GUARD),
		jumpPressed: buttons.jump && !previousButtons.jump,
		lightPressed: buttons.light && !previousButtons.light,
		heavyPressed: buttons.heavy && !previousButtons.heavy,
		buttons,
	};
}

export function pulsePlayerGamepadMelee(gamepad, kind) {
	const profile = GAMEPAD_MELEE_HAPTICS[kind];
	const actuator = gamepad?.vibrationActuator;
	if (!profile || gamepad?.mapping !== 'standard' || !gamepad?.connected || typeof actuator?.playEffect !== 'function') return false;
	try {
		void Promise.resolve(actuator.playEffect('dual-rumble', { startDelay: 0, ...profile })).catch(() => {});
		return true;
	} catch {
		return false;
	}
}

export function emitPlayerCombatIntent(kind, source = 'unknown') {
	if ((kind !== 'light' && kind !== 'heavy') || typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return false;
	globalThis.dispatchEvent(new globalThis.CustomEvent(COMBAT_INPUT_EVENT, { detail: Object.freeze({ kind, source }) }));
	return true;
}

function emitInputDeviceChange(index, reason) {
	if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
	globalThis.dispatchEvent(new globalThis.CustomEvent(INPUT_DEVICE_EVENT, { detail: Object.freeze({ device: index === null ? 'keyboard-pointer' : 'gamepad', gamepadIndex: index, reason }) }));
}

export class KeyboardInput {
	constructor(target = window) {
		this._keys = new Set();
		this._jumpRequested = false;
		this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, light: false, heavy: false };
		this._activeGamepadIndex = null;
		this._lastPollSeconds = null;
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
			if (event.button === GUARD_POINTER_BUTTON) { this._guardPointerHeld = true; event.preventDefault?.(); return; }
			if (event.button === LIGHT_ATTACK_POINTER_BUTTON && !isInteractiveTarget(event.target)) emitPlayerCombatIntent('light', 'mouse');
		};
		this._onPointerUp = (event) => { if (event.button === GUARD_POINTER_BUTTON) this._guardPointerHeld = false; };
		this._onContextMenu = (event) => { if (this._guardPointerHeld) event.preventDefault?.(); };
		this._onFocusLoss = (event) => {
			const hadActiveInput = this._keys.size > 0 || this._jumpRequested || this._guardPointerHeld || this._activeGamepadIndex !== null;
			this._keys.clear();
			this._jumpRequested = false;
			this._guardPointerHeld = false;
			this._gamepadButtons = { jump: false, light: false, heavy: false };
			this._activeGamepadIndex = null;
			this._lastPollSeconds = null;
			if (hadActiveInput) emitInputDeviceChange(null, event?.type === 'pagehide' ? 'page-hidden' : 'focus-lost');
		};
		target.addEventListener('keydown', this._onKeyDown);
		target.addEventListener('keyup', this._onKeyUp);
		target.addEventListener('pointerdown', this._onPointerDown);
		target.addEventListener('pointerup', this._onPointerUp);
		target.addEventListener('pointercancel', this._onPointerUp);
		target.addEventListener('contextmenu', this._onContextMenu);
		target.addEventListener('blur', this._onFocusLoss);
		target.addEventListener('pagehide', this._onFocusLoss);
	}

	_pollGamepad() {
		const pads = globalThis.navigator?.getGamepads?.() ?? [];
		const gamepad = selectPlayerGamepad(pads, this._activeGamepadIndex);
		const nextIndex = gamepad?.index ?? null;
		const switched = nextIndex !== this._activeGamepadIndex;
		const nowSeconds = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
		const lookDeltaSeconds = this._lastPollSeconds === null ? 0 : Math.max(0, Math.min(0.05, nowSeconds - this._lastPollSeconds));
		this._lastPollSeconds = nowSeconds;
		if (switched) {
			this._gamepadButtons = gamepad ? readActionButtons(gamepad) : { jump: false, light: false, heavy: false };
			this._activeGamepadIndex = nextIndex;
			emitInputDeviceChange(nextIndex, gamepad ? 'selected' : 'disconnected');
		}
		const sample = samplePlayerGamepad(gamepad, this._gamepadButtons);
		if (!switched) {
			if (sample.jumpPressed) this._jumpRequested = true;
			if (sample.lightPressed) { emitPlayerCombatIntent('light', 'gamepad'); pulsePlayerGamepadMelee(gamepad, 'light'); }
			if (sample.heavyPressed) { emitPlayerCombatIntent('heavy', 'gamepad'); pulsePlayerGamepadMelee(gamepad, 'heavy'); }
		}
		this._gamepadButtons = sample.buttons;
		return { ...sample, lookDeltaSeconds };
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
		return {
			forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)),
			running, jumpRequested, guarding,
			lookX: gamepad.lookX, lookY: gamepad.lookY, cameraZoom: gamepad.cameraZoom, lookDeltaSeconds: gamepad.lookDeltaSeconds,
		};
	}

	dispose() {
		this._target.removeEventListener('keydown', this._onKeyDown);
		this._target.removeEventListener('keyup', this._onKeyUp);
		this._target.removeEventListener('pointerdown', this._onPointerDown);
		this._target.removeEventListener('pointerup', this._onPointerUp);
		this._target.removeEventListener('pointercancel', this._onPointerUp);
		this._target.removeEventListener('contextmenu', this._onContextMenu);
		this._target.removeEventListener('blur', this._onFocusLoss);
		this._target.removeEventListener('pagehide', this._onFocusLoss);
		this._keys.clear();
		this._jumpRequested = false;
		this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, light: false, heavy: false };
		this._activeGamepadIndex = null;
		this._lastPollSeconds = null;
	}
}