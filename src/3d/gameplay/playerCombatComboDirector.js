/**
 * Deterministic combo-chain policy for the existing player combat event pipeline.
 *
 * This module does not own input, timers, animation mixers, hitboxes, health, or scene state.
 * Callers pass the accepted combat action and elapsed time; player.js remains authoritative.
 * @module gameplay/playerCombatComboDirector
 */

const ACTIONS = Object.freeze(['light', 'heavy']);
const DEFAULTS = Object.freeze({
	maxSteps: 3,
	windowMs: 620,
	resetMs: 900,
	heavyFinisherStep: 3,
});

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeAction(action) {
	if (action === 'lightAttack') return 'light';
	if (action === 'heavyAttack') return 'heavy';
	return ACTIONS.includes(action) ? action : null;
}

function normalizeOptions(options = {}) {
	return {
		maxSteps: clamp(Math.floor(finite(options.maxSteps, DEFAULTS.maxSteps)), 1, 5),
		windowMs: clamp(finite(options.windowMs, DEFAULTS.windowMs), 100, 1500),
		resetMs: clamp(finite(options.resetMs, DEFAULTS.resetMs), 200, 2500),
		heavyFinisherStep: clamp(Math.floor(finite(options.heavyFinisherStep, DEFAULTS.heavyFinisherStep)), 1, 5),
	};
}

export function createPlayerCombatComboDirector(options = {}) {
	const config = normalizeOptions(options);
	let step = 0;
	let lastActionAt = null;
	let buffered = null;

	function reset() {
		step = 0;
		lastActionAt = null;
		buffered = null;
	}

	function accept(action, timestamp = 0) {
		const kind = normalizeAction(action);
		const now = finite(timestamp, 0);
		if (!kind) return Object.freeze({ accepted: false, reason: 'unsupported-action', step: 0, chainComplete: false, bufferedAction: null });
		if (lastActionAt !== null && now - lastActionAt > config.resetMs) step = 0;
		if (lastActionAt !== null && now - lastActionAt < 0) reset();
		step = Math.min(config.maxSteps, step + 1);
		lastActionAt = now;
		buffered = null;
		const chainComplete = step >= config.maxSteps || (kind === 'heavy' && step >= config.heavyFinisherStep);
		return Object.freeze({ accepted: true, action: kind, step, maxSteps: config.maxSteps, chainComplete, windowMs: config.windowMs, nextWindowEndsAt: now + config.windowMs, bufferedAction: null });
	}

	function buffer(action, timestamp = 0) {
		const kind = normalizeAction(action);
		const now = finite(timestamp, 0);
		if (!kind || lastActionAt === null || now - lastActionAt < 0 || now - lastActionAt > config.windowMs) {
			return Object.freeze({ buffered: false, reason: !kind ? 'unsupported-action' : 'outside-window', bufferedAction: null });
		}
		buffered = kind;
		return Object.freeze({ buffered: true, bufferedAction: buffered, expiresAt: lastActionAt + config.windowMs });
	}

	function snapshot(timestamp = 0) {
		const now = finite(timestamp, 0);
		const active = lastActionAt !== null && now - lastActionAt <= config.resetMs;
		return Object.freeze({ step: active ? step : 0, active, lastActionAt: active ? lastActionAt : null, bufferedAction: active ? buffered : null, resetAt: active && lastActionAt !== null ? lastActionAt + config.resetMs : null });
	}

	return Object.freeze({ accept, buffer, snapshot, reset, config: Object.freeze({ ...config }) });
}

export { normalizeAction as normalizePlayerCombatComboAction };
