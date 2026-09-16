/**
 * Bounded asset-loading policy.
 *
 * The asset loader remains the sole loader/decoder owner. This module only determines whether a request
 * should be admitted, deferred, prefetched or rejected based on runtime budgets. Requests are assigned
 * stable priorities so parallel callers cannot accidentally starve gameplay-critical assets.
 */

const PRIORITIES = Object.freeze({ CRITICAL: 100, PLAYER: 90, WORLD: 70, AMBIENT: 40, PREFETCH: 10 });
const ACTIONS = Object.freeze({ ADMIT: 'admit', DEFER: 'defer', REJECT: 'reject' });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function normalizePriority(value) { return clamp(Math.round(Number.isFinite(value) ? value : PRIORITIES.AMBIENT), 0, 100); }
function normalizeSize(bytes) { return clamp(Math.round(Number.isFinite(bytes) ? bytes : 0), 0, 512 * 1024 * 1024); }

export function evaluateAssetRequest(request = {}, state = {}) {
	const priority = normalizePriority(request.priority);
	const bytes = normalizeSize(request.estimatedBytes);
	const concurrency = clamp(Math.round(Number.isFinite(state.activeLoads) ? state.activeLoads : 0), 0, 64);
	const limit = clamp(Math.round(Number.isFinite(state.concurrencyLimit) ? state.concurrencyLimit : 2), 1, 8);
	const offline = state.offline === true;
	const saveData = state.saveData === true;
	const storageLimited = state.storageLimited === true;
	const critical = request.kind === 'critical' || priority >= PRIORITIES.CRITICAL;
	let action = ACTIONS.ADMIT;
	let reason = 'budget-available';
	if (offline && request.networkRequired) {
		action = critical ? ACTIONS.REJECT : ACTIONS.DEFER;
		reason = 'offline-network-required';
	} else if (saveData && !critical && (request.prefetch || priority <= PRIORITIES.PREFETCH)) {
		action = ACTIONS.DEFER;
		reason = 'save-data-prefetch';
	} else if (storageLimited && !critical && bytes > 4 * 1024 * 1024) {
		action = ACTIONS.DEFER;
		reason = 'storage-pressure';
	} else if (concurrency >= limit && priority < PRIORITIES.PLAYER) {
		action = ACTIONS.DEFER;
		reason = 'concurrency-limit';
	}
	return freeze({ version: 1, action, reason, priority, estimatedBytes: bytes, activeLoads: concurrency, concurrencyLimit: limit, critical, deferred: action !== ACTIONS.ADMIT });
}

export function sortAssetRequests(requests = []) {
	return requests.slice().sort((a, b) => {
		const pa = normalizePriority(a?.priority);
		const pb = normalizePriority(b?.priority);
		if (pb !== pa) return pb - pa;
		const ka = String(a?.id ?? '');
		const kb = String(b?.id ?? '');
		return ka.localeCompare(kb);
	});
}

export function createAssetLoadBudget(matrix, overrides = {}) {
	const budget = matrix?.budget ?? {};
	return freeze({
		version: 1,
		concurrencyLimit: clamp(Math.round(overrides.concurrencyLimit ?? budget.maxAssetConcurrency ?? 2), 1, 8),
		textureConcurrencyLimit: clamp(Math.round(overrides.textureConcurrencyLimit ?? budget.maxTextureUpgradeConcurrency ?? 0), 0, 4),
		maxPrefetchBytes: clamp(Math.round(overrides.maxPrefetchBytes ?? 32 * 1024 * 1024), 0, 256 * 1024 * 1024),
		maxDeferredQueue: clamp(Math.round(overrides.maxDeferredQueue ?? 128), 8, 512),
	});
}

export function assetPriorityConstants() { return freeze({ priorities: PRIORITIES, actions: ACTIONS }); }
