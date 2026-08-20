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
const GAMEPAD_TRIGGER_DEADZONE = 0.08;
// Intentional actions get a second threshold above the hardware-noise deadzone. A worn controller
// may sit just outside 0.18 while untouched; that must never drain sprint stamina or turn B/Circle
// into a directional dodge. Sprint uses hysteresis so noisy input around the activation threshold
// cannot flap the Player state every frame once a deliberate sprint is already underway.
const GAMEPAD_SPRINT_MIN_MAGNITUDE = 0.72;
const GAMEPAD_SPRINT_RELEASE_MAGNITUDE = 0.55;
const GAMEPAD_DODGE_MIN_MAGNITUDE = 0.45;
// Preserve camera angular speed during transient low-FPS frames without allowing a long suspended
// tab interval to create an unbounded snap. blur/pagehide/visibility-hidden reset the poll clock.
const GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3;
const GAMEPAD_BUTTON = Object.freeze({
	JUMP: 0, DODGE: 1, LIGHT: 2, HEAVY: 3, GUARD: 4, PARRY: 5, ZOOM_OUT: 6, ZOOM_IN: 7, SPRINT: 10,
	DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
});
const GAMEPAD_ACTION_HAPTICS = Object.freeze({
	dodge: Object.freeze({ duration: 45, weakMagnitude: 0.3, strongMagnitude: 0.55 }),
	parry: Object.freeze({ duration: 38, weakMagnitude: 0.18, strongMagnitude: 0.68 }),
	light: Object.freeze({ duration: 55, weakMagnitude: 0.22, strongMagnitude: 0.48 }),
	heavy: Object.freeze({ duration: 90, weakMagnitude: 0.38, strongMagnitude: 0.82 }),
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
	if (!gamepad?.connected || gamepad.mapping !== 'standard') return { forward: 0, strafe: 0, magnitude: 0, lookX: 0, lookY: 0, lookMagnitude: 0, cameraZoom: 0, running: false, guarding: false, jumpPressed: false, dodgePressed: false, lightPressed: false, heavyPressed: false, parryPressed: false, buttons: { jump: false, dodge: false, light: false, heavy: false, parry: false } };
	const stick = applyGamepadRadialDeadzone(gamepad.axes?.[0] ?? 0, gamepad.axes?.[1] ?? 0);
	// D-pad is a digital accessibility fallback, not an extra force vector. A live analog stick wins
	// so pressing a D-pad direction cannot accelerate, cancel or skew an intentional stick vector.
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
		buttons,
	};
}

export function pulsePlayerGamepadAction(gamepad, kind) {
	const profile = GAMEPAD_ACTION_HAPTICS[kind], actuator = gamepad?.vibrationActuator;
	if (!profile || gamepad?.mapping !== 'standard' || !gamepad?.connected || typeof actuator?.playEffect !== 'function') return false;
	try { void Promise.resolve(actuator.playEffect('dual-rumble', { startDelay: 0, ...profile })).catch(() => {}); return true; } catch { return false; }
}
export function pulsePlayerGamepadMelee(gamepad, kind) { return pulsePlayerGamepadAction(gamepad, kind); }

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
		this._keys = new Set(); this._jumpRequested = false; this._guardPointerHeld = false;
		this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null; this._target = target;
		this._onKeyDown = (event) => { const firstPress = !this._keys.has(event.code); if (JUMP_KEYS.has(event.code) && firstPress) this._jumpRequested = true; if (firstPress && LIGHT_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('light', 'keyboard'); if (firstPress && HEAVY_ATTACK_KEYS.has(event.code)) emitPlayerCombatIntent('heavy', 'keyboard'); this._keys.add(event.code); };
		this._onKeyUp = (event) => this._keys.delete(event.code);
		this._onPointerDown = (event) => { if (event.button === GUARD_POINTER_BUTTON) { this._guardPointerHeld = true; event.preventDefault?.(); return; } if (event.button === LIGHT_ATTACK_POINTER_BUTTON && !isInteractiveTarget(event.target)) emitPlayerCombatIntent('light', 'mouse'); };
		this._onPointerUp = (event) => { if (event.button === GUARD_POINTER_BUTTON) this._guardPointerHeld = false; };
		this._onContextMenu = (event) => { if (this._guardPointerHeld) event.preventDefault?.(); };
		this._onFocusLoss = (event) => {
			const hadActiveInput = this._keys.size > 0 || this._jumpRequested || this._guardPointerHeld || this._activeGamepadIndex !== null;
			this._keys.clear(); this._jumpRequested = false; this._guardPointerHeld = false; this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null;
			if (hadActiveInput) emitInputDeviceChange(null, event?.type === 'pagehide' ? 'page-hidden' : event?.type === 'visibilitychange' ? 'visibility-hidden' : 'focus-lost');
		};
		this._onVisibilityChange = () => { if (this._target?.hidden === true || globalThis.document?.hidden === true) this._onFocusLoss({ type: 'visibilitychange' }); };
		for (const [type, handler] of [['keydown', this._onKeyDown], ['keyup', this._onKeyUp], ['pointerdown', this._onPointerDown], ['pointerup', this._onPointerUp], ['pointercancel', this._onPointerUp], ['contextmenu', this._onContextMenu], ['blur', this._onFocusLoss], ['pagehide', this._onFocusLoss], ['visibilitychange', this._onVisibilityChange]]) target.addEventListener(type, handler);
	}
	_pollGamepad() {
		const pads = globalThis.navigator?.getGamepads?.() ?? [], gamepad = selectPlayerGamepad(pads, this._activeGamepadIndex), nextIndex = gamepad?.index ?? null, switched = nextIndex !== this._activeGamepadIndex;
		const nowSeconds = (globalThis.performance?.now?.() ?? Date.now()) / 1000, lookDeltaSeconds = this._lastPollSeconds === null ? 0 : Math.max(0, Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, nowSeconds - this._lastPollSeconds)); this._lastPollSeconds = nowSeconds;
		if (switched) { this._gamepadButtons = gamepad ? readActionButtons(gamepad) : { jump: false, dodge: false, light: false, heavy: false, parry: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = nextIndex; emitInputDeviceChange(nextIndex, gamepad ? 'selected' : 'disconnected'); }
		const sample = samplePlayerGamepad(gamepad, this._gamepadButtons, this._gamepadSprintActive);
		if (!switched) {
			if (sample.jumpPressed) this._jumpRequested = true;
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
		// B/Circle is a one-frame adapter into Player's existing run+jump dodge request. Requiring a
		// deliberate post-deadzone magnitude prevents worn-stick drift from spending dodge stamina.
		const dodgeRequested = gamepad.dodgePressed && gamepad.magnitude >= GAMEPAD_DODGE_MIN_MAGNITUDE;
		if (dodgeRequested) running = true;
		// RB/R1 is a one-frame adapter into Player's existing guard rising-edge contract. Player owns
		// the parry window/timing/stamina rules; input only supplies the same transient guard edge.
		if (gamepad.parryPressed) guarding = true;
		const jumpRequested = this._jumpRequested || dodgeRequested; this._jumpRequested = false;
		return { forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)), running, jumpRequested, guarding, lookX: gamepad.lookX, lookY: gamepad.lookY, cameraZoom: gamepad.cameraZoom, lookDeltaSeconds: gamepad.lookDeltaSeconds };
	}
	dispose() {
		for (const [type, handler] of [['keydown', this._onKeyDown], ['keyup', this._onKeyUp], ['pointerdown', this._onPointerDown], ['pointerup', this._onPointerUp], ['pointercancel', this._onPointerUp], ['contextmenu', this._onContextMenu], ['blur', this._onFocusLoss], ['pagehide', this._onFocusLoss], ['visibilitychange', this._onVisibilityChange]]) this._target.removeEventListener(type, handler);
		this._keys.clear(); this._jumpRequested = false; this._guardPointerHeld = false; this._gamepadButtons = { jump: false, dodge: false, light: false, heavy: false, parry: false }; this._gamepadSprintActive = false; this._activeGamepadIndex = null; this._lastPollSeconds = null;
	}
}
