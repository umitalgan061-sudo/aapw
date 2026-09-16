/**
 * Runtime feature matrix.
 *
 * Converts a capability profile into explicit feature budgets. Keeping the matrix in one pure module
 * prevents individual systems from inventing incompatible device checks. Every budget is bounded and
 * can be overridden only through an explicit policy input; unsafe overrides are clamped back into the
 * mobile and reduced-motion invariants.
 */

const QUALITY_TO_NUMERIC = Object.freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });
const QUALITY_NAMES = Object.freeze(['minimal', 'balanced', 'high', 'ultra']);
const CAPABILITY_TIERS = Object.freeze({ minimal: 'minimal', balanced: 'balanced', high: 'high', ultra: 'ultra' });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const bool = (value) => value === true;

function qualityIndex(tier) {
	return QUALITY_TO_NUMERIC[tier] ?? QUALITY_TO_NUMERIC.balanced;
}

function budgetForTier(tier, coarse, reducedMotion) {
	const index = qualityIndex(tier);
	const base = {
		maxChunkRadius: [1, 2, 2, 3][index],
		maxAnimatedActors: [12, 28, 56, 96][index],
		maxVisibleVegetationGroups: [40, 90, 180, 300][index],
		maxAssetConcurrency: [1, 2, 3, 4][index],
		maxTextureUpgradeConcurrency: [0, 1, 2, 3][index],
		shadowMapSize: [0, 0, 1024, 2048][index],
		pixelRatioCap: [0.75, 1, 1.5, 2][index],
		frameBudgetMs: [33.3, 24, 18, 16.7][index],
		streamBudgetMs: [2, 4, 6, 8][index],
	};
	if (coarse) {
		base.maxChunkRadius = Math.min(base.maxChunkRadius, 2);
		base.maxAnimatedActors = Math.min(base.maxAnimatedActors, 28);
		base.maxVisibleVegetationGroups = Math.min(base.maxVisibleVegetationGroups, 90);
		base.maxTextureUpgradeConcurrency = 0;
		base.shadowMapSize = 0;
		base.pixelRatioCap = Math.min(base.pixelRatioCap, 1);
	}
	if (reducedMotion) {
		base.maxAnimatedActors = Math.min(base.maxAnimatedActors, 20);
		base.streamBudgetMs = Math.min(base.streamBudgetMs, 4);
	}
	return base;
}

function applyAccessibilityCaps(budget, capabilities) {
	if (capabilities.accessibility?.prefersContrast === true) budget.maxVisibleVegetationGroups = Math.min(budget.maxVisibleVegetationGroups, 160);
	if (capabilities.network?.saveData === true) {
		budget.maxAssetConcurrency = 1;
		budget.maxTextureUpgradeConcurrency = 0;
	}
}

function buildFeatureFlags(capabilities, budget) {
	const coarse = bool(capabilities.pointer?.coarse);
	const reduced = bool(capabilities.accessibility?.reducedMotion);
	const constrained = capabilities.network?.class === 'constrained' || bool(capabilities.network?.saveData);
	return {
		shadows: budget.shadowMapSize > 0 && !coarse && !reduced,
		highFrequencyAnimation: budget.maxAnimatedActors >= 28 && !reduced,
		longRangeStreaming: budget.maxChunkRadius >= 2 && !constrained,
		assetPrefetch: budget.maxAssetConcurrency >= 3 && !constrained,
		textureUpgrades: budget.maxTextureUpgradeConcurrency > 0 && !constrained,
		visualWind: !reduced,
		ambientParticles: budget.maxVisibleVegetationGroups >= 90 && !reduced,
		cameraShake: !reduced,
	};
}

function clampOverride(raw, baseline) {
	if (!raw || typeof raw !== 'object') return baseline;
	const merged = { ...baseline };
	for (const key of Object.keys(baseline)) if (Number.isFinite(raw[key])) merged[key] = raw[key];
	merged.maxChunkRadius = clamp(Math.round(merged.maxChunkRadius), 1, 3);
	merged.maxAnimatedActors = clamp(Math.round(merged.maxAnimatedActors), 4, 96);
	merged.maxVisibleVegetationGroups = clamp(Math.round(merged.maxVisibleVegetationGroups), 8, 300);
	merged.maxAssetConcurrency = clamp(Math.round(merged.maxAssetConcurrency), 1, 4);
	merged.maxTextureUpgradeConcurrency = clamp(Math.round(merged.maxTextureUpgradeConcurrency), 0, 3);
	merged.shadowMapSize = [0, 512, 1024, 2048, 4096].reduce((closest, size) => Math.abs(size - merged.shadowMapSize) < Math.abs(closest - merged.shadowMapSize) ? size : closest, 0);
	merged.pixelRatioCap = clamp(finiteOr(merged.pixelRatioCap, baseline.pixelRatioCap), 0.5, 2);
	merged.frameBudgetMs = clamp(finiteOr(merged.frameBudgetMs, baseline.frameBudgetMs), 12, 50);
	merged.streamBudgetMs = clamp(finiteOr(merged.streamBudgetMs, baseline.streamBudgetMs), 1, 12);
	return merged;
}

function enforceHardInvariants(budget, capabilities) {
	const constrained = capabilities.network?.class === 'constrained' || bool(capabilities.network?.saveData);
	if (capabilities.pointer?.coarse === true) {
		budget.shadowMapSize = 0;
		budget.pixelRatioCap = Math.min(budget.pixelRatioCap, 1);
		budget.maxTextureUpgradeConcurrency = 0;
		budget.maxChunkRadius = Math.min(budget.maxChunkRadius, 2);
	}
	if (bool(capabilities.accessibility?.reducedMotion)) budget.maxAnimatedActors = Math.min(budget.maxAnimatedActors, 20);
	if (constrained) {
		budget.maxAssetConcurrency = Math.min(budget.maxAssetConcurrency, 1);
		budget.maxTextureUpgradeConcurrency = 0;
	}
}

function freeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
}

export function buildRuntimeFeatureMatrix(capabilities, options = {}) {
	const tier = QUALITY_NAMES.includes(capabilities?.tier) ? capabilities.tier : 'balanced';
	const baseline = budgetForTier(tier, bool(capabilities?.pointer?.coarse), bool(capabilities?.accessibility?.reducedMotion));
	const budget = clampOverride(options.budgetOverride, baseline);
	applyAccessibilityCaps(budget, capabilities ?? {});
	enforceHardInvariants(budget, capabilities ?? {});
	return freeze({
		version: 1,
		quality: { tier, numeric: qualityIndex(tier) },
		budget,
		features: buildFeatureFlags(capabilities ?? {}, budget),
		provenance: {
			deviceScore: finiteOr(capabilities?.score, 0),
			pointerClass: capabilities?.pointer?.class ?? 'unknown',
			networkClass: capabilities?.network?.class ?? 'unknown',
			reducedMotion: bool(capabilities?.accessibility?.reducedMotion),
		},
	});
}

export function mergeFeatureMatrix(base, patch) {
	if (!base || typeof base !== 'object') return buildRuntimeFeatureMatrix({}, patch);
	return freeze({ ...base, budget: { ...(base.budget ?? {}), ...(patch?.budget ?? {}) }, features: { ...(base.features ?? {}), ...(patch?.features ?? {}) } });
}

export function featureMatrixDigest(matrix) {
	if (!matrix || typeof matrix !== 'object') return 'runtime-matrix-invalid';
	const featureKeys = Object.keys(matrix.features ?? {}).sort();
	const budgetKeys = Object.keys(matrix.budget ?? {}).sort();
	return [matrix.version ?? 0, matrix.quality?.tier ?? 'balanced', ...featureKeys.map((key) => `${key}:${Boolean(matrix.features[key])}`), ...budgetKeys.map((key) => `${key}:${matrix.budget[key]}`)].join('|');
}

export { CAPABILITY_TIERS as RUNTIME_CAPABILITY_TIERS };
