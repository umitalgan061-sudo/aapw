/**
 * Kızıl Ufuk — camera look/shoulder input parity normalization.
 *
 * Existing player input producers keep ownership of keyboard, mouse, gamepad and touch gestures.
 * This module only normalizes their camera-facing payloads into the same bounded vocabulary consumed
 * by PlayerCombatCameraIntentDirector. It does not register listeners or prevent existing gameplay
 * input handlers from seeing their events.
 *
 * @module gameplay/playerCombatCameraInputParity
 */

const VERSION = 1;
const DEADZONE = 0.08;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, precision = 4) => {
	const factor = 10 ** precision;
	return Math.round(finite(value) * factor) / factor;
};

function deadzone(value, threshold = DEADZONE) {
	const bounded = clamp(value, -1, 1);
	const magnitude = Math.abs(bounded);
	if (magnitude <= threshold) return 0;
	return Math.sign(bounded) * clamp((magnitude - threshold) / Math.max(0.0001, 1 - threshold), 0, 1);
}

function normalizeLook(value) {
	return Object.freeze({ x: round(deadzone(value?.x)), y: round(deadzone(value?.y)) });
}

function normalizeTouchDelta(delta, sensitivity = 0.0125) {
	return Object.freeze({
		x: round(clamp(finite(delta?.x) * sensitivity, -1, 1)),
		y: round(clamp(finite(delta?.y) * sensitivity, -1, 1)),
	});
}

function normalizeMouseDelta(delta, width = 1920, height = 1080) {
	return Object.freeze({
		x: round(clamp(finite(delta?.x) / Math.max(1, width) * 8, -1, 1)),
		y: round(clamp(finite(delta?.y) / Math.max(1, height) * 8, -1, 1)),
	});
}

function normalizeGamepadAxes(axes) {
	return normalizeLook({ x: finite(axes?.x), y: finite(axes?.y) });
}

export function normalizePlayerCameraLookInput(source, payload = {}, options = {}) {
	const family = source === 'mouse' || source === 'gamepad' || source === 'touch' || source === 'keyboard' || source === 'pwa' ? source : 'unknown';
	let look;
	if (family === 'touch') look = normalizeTouchDelta(payload, finite(options.touchSensitivity, 0.0125));
	else if (family === 'mouse') look = normalizeMouseDelta(payload, finite(options.viewportWidth, 1920), finite(options.viewportHeight, 1080));
	else if (family === 'gamepad') look = normalizeGamepadAxes(payload);
	else look = normalizeLook(payload);
	return Object.freeze({ version: VERSION, family, ...look });
}

export function normalizeShoulderInput(value) {
	if (value === true || value === 'left' || finite(value) < 0) return -1;
	if (value === false || value === 'right') return 1;
	return 1;
}

export function normalizeLockOnIntent(payload = {}) {
	return Object.freeze({
		requested: Boolean(payload.requested ?? payload.enabled),
		reacquire: Boolean(payload.reacquire),
		preserveTarget: Boolean(payload.preserveTarget),
	});
}

export function buildCameraInputParityFrame({ source, payload, shoulder, lockOn, timestampMs = 0 } = {}) {
	const normalized = normalizePlayerCameraLookInput(source, payload);
	const frame = Object.freeze({
		version: VERSION,
		family: normalized.family,
		look: Object.freeze({ x: normalized.x, y: normalized.y }),
		shoulderSign: normalizeShoulderInput(shoulder),
		lockOn: normalizeLockOnIntent(lockOn),
		timestampMs: Math.max(0, Math.floor(finite(timestampMs))),
	});
	return frame;
}

export function compareEquivalentCameraInputs(inputs) {
	if (!Array.isArray(inputs) || inputs.length === 0) return Object.freeze({ equivalent: true, maxDelta: 0, count: 0 });
	const baseline = inputs[0];
	let maxDelta = 0;
	for (const input of inputs.slice(1)) {
		maxDelta = Math.max(maxDelta, Math.abs(input.look.x - baseline.look.x), Math.abs(input.look.y - baseline.look.y), Math.abs(input.shoulderSign - baseline.shoulderSign));
	}
	return Object.freeze({ equivalent: maxDelta <= 0.12, maxDelta: round(maxDelta), count: inputs.length });
}

export function sanitizeCameraGestureVelocity(velocity, maxUnitsPerSecond = 8) {
	const x = clamp(finite(velocity?.x), -maxUnitsPerSecond, maxUnitsPerSecond);
	const y = clamp(finite(velocity?.y), -maxUnitsPerSecond, maxUnitsPerSecond);
	const z = clamp(finite(velocity?.z), -maxUnitsPerSecond, maxUnitsPerSecond);
	return Object.freeze({ x: round(x), y: round(y), z: round(z) });
}

export function cameraInputParitySummary(frames) {
	const rows = Array.isArray(frames) ? frames : [];
	const families = [...new Set(rows.map((frame) => frame.family))].sort();
	const lockOnFrames = rows.filter((frame) => frame.lockOn.requested).length;
	const leftFrames = rows.filter((frame) => frame.shoulderSign < 0).length;
	const rightFrames = rows.filter((frame) => frame.shoulderSign > 0).length;
	const finiteFrames = rows.filter((frame) => [frame.look.x, frame.look.y, frame.timestampMs].every(Number.isFinite)).length;
	return Object.freeze({
		version: VERSION,
		frameCount: rows.length,
		families: Object.freeze(families),
		lockOnFrames,
		leftFrames,
		rightFrames,
		finiteFrames,
		parityReady: rows.length === finiteFrames && families.length > 0,
	});
}

export const PLAYER_CAMERA_INPUT_PARITY_VERSION = VERSION;
export const __testing = Object.freeze({ deadzone, normalizeLook, normalizeTouchDelta, normalizeMouseDelta, normalizeGamepadAxes });
