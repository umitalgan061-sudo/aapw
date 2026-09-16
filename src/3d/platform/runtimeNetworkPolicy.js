/**
 * Network transfer policy.
 *
 * Turns browser connection hints into transfer classes. It is advisory and never starts requests. The
 * policy gives the asset queue a consistent way to decide whether to prefetch, use a small payload,
 * defer non-critical downloads or stay memory/local-cache only.
 */

const CLASSES = Object.freeze({ OFFLINE: 'offline', CONSTRAINED: 'constrained', NORMAL: 'normal', FAST: 'fast', UNKNOWN: 'unknown' });
const ACTIONS = Object.freeze({ CRITICAL: 'critical', STANDARD: 'standard', REDUCED: 'reduced', DEFER: 'defer', CACHE_ONLY: 'cache-only' });
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function classify(online, type, saveData) {
	if (online === false) return CLASSES.OFFLINE;
	const value = String(type ?? '').toLowerCase();
	if (saveData || value === 'slow-2g' || value === '2g') return CLASSES.CONSTRAINED;
	if (value === '4g') return CLASSES.FAST;
	if (value === '3g') return CLASSES.NORMAL;
	return CLASSES.UNKNOWN;
}

export function createRuntimeNetworkPolicy({ online = true, effectiveType = null, saveData = false, downlinkMbps = null, rttMs = null } = {}) {
	const networkClass = classify(online, effectiveType, saveData);
	const constrained = networkClass === CLASSES.CONSTRAINED;
	const downlink = Number.isFinite(downlinkMbps) ? Math.max(0, downlinkMbps) : null;
	const rtt = Number.isFinite(rttMs) ? Math.max(0, rttMs) : null;
	return freeze({
		version: 1,
		class: networkClass,
		saveData: saveData === true,
		downlinkMbps: downlink,
		rttMs: rtt,
		budget: {
			maxPrefetchBytes: networkClass === CLASSES.FAST && !saveData ? 32 * 1024 * 1024 : networkClass === CLASSES.NORMAL ? 8 * 1024 * 1024 : 0,
			maxConcurrentDownloads: networkClass === CLASSES.FAST && !saveData ? 4 : networkClass === CLASSES.NORMAL ? 2 : networkClass === CLASSES.CONSTRAINED ? 1 : 0,
			maxOptionalRequestsPerMinute: networkClass === CLASSES.FAST && !saveData ? 60 : networkClass === CLASSES.NORMAL ? 24 : 0,
		},
		rules: {
			critical: networkClass === CLASSES.OFFLINE ? ACTIONS.CACHE_ONLY : ACTIONS.CRITICAL,
			standard: networkClass === CLASSES.CONSTRAINED ? ACTIONS.REDUCED : networkClass === CLASSES.OFFLINE ? ACTIONS.CACHE_ONLY : ACTIONS.STANDARD,
			prefetch: networkClass === CLASSES.FAST && !saveData ? ACTIONS.STANDARD : constrained ? ACTIONS.DEFER : ACTIONS.REDUCED,
		},
	});
}

export function networkActionFor(policy, { critical = false, prefetch = false } = {}) {
	if (!policy) return ACTIONS.DEFER;
	if (critical) return policy.rules.critical;
	if (prefetch) return policy.rules.prefetch;
	return policy.rules.standard;
}

export function runtimeNetworkConstants() { return freeze({ classes: CLASSES, actions: ACTIONS }); }
