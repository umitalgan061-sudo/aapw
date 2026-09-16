/**
 * Bounded quality application adapter.
 *
 * Converts a runtime governor snapshot into changes an existing renderer/world owner may safely apply.
 * The adapter intentionally accepts a generic state shape rather than importing Three.js or sceneManager,
 * keeping ownership in the existing renderer/streaming systems. It also separates "requested" values
 * from hard limits so a caller can audit exactly why an application was clamped.
 */

const LEVELS = Object.freeze(['minimal', 'balanced', 'high', 'ultra']);
const SHADOW_SIZES = Object.freeze([0, 512, 1024, 2048, 4096]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

const QUALITY_DEFAULTS = Object.freeze({
	minimal: { pixelRatio: 0.75, shadowMapSize: 0, streamRadius: 1, assetConcurrency: 1 },
	balanced: { pixelRatio: 1, shadowMapSize: 0, streamRadius: 2, assetConcurrency: 2 },
	high: { pixelRatio: 1.5, shadowMapSize: 1024, streamRadius: 2, assetConcurrency: 3 },
	ultra: { pixelRatio: 2, shadowMapSize: 2048, streamRadius: 3, assetConcurrency: 4 },
});

function normalizedTier(tier) { return LEVELS.includes(tier) ? tier : 'balanced'; }
function nearestShadowSize(value) {
	return SHADOW_SIZES.reduce((closest, candidate) => Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest, 0);
}

export function resolveQualityApplication({ tier = 'balanced', devicePixelRatio = 1, hard = {}, requested = {} } = {}) {
	const safeTier = normalizedTier(tier);
	const base = QUALITY_DEFAULTS[safeTier];
	const pixelRatioCap = clamp(finiteOr(hard.pixelRatioCap, 2), 0.5, 2);
	const radiusCap = clamp(Math.round(finiteOr(hard.maxChunkRadius, 3)), 1, 3);
	const assetCap = clamp(Math.round(finiteOr(hard.maxAssetConcurrency, 4)), 1, 8);
	const coarse = hard.coarsePointer === true;
	const reduced = hard.reducedMotion === true;
	const requestedPixelRatio = clamp(finiteOr(requested.pixelRatio, base.pixelRatio), 0.5, 2);
	const requestedShadow = nearestShadowSize(finiteOr(requested.shadowMapSize, base.shadowMapSize));
	const requestedRadius = clamp(Math.round(finiteOr(requested.streamRadius, base.streamRadius)), 1, 3);
	const requestedConcurrency = clamp(Math.round(finiteOr(requested.assetConcurrency, base.assetConcurrency)), 1, 8);
	const pixelRatio = Math.min(requestedPixelRatio, pixelRatioCap, finiteOr(devicePixelRatio, 1));
	const shadowMapSize = coarse || reduced ? 0 : Math.min(requestedShadow, nearestShadowSize(finiteOr(hard.shadowMapSize, requestedShadow)) || requestedShadow);
	const streamRadius = Math.min(requestedRadius, radiusCap);
	const assetConcurrency = Math.min(requestedConcurrency, assetCap);
	return freeze({
		version: 1,
		tier: safeTier,
		applied: { pixelRatio: Number(pixelRatio.toFixed(3)), shadowMapSize, streamRadius, assetConcurrency },
		limits: { pixelRatioCap, shadowMapSize: hard.shadowMapSize ?? null, maxChunkRadius: radiusCap, maxAssetConcurrency: assetCap },
		clamped: {
			pixelRatio: pixelRatio !== requestedPixelRatio,
			shadowMapSize: shadowMapSize !== requestedShadow,
			streamRadius: streamRadius !== requestedRadius,
			assetConcurrency: assetConcurrency !== requestedConcurrency,
		},
		reasons: {
			coarsePointer: coarse,
			reducedMotion: reduced,
			devicePixelRatioLimit: pixelRatio < requestedPixelRatio,
			worldRadiusLimit: streamRadius < requestedRadius,
			assetConcurrencyLimit: assetConcurrency < requestedConcurrency,
		},
	});
}

export function applyQualityToRendererState(state, application) {
	if (!state || typeof state !== 'object' || !application?.applied) return state;
	const next = { ...state };
	if ('pixelRatio' in next) next.pixelRatio = application.applied.pixelRatio;
	if ('shadowMapSize' in next) next.shadowMapSize = application.applied.shadowMapSize;
	if ('streamRadius' in next) next.streamRadius = application.applied.streamRadius;
	if ('assetConcurrency' in next) next.assetConcurrency = application.applied.assetConcurrency;
	return freeze(next);
}

export function qualityApplicationConstants() { return freeze({ levels: LEVELS, defaults: QUALITY_DEFAULTS, shadowSizes: SHADOW_SIZES }); }
