/**
 * Deterministic geography-to-settlement policy.
 *
 * This is deliberately a small policy layer on top of the existing village/placement pipeline:
 * it does not own height, hydrology, roads, materials or asset loading. It only converts the
 * already-authoritative surface sample into a stable architectural preference and material-role
 * hint so the existing village system stops treating every parcel inside one kingdom seat as
 * visually interchangeable.
 * @module world/settlementGeographyPolicy
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep = (edge0, edge1, value) => {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};

const REGION_IDS = Object.freeze(['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);

export const SETTLEMENT_GEOGRAPHY_POLICY = Object.freeze({
	id: 'settlement-geography-asset-material-v1-2026-09-07',
	context: Object.freeze({
		maxArchitecturalSlopeDegrees: 12,
		preferredRoadDistanceMeters: 17,
		roadComfortHalfWidthMeters: 28,
		coastalWaterDepthMeters: 2.0,
		coastalPreferredMaxWaterDepthMeters: 0.65,
		uplandStartMeters: 12,
		highlandStartMeters: 70,
		aridDryHeightMeters: 34,
		volcanicHeightMeters: 85,
	}),
	regions: Object.freeze({
		north: Object.freeze({
			label: 'cold northern wood-and-stone',
			weights: Object.freeze({ lowSlope: 0.30, road: 0.14, elevation: 0.31, coast: 0.10, shelter: 0.15 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'stone', roof: 'roof-tile', timber: 'wood', trim: 'stone' }),
		}),
		fertile: Object.freeze({
			label: 'fertile open lowland',
			weights: Object.freeze({ lowSlope: 0.36, road: 0.34, elevation: 0.10, coast: 0.05, shelter: 0.15 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'plaster', roof: 'thatch', timber: 'wood', trim: 'stone' }),
		}),
		maritime: Object.freeze({
			label: 'wind-exposed coastal settlement',
			weights: Object.freeze({ lowSlope: 0.28, road: 0.25, elevation: 0.08, coast: 0.29, shelter: 0.10 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'house', roof: 'roof-tile', timber: 'wood', trim: 'rock' }),
		}),
		arid: Object.freeze({
			label: 'dry southern upland',
			weights: Object.freeze({ lowSlope: 0.26, road: 0.20, elevation: 0.24, coast: 0.05, shelter: 0.25 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'plaster', roof: 'roof-tile', timber: 'wood', trim: 'stone' }),
		}),
		mountain: Object.freeze({
			label: 'mountain foothill terrace',
			weights: Object.freeze({ lowSlope: 0.38, road: 0.12, elevation: 0.30, coast: 0.03, shelter: 0.17 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'rock' }),
		}),
		temperate: Object.freeze({
			label: 'temperate rolling countryside',
			weights: Object.freeze({ lowSlope: 0.34, road: 0.29, elevation: 0.15, coast: 0.07, shelter: 0.15 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'house', roof: 'thatch', timber: 'wood', trim: 'stone' }),
		}),
		volcanic: Object.freeze({
			label: 'dark volcanic stone settlement',
			weights: Object.freeze({ lowSlope: 0.23, road: 0.15, elevation: 0.37, coast: 0.02, shelter: 0.23 }),
			primaryVariant: 'primary',
			secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'brick', roof: 'roof-tile', timber: 'iron', trim: 'rock' }),
		}),
	}),
});

function finiteOr(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function resolveSurfaceContext({
	height = 0,
	seaLevel = 0,
	slopeDegrees = 0,
	roadDistance = 1_000_000,
	waterDepth = 0,
} = {}) {
	const elevationAboveSea = finiteOr(height) - finiteOr(seaLevel);
	const lowSlopeScore = 1 - smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees * 0.45, SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees, Math.abs(finiteOr(slopeDegrees)));
	const roadDistanceMeters = Math.max(0, finiteOr(roadDistance, 1_000_000));
	const roadScore = Math.exp(-Math.pow((roadDistanceMeters - SETTLEMENT_GEOGRAPHY_POLICY.context.preferredRoadDistanceMeters) / SETTLEMENT_GEOGRAPHY_POLICY.context.roadComfortHalfWidthMeters, 2));
	const coastScore = 1 - smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.coastalPreferredMaxWaterDepthMeters, SETTLEMENT_GEOGRAPHY_POLICY.context.coastalWaterDepthMeters, Math.max(0, finiteOr(waterDepth)));
	const elevationScore = smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.uplandStartMeters, SETTLEMENT_GEOGRAPHY_POLICY.context.highlandStartMeters, Math.max(0, elevationAboveSea));
	const shelterScore = 1 - smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees * 0.5, SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees + 8, Math.abs(finiteOr(slopeDegrees)));
	return Object.freeze({
		height: finiteOr(height),
		seaLevel: finiteOr(seaLevel),
		elevationAboveSea,
		slopeDegrees: finiteOr(slopeDegrees),
		roadDistanceMeters,
		waterDepth: Math.max(0, finiteOr(waterDepth)),
		lowSlopeScore: clamp01(lowSlopeScore),
		roadScore: clamp01(roadScore),
		coastScore: clamp01(coastScore),
		elevationScore: clamp01(elevationScore),
		shelterScore: clamp01(shelterScore),
	});
}

export function resolveSettlementGeographyContext(surface = {}) {
	return resolveSurfaceContext(surface);
}

export function scoreSettlementArchitectureSite(regionId, surface = {}) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	if (!region) return 0;
	const context = resolveSurfaceContext(surface);
	const { weights } = region;
	const raw = context.lowSlopeScore * weights.lowSlope
		+ context.roadScore * weights.road
		+ context.elevationScore * weights.elevation
		+ context.coastScore * weights.coast
		+ context.shelterScore * weights.shelter;
	const hardSlopePenalty = context.slopeDegrees > SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees ? 0.05 : 1;
	return clamp01(raw * hardSlopePenalty);
}

export function selectSettlementArchitectureVariant(regionId, surface = {}, roll = 0.5) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	if (!region) return 'primary';
	const score = scoreSettlementArchitectureSite(regionId, surface);
	const normalizedRoll = ((finiteOr(roll) % 1) + 1) % 1;
	const secondaryBias = 0.20 + (1 - score) * 0.22;
	return normalizedRoll < secondaryBias ? region.secondaryVariant : region.primaryVariant;
}

export function resolveSettlementPreferredMaterialRole(regionId, role) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	if (!region || !role) return null;
	return region.preferredRoles[role] || null;
}

export function resolveSettlementArchitectureEvidence(regionId, site = {}) {
	const context = resolveSurfaceContext(site);
	return Object.freeze({
		policyId: SETTLEMENT_GEOGRAPHY_POLICY.id,
		regionId: REGION_IDS.includes(regionId) ? regionId : null,
		score: scoreSettlementArchitectureSite(regionId, context),
		variant: selectSettlementArchitectureVariant(regionId, context, finiteOr(site.roll, 0.5)),
		context,
	});
}

export function compareSettlementArchitectureCandidates(regionId, a, b) {
	const scoreA = scoreSettlementArchitectureSite(regionId, a);
	const scoreB = scoreSettlementArchitectureSite(regionId, b);
	if (Math.abs(scoreA - scoreB) > 1e-9) return scoreB - scoreA;
	const indexA = Number.isInteger(a?.houseIndex) ? a.houseIndex : Number.MAX_SAFE_INTEGER;
	const indexB = Number.isInteger(b?.houseIndex) ? b.houseIndex : Number.MAX_SAFE_INTEGER;
	return indexA - indexB;
}

export function isSettlementGeographyPolicySane() {
	const regions = SETTLEMENT_GEOGRAPHY_POLICY.regions;
	for (const regionId of REGION_IDS) {
		const region = regions[regionId];
		if (!region) return false;
		const total = Object.values(region.weights).reduce((sum, value) => sum + value, 0);
		if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-6) return false;
		if (!region.primaryVariant || !region.secondaryVariant) return false;
	}
	return true;
}

export { REGION_IDS };