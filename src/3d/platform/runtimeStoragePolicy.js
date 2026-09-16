/**
 * Storage pressure policy.
 *
 * IndexedDB, Cache Storage and localStorage have different failure modes and quotas vary by browser.
 * This module treats storage as advisory capacity, never as guaranteed persistence, and exposes clear
 * rules for whether a runtime subsystem may write, compact, defer or operate memory-only.
 */

const STATES = Object.freeze({ UNKNOWN: 'unknown', HEALTHY: 'healthy', ELEVATED: 'elevated', CRITICAL: 'critical' });
const ACTIONS = Object.freeze({ WRITE: 'write', COMPACT: 'compact', DEFER: 'defer', MEMORY_ONLY: 'memory-only' });
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finiteOr(value, fallback) { return Number.isFinite(value) ? value : fallback; }

export function evaluateStoragePressure({ usageBytes, quotaBytes, persistent = false } = {}) {
	const quota = finiteOr(quotaBytes, 0);
	const usage = Math.max(0, finiteOr(usageBytes, 0));
	if (quota <= 0) return freeze({ version: 1, state: STATES.UNKNOWN, ratio: null, recommendedAction: ACTIONS.MEMORY_ONLY, usageBytes: usage, quotaBytes: null, persistent: persistent === true });
	const ratio = clamp(usage / quota, 0, 1);
	let state = STATES.HEALTHY;
	let recommendedAction = ACTIONS.WRITE;
	if (ratio >= 0.95) {
		state = STATES.CRITICAL;
		recommendedAction = ACTIONS.MEMORY_ONLY;
	} else if (ratio >= 0.85) {
		state = STATES.ELEVATED;
		recommendedAction = ACTIONS.DEFER;
	} else if (ratio >= 0.7) {
		state = STATES.ELEVATED;
		recommendedAction = ACTIONS.COMPACT;
	}
	return freeze({ version: 1, state, ratio: Number(ratio.toFixed(4)), recommendedAction, usageBytes: usage, quotaBytes: quota, persistent: persistent === true });
}

export function storageWriteAllowed(policy, { bytes = 0, critical = false } = {}) {
	const amount = Math.max(0, finiteOr(bytes, 0));
	if (!policy || policy.state === STATES.UNKNOWN) return critical;
	if (policy.state === STATES.CRITICAL) return critical && amount === 0;
	if (policy.state === STATES.ELEVATED) return critical || amount <= Math.max(1024 * 1024, (policy.quotaBytes ?? 0) * 0.01);
	return true;
}

export function createStorageBudget(policy, { baseBytes = 8 * 1024 * 1024 } = {}) {
	const base = Math.max(0, finiteOr(baseBytes, 0));
	const multiplier = policy?.state === STATES.HEALTHY ? 1 : policy?.state === STATES.ELEVATED ? 0.35 : 0;
	return freeze({ version: 1, budgetBytes: Math.round(base * multiplier), canPersistLargeAssets: policy?.state === STATES.HEALTHY, action: policy?.recommendedAction ?? ACTIONS.MEMORY_ONLY });
}

export function storagePolicyConstants() { return freeze({ states: STATES, actions: ACTIONS }); }
