/**
 * Regional procedural house-type weights used only when the existing village system needs a
 * procedural house. Real settlement GLBs remain the preferred representation.
 * @module world/settlementHouseTypeMix
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
	const weights = MIXES[regionId];
	return weights ? weights : null;
}

export function pickSettlementHouseTypeIndex(roll, regionId = null) {
	const weights = getSettlementHouseTypeWeights(regionId);
	if (!weights) return null;
	const safeRoll = ((Number.isFinite(roll) ? roll : 0) % 1 + 1) % 1;
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	let cumulative = 0;
	for (let index = 0; index < weights.length; index++) {
		cumulative += weights[index] / total;
		if (safeRoll < cumulative) return index;
	}
	return weights.length - 1;
}

export function isSettlementHouseTypeMixSane() {
	for (const weights of Object.values(MIXES)) {
		if (weights.length !== 3) return false;
		if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) return false;
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		if (Math.abs(total - 1) > 1e-9) return false;
	}
	return true;
}
