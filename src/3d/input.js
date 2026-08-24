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
const LOCK_ON_KEYS = new Set(['Tab']);
const GUARD_POINTER_BUTTON = 2;
const LIGHT_ATTACK_POINTER_BUTTON = 0;
const COMBAT_INPUT_EVENT = 'aapw:player-combat-input';
const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const INPUT_DEVICE_EVENT = 'aapw:player-input-device';
const GAMEPAD_DEADZONE = 0.18;
const GAMEPAD_TRIGGER_DEADZONE = 0.08;
const GAMEPAD_SPRINT_MIN_MAGNITUDE = 0.72;
const GAMEPAD_SPRINT_RELEASE_MAGNITUDE = 0.55;
const GAMEPAD_DODGE_MIN_MAGNITUDE = 0.45;
const GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3;
const GAMEPAD_BUTTON = Object.freeze({
	JUMP: 0, DODGE: 1, LIGHT: 2, HEAVY: 3, GUARD: 4, PARRY: 5, ZOOM_OUT: 6, ZOOM_IN: 7, SPRINT: 10, LOCK_ON: 11,
	DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
});
const GAMEPAD_ACTION_HAPTICS = Object.freeze({
	dodge: Object.freeze({ duration: 45, weakMagnitude: 0.3, strongMagnitude: 0.55 }),
	parry: Object.freeze({ duration: 38, weakMagnitude: 0.18, strongMagnitude: 0.68 }),
	light: Object.freeze({ duration: 55, weakMagnitude: 0.22, strongMagnitude: 0.48 }),
	heavy: Object.freeze({ duration: 90, weakMagnitude: 0.38, strongMagnitude: 0.82 }),
});
const GAMEPAD_COMBAT_FEEDBACK_HAPTICS = Object.freeze({
	dodge: Object.freeze({ duration: 34, weakMagnitude: 0.1, strongMagnitude: 0.24 }),
	parry: Object.freeze({ duration: 72, weakMagnitude: 0.18, strongMagnitude: 0.86 }),
	guard: Object.freeze({ duration: 54, weakMagnitude: 0.34, strongMagnitude: 0.56 }),
	'guard-break': Object.freeze({ duration: 135, weakMagnitude: 0.58, strongMagnitude: 0.96 }),
	hit: Object.freeze({ duration: 78, weakMagnitude: 0.44, strongMagnitude: 0.74 }),
	'hit-stagger': Object.freeze({ duration: 128, weakMagnitude: 0.62, strongMagnitude: 0.92 }),
});

function isInteractiveTarget(target) { return Boolean(target?.closest?.('button, a, input, textarea, select, [contenteditable="true"]')); }
function buttonPressed(gamepad, index) { return Boolean(gamepad?.buttons?.[index]?.pressed); }
function buttonValue(gamepad, index) {
	const value = gamepad?.buttons?.[index]?.value;
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (buttonPressed(gamepad, index) ? 1 : 0);
}
export function applyGamepadTriggerDeadzone(value, deadzone = GAMEPAD_TRIGGER_DEADZONE) {
	const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
	if (normalized <= deadzone) return 0;
	return Math.min(1, (normalized - deadzone) / (1 - deadzone));
}
function readActionButtons(gamepad) {
	return {
		jump: buttonPressed(gamepad, GAMEPAD_BUTTON.JUMP),
		dodge: buttonPressed(gamepad, GAMEPAD_BUTTON.DODGE),
		light: buttonPressed(gamepad, GAMEPAD_BUTTON.LIGHT),
		heavy: buttonPressed(gamepad, GAMEPAD_BUTTON.HEAVY),
		parry: buttonPressed(gamepad, GAMEPAD_BUTTON.PARRY),
		lockOn: buttonPressed(gamepad, GAMEPAD_BUTTON.LOCK_ON),
	};
}

export function applyGamepadRadialDeadzone(x, y, deadzone = GAMEPAD_DEADZONE) {
	const nx = Number.isFinite(x) ? x : 0, ny = Number.isFinite(y) ? y : 0;
	const magnitude = Math.min(1, Math.hypot(nx, ny));
	if (magnitude <= deadzone || magnitude === 0) return { x: 0, y: 0, magnitude: 0 };
	const remappedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
	const scale = remappedMagnitude / Math.hypot(nx, ny);
	return { x: (nx * scale) || 0, y: (ny * scale) || 0, magnitude: remappedMagnitude };
}

function readGamepadDpad(gamepad) {
	const x = Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_RIGHT)) - Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_LEFT));
	const y = Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_DOWN)) - Number(buttonPressed(gamepad, GAMEPAD_BUTTON.DPAD_UP));
	const length = Math.hypot(x, y);
	if (length === 0) return { x: 0, y: 0, magnitude: 0 };
	return { x: x / length, y: y / length, magnitude: 1 };
}

export function resolveGamepadSprintIntent(magnitude, sprintPressed, wasRunning = false) {
	if (!sprintPressed) return false;
	const threshold = wasRunning ? GAMEPAD_SPRINT_RELEASE_MAGNITUDE : GAMEPAD_SPRINT_MIN_MAGNITUDE;
	return Number.isFinite(magnitude) && magnitude >= threshold;
}

export function selectPlayerGamepad(gamepads, preferredIndex = null) {
	const standard = Array.from(gamepads ?? []).filter((pad) => pad?.connected && pad.mapping === 'standard');
	if (preferredIndex !== null) { const sticky = standard.find((pad) => pad.index === preferredIndex); if (sticky) return sticky; }
	return standard.sort((a, b) => (a.index ?? 999) - (b.index ?? 999))[0] ?? null;
}

export function samplePlayerGamepad(gamepad, previousButtons = {}, previousRunning = false) {
	if (!gamepad?.connected || gamepad.mapping !== 'standard') return { forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0, lookMagnitude: 0, cameraZoom: 0, running: false, guarding: false, jumpPressed: false, dodgePressed: false, lightPressed: false, heavyPressed: false, parryPressed: false, lockOnPressed: false, buttons: { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false } };
	const stick = applyGamepadRadialDeadzone(gamepad.axes?.[0] ?? 0, gamepad.axes?.[1] ?? 0);
	const dpad = readGamepadDpad(gamepad), locomotion = stick.magnitude > 0 ? stick : dpad;
	const look = applyGamepadRadialDeadzone(gamepad.axes?.[2] ?? 0, gamepad.axes?.[3] ?? 0);
	const buttons = readActionButtons(gamepad);
	const zoomIn = applyGamepadTriggerDeadzone(buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_IN));
	const zoomOut = applyGamepadTriggerDeadzone(buttonValue(gamepad, GAMEPAD_BUTTON.ZOOM_OUT));
	return {
		forward: (-locomotion.y) || 0, strafe: locomotion.x, magnitude: locomotion.magnitude,
		lookX: look.x, lookY: look.y, lookMagnitude: look.magnitude,
		cameraZoom: zoomIn - zoomOut,
		running: resolveGamepadSprintIntent(locomotion.magnitude, buttonPressed(gamepad, GAMEPAD_BUTTON.SPRINT), previousRunning),
		guarding: buttonPressed(gamepad, GAMEPAD_BUTTON.GUARD),
		jumpPressed: buttons.jump && !previousButtons.jump,
		dodgePressed: buttons.dodge && !previousButtons.dodge,
		lightPressed: buttons.light && !previousButtons.light,
		heavyPressed: buttons.heavy && !previousButtons.heavy,
		parryPressed: buttons.parry && !previousButtons.parry,
		lockOnPressed: buttons.lockOn && !previousButtons.lockOn,
		buttons,
	};
}

function playGamepadHaptic(gamepad, profile) {
	const actuator = gamepad?.vibrationActuator;
	if (!profile || gamepad?.mapping !== 'standard' || !gamepad?.connected || typeof actuator?.playEffect !== 'function') return false;
	try { void Promise.resolve(actuator.playEffect('dual-rumble', { startDelay: 0, ...profile })).catch(() => {}); return true; } catch { return false; }
}
function readGamepadHapticProfile(profiles, kind) { return typeof kind === 'string' && Object.hasOwn(profiles, kind) ? profiles[kind] : null; }
function readCombatFeedbackAmount(value) { return Number.isFinite(value) && value > 0 ? value : 0; }
export function resolvePlayerCombatFeedbackHaptic(feedback) {
	const outcome = feedback?.outcome, profile = readGamepadHapticProfile(GAMEPAD_COMBAT_FEEDBACK_HAPTICS, outcome);
	if (!profile) return null;
	const appliedAmount = readCombatFeedbackAmount(feedback?.appliedAmount), blockedAmount = readCombatFeedbackAmount(feedback?.blockedAmount);
	if ((outcome === 'dodge' || outcome === 'parry' || outcome === 'guard') && blockedAmount <= 0) return null;
	if ((outcome === 'hit' || outcome === 'hit-stagger') && appliedAmount <= 0) return null;
	if (outcome === 'guard-break' && appliedAmount <= 0 && blockedAmount <= 0) return null;
	return profile;
}
export function pulsePlayerGamepadAction(gamepad, kind) { return playGamepadHaptic(gamepad, readGamepadHapticProfile(GAMEPAD_ACTION_HAPTICS, kind)); }
export function pulsePlayerGamepadMelee(gamepad, kind) { return pulsePlayerGamepadAction(gamepad, kind); }
export function pulsePlayerGamepadCombatFeedback(gamepad, feedback) { return playGamepadHaptic(gamepad, resolvePlayerCombatFeedbackHaptic(feedback)); }

export function emitPlayerCombatIntent(kind, source = 'unknown') {
	if ((kind !== 'light' && kind !== 'heavy') || typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return false;
	globalThis.dispatchEvent(new globalThis.CustomEvent(COMBAT_INPUT_EVENT, { detail: Object.freeze({ kind, source }) })); return true;
}
function emitInputDeviceChange(index, reason) {
	if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
	globalThis.dispatchEvent(new globalThis.CustomEvent(INPUT_DEVICE_EVENT, { detail: Object.freeze({ device: index === null ? 'keyboard-pointer' : 'gamepad', gamepadIndex: index, reason }) }));
}

export class KeyboardInput {
	constructor(target = window) {
		this._keys = new Set(); this._jumpRequested = false; this._lockOnRequested = false; this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null; this._lastCombatFeedbackSerial = 0; this._target = target;
		this._onKeyDown = (event) => {
			const firstPress = !this._keys.has(event.code);
			if (JUMP_KEYS.has(event.code) && firstPress) this._jumpRequested = true;
			if (firstPress && LOCK_ON_KEYS.has(event.code) && !isInteractiveTarget(event.target)) { this._lockOnRequested = true; event.preventDefault?.(); }
			if (firstPress && LIGHT_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('light', 'keyboard');
			if (firstPress && HEAVY_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('heavy', 'keyboard');
			this._keys.add(event.code);
		};
		this._onKeyUp = (event) => this._keys.delete(event.code);
		this._onPointerDown = (event) => { if (event.button === GUARD_POINTER_BUTTON) { this._guardPointerHeld = true; event.preventDefault?.(); return; } if (event.button === LIGHT_ATTACK_POINTER_BUTTON && !isInteractiveTarget(event.target)) emitPlayerCombatIntent('light', 'mouse'); };
		this._onPointerUp = (event) => { if (event.button === GUARD_POINTER_BUTTON) this._guardPointerHeld = false; };
		this._onContextMenu = (event) => { if (this._guardPointerHeld) event.preventDefault?.(); };
		this._onCombatFeedback = (event) => {
			const detail = event?.detail, serial = detail?.serial;
			if (!Number.isSafeInteger(serial) || serial <= 0 || serial <= this._lastCombatFeedbackSerial) return;
			const pads = globalThis.navigator?.getGamepads?.() ?? [], gamepad = selectPlayerGamepad(pads, this._activeGamepadIndex);
			if (!gamepad || gamepad.index !== this._activeGamepadIndex) return;
			if (pulsePlayerGamepadCombatFeedback(gamepad, detail)) this._lastCombatFeedbackSerial = serial;
		};
		this._onFocusLoss = (event) => {
			const hadActiveInput = this._keys.size > 0 || this._jumpRequested || this._lockOnRequested || this._guardPointerHeld || this._activeGamepadIndex !== null;
			this._keys.clear(); this._jumpRequested = false; this._lockOnRequested = false; this._guardPointerHeld = false; this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null;
			if (hadActiveInput) emitInputDeviceChange(null, event?.type === 'pagehide' ? 'page-hidden' : event?.type === 'visibilitychange' ? 'visibility-hidden' : 'focus-lost');
		};
		this._onVisibilityChange = () => { if (this._target?.hidden === true || globalThis.document?.hidden === true) this._onFocusLoss({ type: 'visibilitychange' }); };
		for (const [type, handler] of [['keydown', this._onKeyDown], ['keyup', this._onKeyUp], ['pointerdown', this._onPointerDown], ['pointerup', this._onPointerUp], ['pointercancel', this._onPointerUp], ['contextmenu', this._onContextMenu], [COMBAT_FEEDBACK_EVENT, this._onCombatFeedback], ['blur', this._onFocusLoss], ['pagehide', this._onFocusLoss], ['visibilitychange', this._onVisibilityChange]]) target.addEventListener(type, handler);
	}
	_pollGamepad() {
		const pads = globalThis.navigator?.getGamepads?.() ?? [], gamepad = selectPlayerGamepad(pads, this._activeGamepadIndex), nextIndex = gamepad?.index ?? null, switched = nextIndex !== this._activeGamepadIndex;
		const nowSeconds = (globalThis.performance?.now?.() ?? Date.now()) / 1000, lookDeltaSeconds = this._lastPollSeconds === null ? 0 : Math.max(0, Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, nowSeconds - this._lastPollSeconds)); this._lastPollSeconds = nowSeconds;
		if (switched) { this._gamepadButtons = gamepad ? readActionButtons(gamepad) : { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = nextIndex; emitInputDeviceChange(nextIndex, gamepad ? 'selected' : 'disconnected'); }
		const sample = samplePlayerGamepad(gamepad, this._gamepadButtons, this._gamepadSprintActive);
		if (!switched) {
			if (sample.jumpPressed) this._jumpRequested = true;
			if (sample.lockOnPressed) this._lockOnRequested = true;
			if (sample.dodgePressed && sample.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE) pulsePlayerGamepadAction(gamepad, 'dodge');
			if (sample.parryPressed) pulsePlayerGamepadAction(gamepad, 'parry');
			if (sample.lightPressed) { emitPlayerCombatIntent('light', 'gamepad'); pulsePlayerGamepadAction(gamepad, 'light'); }
			if (sample.heavyPressed) { emitPlayerCombatIntent('heavy', 'gamepad'); pulsePlayerGamepadAction(gamepad, 'heavy'); }
		}
		this._gamepadButtons = sample.buttons; this._gamepadSprintActive = sample.running; return { ...sample, lookDeltaSeconds };
	}
	getAxes() {
		const gamepad = this._pollGamepad(); let forward = gamepad.forward, strafe = gamepad.strafe, running = gamepad.running, guarding = this._guardPointerHeld || gamepad.guarding;
		for (const code of this._keys) { if (FORWARD_KEYS.has(code)) forward += 1; else if (BACK_KEYS.has(code)) forward -= 1; else if (RIGHT_KEYS.has(code)) strafe += 1; else if (LEFT_KEYS.has(code)) strafe -= 1; else if (RUN_KEYS.has(code)) running = true; else if (GUARD_KEYS.has(code)) guarding = true; }
		const dodgeRequested = gamepad.dodgePressed && gamepad.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE;
		if (dodgeRequested) running = true;
		if (gamepad.parryPressed) guarding = true;
		const jumpRequested = this._jumpRequested;
		this._jumpRequested = false;
		return { forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)), running, jumpRequested: jumpRequested || dodgeRequested, lockOnRequested: this._lockOnRequested, guarding, lookX: gamepad.lookX, lookY: gamepad.lookY, cameraZoom: gamepad.cameraZoom, lookDeltaSeconds: gamepad.lookDeltaSeconds };
	}
	consumeLockOnRequested() { const requested = this._lockOnRequested; this._lockOnRequested = false; return requested; }
	dispose() {
		for (const [type, handler] of [['keydown', this._onKeyDown], ['keyup', this._onKeyUp], ['pointerdown', this._onPointerDown], ['pointerup', this._onPointerUp], ['pointercancel', this._onPointerUp], ['contextmenu', this._onContextMenu], [COMBAT_FEEDBACK_EVENT, this._onCombatFeedback], ['blur', this._onFocusLoss], ['pagehide', this._onFocusLoss], ['visibilitychange', this._onVisibilityChange]]) this._target.removeEventListener(type, handler);
		this._keys.clear(); this._jumpRequested = false; this._lockOnRequested = false; this._guardPointerHeld = false; this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false, lockOn: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null; this._lastCombatFeedbackSerial = 0;
	}
}
