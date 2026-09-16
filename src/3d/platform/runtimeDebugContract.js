/**
 * Runtime debug contract.
 *
 * Defines a stable, redacted shape for future performance/debug surfaces. It accepts health and support
 * records and strips volatile browser identifiers, arbitrary renderer strings and free-form fields unless
 * they are explicitly part of the public contract. This keeps diagnostics useful without turning a debug
 * tool into an accidental telemetry sink.
 */

const VERSION = 1;
const MAX_ISSUES = 8;
const MAX_EVENTS = 16;
const MAX_TEXT = 96;
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function text(value) { return typeof value === 'string' ? value.slice(0, MAX_TEXT) : null; }
function number(value, fallback = 0) { return Number.isFinite(value) ? Number(value.toFixed(3)) : fallback; }
function bool(value) { return value === true; }

function redactCapabilities(capabilities = {}) {
	return {
		tier: text(capabilities.tier) ?? 'unknown',
		score: number(capabilities.score),
		cpuCores: Math.max(0, Math.round(Number(capabilities.cpu?.logicalCores ?? 0))),
		memoryGb: Number.isFinite(capabilities.memory?.deviceGb) ? number(capabilities.memory.deviceGb) : null,
		dpr: number(capabilities.display?.dpr, 1),
		coarsePointer: bool(capabilities.pointer?.coarse),
		reducedMotion: bool(capabilities.accessibility?.reducedMotion),
		networkClass: text(capabilities.network?.class) ?? 'unknown',
		webglVersion: Math.max(0, Math.min(2, Math.round(Number(capabilities.webgl?.version ?? 0)))),
	};
}

function redactMatrix(matrix = {}) {
	const budget = matrix.budget ?? {};
	return {
		tier: text(matrix.quality?.tier) ?? 'unknown',
		pixelRatioCap: number(budget.pixelRatioCap, 1),
		shadowMapSize: Math.max(0, Math.round(Number(budget.shadowMapSize ?? 0))),
		chunkRadius: Math.max(1, Math.round(Number(budget.maxChunkRadius ?? 1))),
		animatedActors: Math.max(0, Math.round(Number(budget.maxAnimatedActors ?? 0))),
		assetConcurrency: Math.max(0, Math.round(Number(budget.maxAssetConcurrency ?? 0))),
		features: Object.keys(matrix.features ?? {}).sort().reduce((out, key) => { out[key] = Boolean(matrix.features[key]); return out; }, {}),
	};
}

export function createRuntimeDebugContract({ health = {}, governor = {}, telemetry = {}, offline = {}, lifecycle = {}, compatibility = {}, support = null } = {}) {
	const healthSnapshot = typeof health.snapshot === 'function' ? health.snapshot() : health;
	const governorSnapshot = typeof governor.snapshot === 'function' ? governor.snapshot() : governor;
	const telemetrySummary = typeof telemetry.summarize === 'function' ? telemetry.summarize() : telemetry;
	const events = typeof telemetry.recent === 'function' ? telemetry.recent(MAX_EVENTS) : [];
	const contract = {
		version: VERSION,
		status: text(healthSnapshot.status) ?? 'unknown',
		capabilities: redactCapabilities(healthSnapshot.capabilities),
		matrix: redactMatrix(healthSnapshot.featureMatrix),
		performance: {
			pressure: text(healthSnapshot.performance?.pressure) ?? 'unknown',
			p95: number(healthSnapshot.performance?.p95),
			budgetMs: number(healthSnapshot.performance?.frameBudgetMs, 0),
			pressureScore: number(healthSnapshot.performance?.pressureScore),
		},
		quality: {
			tier: text(governorSnapshot.tier) ?? 'unknown',
			action: text(governorSnapshot.action) ?? 'hold',
			sequence: Math.max(0, Math.round(Number(governorSnapshot.sequence ?? 0))),
			cooldown: Math.max(0, Math.round(Number(governorSnapshot.cooldownSamples ?? 0))),
		},
		offline: {
			network: text(offline.network?.state) ?? 'unknown',
			storage: text(offline.storage?.state) ?? 'unknown',
			update: text(offline.update?.state) ?? 'unknown',
			canPlayOffline: bool(offline.resilience?.canPlayOffline),
		},
		lifecycle: {
			state: text(lifecycle.state) ?? 'unknown',
			sequence: Math.max(0, Math.round(Number(lifecycle.sequence ?? 0))),
			terminal: bool(lifecycle.state === 'disposed'),
		},
		compatibility: {
			level: text(compatibility.level) ?? 'unknown',
			webgl: Math.max(0, Math.min(2, Math.round(Number(compatibility.webgl?.version ?? 0)))),
		},
		issues: (healthSnapshot.issues ?? []).filter((value) => typeof value === 'string').slice(0, MAX_ISSUES).map((value) => value.slice(0, MAX_TEXT)),
		telemetry: {
			retained: Math.max(0, Math.round(Number(telemetrySummary.retained ?? 0))),
			sequence: Math.max(0, Math.round(Number(telemetrySummary.sequence ?? 0))),
			events: events.filter((entry) => entry && typeof entry === 'object').slice(0, MAX_EVENTS).map((entry) => ({ sequence: entry.sequence ?? 0, level: text(entry.level) ?? 'info', name: text(entry.name) ?? 'event' })),
		},
		supportIncluded: support !== null,
	};
	return freeze(contract);
}

export function runtimeDebugContractJson(input) { return JSON.stringify(createRuntimeDebugContract(input)); }
export function runtimeDebugContractConstants() { return freeze({ version: VERSION, maxIssues: MAX_ISSUES, maxEvents: MAX_EVENTS, maxText: MAX_TEXT }); }
