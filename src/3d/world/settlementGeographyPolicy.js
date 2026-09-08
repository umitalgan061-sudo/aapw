/**
 * Small deterministic policy layered over the existing village + shared placement systems.
 * It does not own terrain sampling, asset loading, material creation or grounding.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep = (edge0, edge1, value) => {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};

export const SETTLEMENT_GEOGRAPHY_POLICY = Object.freeze({
	id: 'settlement-geography-asset-material-v1-2026-09-07',
	context: Object.freeze({
		maxArchitecturalSlopeDegrees: 12,
		maxFoundationReliefMeters: 1.15,
		preferredRoadDistanceMeters: 17,
		roadComfortHalfWidthMeters: 28,
		coastalWaterDepthMeters: 2,
		coastalPreferredMaxWaterDepthMeters: 0.65,
		uplandStartMeters: 12,
		highlandStartMeters: 70,
	}),
	regions: Object.freeze({
		north: Object.freeze({
			label: 'cold northern wood-and-stone',
			weights: Object.freeze({ lowSlope: 0.3, road: 0.14, elevation: 0.31, coast: 0.1, shelter: 0.15 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'stone', roof: 'roof-tile', timber: 'wood', trim: 'stone' }),
		}),
		fertile: Object.freeze({
			label: 'fertile open lowland',
			weights: Object.freeze({ lowSlope: 0.36, road: 0.34, elevation: 0.1, coast: 0.05, shelter: 0.15 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'plaster', roof: 'thatch', timber: 'wood', trim: 'stone' }),
		}),
		maritime: Object.freeze({
			label: 'wind-exposed coastal settlement',
			weights: Object.freeze({ lowSlope: 0.28, road: 0.25, elevation: 0.08, coast: 0.29, shelter: 0.1 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'house', roof: 'roof-tile', timber: 'wood', trim: 'rock' }),
		}),
		arid: Object.freeze({
			label: 'dry southern upland',
			weights: Object.freeze({ lowSlope: 0.26, road: 0.2, elevation: 0.24, coast: 0.05, shelter: 0.25 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'plaster', roof: 'roof-tile', timber: 'wood', trim: 'stone' }),
		}),
		mountain: Object.freeze({
			label: 'mountain foothill terrace',
			weights: Object.freeze({ lowSlope: 0.38, road: 0.12, elevation: 0.3, coast: 0.03, shelter: 0.17 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'rock' }),
		}),
		temperate: Object.freeze({
			label: 'temperate rolling countryside',
			weights: Object.freeze({ lowSlope: 0.34, road: 0.29, elevation: 0.15, coast: 0.07, shelter: 0.15 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'house', roof: 'thatch', timber: 'wood', trim: 'stone' }),
		}),
		volcanic: Object.freeze({
			label: 'dark volcanic stone settlement',
			weights: Object.freeze({ lowSlope: 0.23, road: 0.15, elevation: 0.37, coast: 0.02, shelter: 0.23 }),
			primaryVariant: 'primary', secondaryVariant: 'secondary',
			preferredRoles: Object.freeze({ wall: 'brick', roof: 'roof-tile', timber: 'iron', trim: 'rock' }),
		}),
	}),
});

export const REGION_IDS = Object.freeze(Object.keys(SETTLEMENT_GEOGRAPHY_POLICY.regions));

function finiteOr(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

export function resolveSettlementGeographyContext({
	height = 0,
	seaLevel = 0,
	slopeDegrees = 0,
	roadDistance = 1_000_000,
	waterDepth = 0,
	shorelineDistanceMeters = Infinity,
	footprintReliefMeters = 0,
} = {}) {
	const elevationAboveSea = finiteOr(height) - finiteOr(seaLevel);
	const absSlope = Math.abs(finiteOr(slopeDegrees));
	const lowSlopeScore = 1 - smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees * 0.45, SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees, absSlope);
	const roadDistanceMeters = Math.max(0, finiteOr(roadDistance, 1_000_000));
	const roadScore = Math.exp(-Math.pow((roadDistanceMeters - SETTLEMENT_GEOGRAPHY_POLICY.context.preferredRoadDistanceMeters) / SETTLEMENT_GEOGRAPHY_POLICY.context.roadComfortHalfWidthMeters, 2));
	const shorelineDistance = Math.max(0, finiteOr(shorelineDistanceMeters, Infinity));
	const shorelineScore = Number.isFinite(shorelineDistance) ? Math.exp(-Math.pow(shorelineDistance / 42, 2)) : 0;
	const landWaterPenalty = smoothstep(0.02, SETTLEMENT_GEOGRAPHY_POLICY.context.coastalWaterDepthMeters, Math.max(0, finiteOr(waterDepth)));
	const coastScore = clamp01(shorelineScore * (1 - landWaterPenalty));
	const elevationScore = smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.uplandStartMeters, SETTLEMENT_GEOGRAPHY_POLICY.context.highlandStartMeters, Math.max(0, elevationAboveSea));
	const shelterScore = 1 - smoothstep(SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees * 0.5, SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees + 8, absSlope);
	const foundationRelief = Math.max(0, finiteOr(footprintReliefMeters));
	const foundationScore = 1 - smoothstep(0.35, SETTLEMENT_GEOGRAPHY_POLICY.context.maxFoundationReliefMeters, foundationRelief);
	return Object.freeze({
		height: finiteOr(height),
		seaLevel: finiteOr(seaLevel),
		elevationAboveSea,
		slopeDegrees: finiteOr(slopeDegrees),
		roadDistanceMeters,
		waterDepth: Math.max(0, finiteOr(waterDepth)),
		shorelineDistanceMeters: Number.isFinite(shorelineDistance) ? shorelineDistance : null,
		footprintReliefMeters: foundationRelief,
		lowSlopeScore: clamp01(lowSlopeScore),
		roadScore: clamp01(roadScore),
		coastScore: clamp01(coastScore),
		elevationScore: clamp01(elevationScore),
		shelterScore: clamp01(shelterScore),
		foundationScore: clamp01(foundationScore),
	});
}

export function scoreSettlementArchitectureSite(regionId, surface = {}) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	if (!region) return 0;
	const context = resolveSettlementGeographyContext(surface);
	const { weights } = region;
	const raw = context.lowSlopeScore * weights.lowSlope
		+ context.roadScore * weights.road
		+ context.elevationScore * weights.elevation
		+ context.coastScore * weights.coast
		+ context.shelterScore * weights.shelter;
	const slopePenalty = context.slopeDegrees > SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees ? 0.05 : 1;
	const reliefPenalty = context.footprintReliefMeters > SETTLEMENT_GEOGRAPHY_POLICY.context.maxFoundationReliefMeters
		? 0.12
		: 0.55 + context.foundationScore * 0.45;
	return clamp01(raw * slopePenalty * reliefPenalty);
}

export function selectSettlementArchitectureVariant(regionId, surface = {}, roll = 0.5) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	if (!region) return 'primary';
	const score = scoreSettlementArchitectureSite(regionId, surface);
	const safeRoll = ((finiteOr(roll) % 1) + 1) % 1;
	const secondaryBias = 0.2 + (1 - score) * 0.22;
	return safeRoll < secondaryBias ? region.secondaryVariant : region.primaryVariant;
}

export function resolveSettlementPreferredMaterialRole(regionId, role) {
	return SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId]?.preferredRoles?.[role] || null;
}

export function resolveSettlementArchitectureEvidence(regionId, surface = {}) {
	const context = resolveSettlementGeographyContext(surface);
	return Object.freeze({
		policyId: SETTLEMENT_GEOGRAPHY_POLICY.id,
		regionId: REGION_IDS.includes(regionId) ? regionId : null,
		score: scoreSettlementArchitectureSite(regionId, context),
		variant: selectSettlementArchitectureVariant(regionId, context, finiteOr(surface.roll, 0.5)),
		context,
	});
}

export function isSettlementGeographyPolicySane() {
	return REGION_IDS.length === 7 && REGION_IDS.every((regionId) => {
		const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
		const total = Object.values(region.weights).reduce((sum, value) => sum + value, 0);
		return Math.abs(total - 1) < 1e-9 && region.primaryVariant && region.secondaryVariant;
	});
}
