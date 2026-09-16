/**
 * Deterministic support-snapshot serializer.
 *
 * Runtime health records can contain browser-specific renderer strings and volatile counters. This
 * serializer produces a bounded JSON-safe record suitable for a debug panel, copied diagnostic report
 * or test artifact. It deliberately excludes URLs, arbitrary object graphs and player data.
 */

const MAX_ISSUES = 8;
const MAX_EVENTS = 12;
const MAX_STRING = 160;

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function str(value) {
	return typeof value === 'string' ? value.slice(0, MAX_STRING) : null;
}

function num(value, fallback = null) {
	return Number.isFinite(value) ? Number(value.toFixed(4)) : fallback;
}

function bool(value) { return value === true; }

export function createRuntimeSupportSnapshot({ health, governor, telemetry, offline, version = 'unknown' } = {}) {
	const healthSnapshot = health?.snapshot?.() ?? {};
	const governorSnapshot = governor?.snapshot?.() ?? {};
	const telemetrySummary = telemetry?.summarize?.() ?? {};
	const telemetryEvents = telemetry?.recent?.(MAX_EVENTS) ?? [];
	const offlineSnapshot = offline?.snapshot?.() ?? {};
	return freeze({
		version: 1,
		build: str(version) ?? 'unknown',
		status: str(healthSnapshot.status) ?? 'unknown',
		quality: {
			deviceTier: str(healthSnapshot.capabilities?.tier),
			runtimeTier: str(governorSnapshot.tier) ?? str(healthSnapshot.featureMatrix?.quality?.tier) ?? 'unknown',
			action: str(governorSnapshot.action) ?? 'hold',
			sequence: Number.isFinite(governorSnapshot.sequence) ? governorSnapshot.sequence : 0,
		},
		device: {
			capabilityTier: str(healthSnapshot.capabilities?.tier),
			score: num(healthSnapshot.capabilities?.score),
			webglVersion: healthSnapshot.capabilities?.webgl?.version ?? 0,
			coarsePointer: bool(healthSnapshot.capabilities?.pointer?.coarse),
			reducedMotion: bool(healthSnapshot.capabilities?.accessibility?.reducedMotion),
		},
		performance: {
			pressure: str(healthSnapshot.performance?.pressure) ?? 'unknown',
			p95: num(healthSnapshot.performance?.p95, 0),
			frameBudgetMs: num(healthSnapshot.performance?.frameBudgetMs, 0),
			pressureScore: num(healthSnapshot.performance?.pressureScore, 0),
		},
		offline: {
			network: str(offlineSnapshot.network?.state) ?? 'unknown',
			storage: str(offlineSnapshot.storage?.state) ?? 'unknown',
			canPlayOffline: bool(offlineSnapshot.resilience?.canPlayOffline),
			update: str(offlineSnapshot.update?.state) ?? 'unknown',
		},
		issues: (healthSnapshot.issues ?? []).filter((value) => typeof value === 'string').slice(0, MAX_ISSUES).map((value) => value.slice(0, 80)),
		digests: {
			featureMatrix: str(healthSnapshot.digests?.featureMatrix),
			input: str(healthSnapshot.digests?.input),
			telemetry: str(healthSnapshot.digests?.telemetry ?? telemetrySummary?.digest),
		},
		telemetry: {
			retained: Number.isFinite(telemetrySummary.retained) ? telemetrySummary.retained : 0,
			sequence: Number.isFinite(telemetrySummary.sequence) ? telemetrySummary.sequence : 0,
			levels: { ...(telemetrySummary.levels ?? {}) },
			events: telemetryEvents.map((entry) => ({ sequence: entry.sequence, level: entry.level, name: entry.name })),
		},
	});
}

export function serializeRuntimeSupportSnapshot(snapshot) {
	const safe = createRuntimeSupportSnapshot(snapshot);
	return JSON.stringify(safe, null, 2);
}

export function supportSnapshotDigest(snapshot) {
	const serialized = typeof snapshot === 'string' ? snapshot : serializeRuntimeSupportSnapshot(snapshot);
	let hash = 2166136261;
	for (let i = 0; i < serialized.length; i += 1) {
		hash ^= serialized.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}
