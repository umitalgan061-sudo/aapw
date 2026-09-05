/**
 * Read-only mountain ground/context query for autonomous world placement.
 *
 * This is deliberately not a placement system. It never loads an asset, creates a material, moves a
 * mesh or attaches anything to the scene; callers still use WorldAssetPlacementPipeline for that.
 * It exposes conservative source-owned mountain context so geology, vegetation, fauna and settlement
 * agents can reject obviously invalid positions before asking the shared pipeline to ground them.
 *
 * The query intentionally operates only inside a conservative fraction of each canonical chain's
 * declared base shoulder. Live relief can locally narrow/widen the visual shoulder, so the query uses
 * the minimum guaranteed interior derived from the live width policy instead of pretending it owns
 * the rendered support envelope. Positive live relief and dry-land authority are hard gates.
 *
 * @module world/worldReferenceMountainPlacementQuery
 */

import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from './worldReferenceMap.js';
import {
	WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
	sampleNormalizedReferenceMountainReliefMeters,
	sampleReferenceDryLandWeight,
	sampleReferenceLakeDistanceNormalized,
} from './worldReferenceMountainRelief.js';
import { sampleMountainGeomorphologyContext } from './worldReferenceMountainGeomorphology.js';
import { sampleMountainRidgeFrameInto } from './worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const FRAME_SCRATCH = {};

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function guaranteedWidthRatio(profile) {
	const widthPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation;
	const profileMinimum = 1 - (profile.shoulderDetailStrength ?? 0);
	return widthPolicy.minimumScale * profileMinimum;
}

const COMPILED = Object.freeze(REFERENCE_RELIEF_CHAINS.map((chain) => {
	const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
	if (!profile) throw new Error(`missing mountain profile for ${chain.id}`);
	const guaranteedRatio = guaranteedWidthRatio(profile);
	const queryRatio = Math.min(0.60, guaranteedRatio * 0.88);
	return Object.freeze({
		id: chain.id,
		profile,
		points: Object.freeze(chain.points.map(([x, y]) => Object.freeze([x * MAP_ASPECT, y]))),
		queryRatio,
		queryWidth: profile.outerWidthNormalized * queryRatio,
	});
}));

export const WORLD_REFERENCE_MOUNTAIN_PLACEMENT_QUERY_POLICY = Object.freeze({
	id: 'owner-map-mountain-placement-query-2026-09-02-v1-conservative-interior',
	mapSha256: WORLD_REFERENCE_MAP.sha256,
	minimumDryLandWeight: 0.92,
	minimumReliefMeters: 8,
	lakeClearanceNormalized: 0.018,
	interiorFadeStart: 0.72,
	interiorFadeEnd: 1,
	chains: Object.freeze(Object.fromEntries(COMPILED.map((chain) => [chain.id, Object.freeze({
		baseOuterWidthNormalized: chain.profile.outerWidthNormalized,
		guaranteedMinimumWidthRatio: guaranteedWidthRatio(chain.profile),
		queryRatio: chain.queryRatio,
		queryWidthNormalized: chain.queryWidth,
	})]))),
});

function resetOut(out) {
	out.valid = false;
	out.chainId = null;
	out.progress = 0;
	out.side = 0;
	out.signedDistanceNormalized = 0;
	out.baseShoulderDistance = Infinity;
	out.queryInteriorWeight = 0;
	out.reliefMeters = 0;
	out.dryLandWeight = 0;
	out.lakeDistanceNormalized = 0;
	out.heightScale = 1;
	out.talusExposure = 0;
	out.bedrockExposure = 0;
	out.headwallExposure = 0;
	out.gullyExposure = 0;
	out.interfluveRibExposure = 0;
	out.cliffPotential = 0;
	out.screePotential = 0;
	out.depositionPotential = 0;
	out.snowRetentionPotential = 0;
	return out;
}

/**
 * Resolve conservative canonical mountain context into caller-owned `out`.
 *
 * The returned `baseShoulderDistance` uses source profile width, not live visual width. This is
 * intentional: `valid=true` means the sample lies inside a guaranteed conservative interior and
 * therefore is safe for *consideration*, not that the query has replaced the live ground sampler.
 */
export function sampleNormalizedMountainPlacementQueryInto(normalizedX, normalizedY, out) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
		throw new TypeError('normalized mountain placement coordinates must be finite');
	}
	if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
		throw new RangeError('normalized mountain placement coordinates must be in [0,1]');
	}
	if (!out || typeof out !== 'object') throw new TypeError('mountain placement query out is required');
	resetOut(out);

	const dryLandWeight = sampleReferenceDryLandWeight(normalizedX, normalizedY);
	const reliefMeters = sampleNormalizedReferenceMountainReliefMeters(normalizedX, normalizedY);
	const lakeDistanceNormalized = sampleReferenceLakeDistanceNormalized(normalizedX, normalizedY);
	out.dryLandWeight = dryLandWeight;
	out.reliefMeters = reliefMeters;
	out.lakeDistanceNormalized = lakeDistanceNormalized;
	const policy = WORLD_REFERENCE_MOUNTAIN_PLACEMENT_QUERY_POLICY;
	if (
		dryLandWeight < policy.minimumDryLandWeight
		|| reliefMeters < policy.minimumReliefMeters
		|| lakeDistanceNormalized < policy.lakeClearanceNormalized
	) return out;

	let best = null;
	let bestBaseDistance = Infinity;
	for (const chain of COMPILED) {
		sampleMountainRidgeFrameInto(
			normalizedX,
			normalizedY,
			chain.points,
			MAP_ASPECT,
			FRAME_SCRATCH,
			true,
		);
		const baseDistance = FRAME_SCRATCH.distance / Math.max(chain.profile.outerWidthNormalized, 1e-9);
		if (baseDistance > chain.queryRatio || baseDistance >= bestBaseDistance) continue;
		bestBaseDistance = baseDistance;
		best = {
			chain,
			progress: FRAME_SCRATCH.progress,
			side: FRAME_SCRATCH.side,
			signedDistance: FRAME_SCRATCH.signedDistance,
		};
	}
	if (!best) return out;

	const localQueryDistance = clamp01(bestBaseDistance / Math.max(best.chain.queryRatio, 1e-9));
	const queryInteriorWeight = 1 - smoothstep(
		policy.interiorFadeStart,
		policy.interiorFadeEnd,
		localQueryDistance,
	);
	if (queryInteriorWeight <= 0) return out;
	const geomorphology = sampleMountainGeomorphologyContext(
		normalizedX,
		normalizedY,
		best.chain.points,
		MAP_ASPECT,
		clamp01(bestBaseDistance),
		best.chain.profile.seed,
	);

	out.valid = true;
	out.chainId = best.chain.id;
	out.progress = best.progress;
	out.side = best.side;
	out.signedDistanceNormalized = best.signedDistance;
	out.baseShoulderDistance = bestBaseDistance;
	out.queryInteriorWeight = queryInteriorWeight;
	out.heightScale = geomorphology.heightScale;
	out.talusExposure = geomorphology.talusExposure;
	out.bedrockExposure = geomorphology.bedrockExposure;
	out.headwallExposure = geomorphology.headwallExposure;
	out.gullyExposure = geomorphology.gullyExposure;
	out.interfluveRibExposure = geomorphology.interfluveRibExposure;
	out.cliffPotential = geomorphology.cliffPotential;
	out.screePotential = geomorphology.screePotential;
	out.depositionPotential = geomorphology.depositionPotential;
	out.snowRetentionPotential = geomorphology.snowRetentionPotential;
	return out;
}

/** Diagnostic convenience form for tooling/tests. Runtime placement loops should use the Into form. */
export function sampleNormalizedMountainPlacementQuery(normalizedX, normalizedY) {
	const out = {};
	sampleNormalizedMountainPlacementQueryInto(normalizedX, normalizedY, out);
	return Object.freeze({ ...out, policyId: WORLD_REFERENCE_MOUNTAIN_PLACEMENT_QUERY_POLICY.id });
}

export function getMountainPlacementQueryChainPolicy(chainId) {
	const entry = WORLD_REFERENCE_MOUNTAIN_PLACEMENT_QUERY_POLICY.chains[chainId];
	return entry ?? null;
}
