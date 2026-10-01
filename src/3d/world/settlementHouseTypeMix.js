/**
 * Regional weighting for the existing procedural house fallback.
 * Real GLB settlement assets remain preferred; this keeps procedural fallback geography-aware.
 */
const MIXES = Object.freeze({
	north: Object.freeze([0.34, 0.50, 0.16]),
	fertile: Object.freeze([0.56, 0.29, 0.15]),
	maritime: Object.freeze([0.46, 0.43, 0.11]),
	arid: Object.freeze([0.24, 0.46, 0.30]),
	mountain: Object.freeze([0.22, 0.56, 0.22]),
	temperate: Object.freeze([0.60, 0.25, 0.15]),
	volcanic: Object.freeze([0.27, 0.49, 0.24]),
});

export const SETTLEMENT_HOUSE_TYPE_MIX_VERSION = 'regional-house-type-mix-v1-2026-09-07';

export function getSettlementHouseTypeWeights(regionId) {
	return MIXES[regionId] || null;
}

export function pickSettlementHouseTypeIndex(roll, regionId) {
	const weights = getSettlementHouseTypeWeights(regionId);
	if (!weights) return null;
	const safeRoll = ((Number.isFinite(roll) ? roll : 0) % 1 + 1) % 1;
	let cumulative = 0;
	for (let i = 0; i < weights.length; i++) {
		cumulative += weights[i];
		if (safeRoll < cumulative) return i;
	}
	return weights.length - 1;
}

export function isSettlementHouseTypeMixSane() {
	return Object.values(MIXES).every((weights) => {
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		return weights.length === 3 && weights.every((weight) => Number.isFinite(weight) && weight >= 0) && Math.abs(total - 1) < 1e-9;
	});
}
