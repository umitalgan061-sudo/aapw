/**
 * Deterministic functional-site zoning layered over the existing settlement geometry.
 *
 * Ownership boundary:
 * - terrain/environment remains owned by Buzul Muhafızı;
 * - canonical roads/POIs remain owned by their existing systems;
 * - asset materials/grounding remain owned by MaterialAssignmentCore + WorldAssetPlacementPipeline;
 * - NPC/faction logic remains owned by Şafak Kartalı;
 * - this module only ranks candidate settlement parcels for functional buildings/props.
 *
 * The policy intentionally prefers a believable village structure over uniform radial spawning:
 * market/tavern/blacksmith favour road-facing inner parcels, stable favours a peripheral but road-accessible
 * parcel, farm/barn favours open low-slope ground near water/soil access, and barracks favour a visible
 * defensible edge. All outputs are deterministic and serialisable for placement manifests.
 */

const EPSILON = 1e-9;

export const SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY = Object.freeze({
	id: 'settlement-functional-zoning-v1-2026-09-07',
	settlementRadiusMeters: 38,
	innerRadiusMeters: 15,
	outerServiceRadiusMeters: 34,
	minimumBuildingSeparationMeters: 8,
	minimumMarketRoadDistanceMeters: 4,
	preferredMarketRoadDistanceMeters: 14,
	maximumMarketRoadDistanceMeters: 32,
	preferredTavernRoadDistanceMeters: 16,
	maximumTavernRoadDistanceMeters: 34,
	preferredBlacksmithRoadDistanceMeters: 21,
	maximumBlacksmithRoadDistanceMeters: 38,
	preferredStableRoadDistanceMeters: 26,
	maximumStableRoadDistanceMeters: 48,
	minimumStableEdgeRadiusMeters: 24,
	preferredFarmRoadDistanceMeters: 30,
	maximumFarmRoadDistanceMeters: 72,
	preferredBarracksRadiusMeters: 32,
	minimumBarracksRoadDistanceMeters: 14,
	maximumBarracksRoadDistanceMeters: 70,
	maximumFunctionalSlopeDegrees: 12,
	maximumFarmSlopeDegrees: 9,
	maximumFunctionalWaterDepthMeters: 0.02,
	preferredFarmWaterAccessMeters: 90,
	maximumFarmWaterAccessMeters: 240,
	preferredServiceSpacingMeters: 12,
});

export const SETTLEMENT_FUNCTIONAL_ROLES = Object.freeze([
	'market',
	'tavern',
	'blacksmith',
	'stable',
	'farm',
	'barracks',
	'barn',
]);

function finiteOr(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
	return clamp(finiteOr(value, 0), 0, 1);
}

function smoothPreference(distance, preferred, spread) {
	const safeSpread = Math.max(0.01, Math.abs(spread));
	return Math.exp(-Math.pow((distance - preferred) / safeSpread, 2));
}

function inversePreference(distance, preferred, spread) {
	return 1 - smoothPreference(distance, preferred, spread);
}

function ringScore(radiusMeters, preferredRadiusMeters, spreadMeters) {
	return smoothPreference(radiusMeters, preferredRadiusMeters, spreadMeters);
}

function rangeScore(value, min, preferred, max) {
	const numeric = finiteOr(value, Infinity);
	if (numeric < min || numeric > max) return 0;
	if (numeric <= preferred) {
		return clamp01((numeric - min) / Math.max(0.01, preferred - min));
	}
	return clamp01((max - numeric) / Math.max(0.01, max - preferred));
}

function logisticDistanceScore(distanceMeters, preferred, softness) {
	const distance = Math.max(0, finiteOr(distanceMeters, 1_000_000));
	const scale = Math.max(1, finiteOr(softness, 1));
	return 1 / (1 + Math.abs(distance - preferred) / scale);
}

function radialDistance(x, z, centerX = 0, centerZ = 0) {
	return Math.hypot(finiteOr(x) - finiteOr(centerX), finiteOr(z) - finiteOr(centerZ));
}

function normalizeCandidate(candidate = {}) {
	const x = finiteOr(candidate.x);
	const z = finiteOr(candidate.z);
	const centerX = finiteOr(candidate.settlementCenterX, 0);
	const centerZ = finiteOr(candidate.settlementCenterZ, 0);
	const radius = radialDistance(x, z, centerX, centerZ);
	return Object.freeze({
		x,
		z,
		centerX,
		centerZ,
		radiusMeters: radius,
		slopeDegrees: Math.abs(finiteOr(candidate.slopeDegrees, 0)),
		roadDistanceMeters: Math.max(0, finiteOr(candidate.roadDistanceMeters, 1_000_000)),
		waterDistanceMeters: Math.max(0, finiteOr(candidate.waterDistanceMeters, 1_000_000)),
		waterDepth: Math.max(0, finiteOr(candidate.waterDepth, 0)),
		soilAccessScore: clamp01(candidate.soilAccessScore),
		visibilityScore: clamp01(candidate.visibilityScore),
		roadAccessScore: clamp01(candidate.roadAccessScore),
		isCanonicalParcel: candidate.isCanonicalParcel !== false,
		occupied: candidate.occupied === true,
		reserved: candidate.reserved === true,
		nearestSettlementRoleDistanceMeters: Math.max(0, finiteOr(candidate.nearestSettlementRoleDistanceMeters, 1_000_000)),
	});
}

function availabilityPenalty(candidate) {
	if (!candidate.isCanonicalParcel || candidate.occupied || candidate.reserved) return 0;
	return 1;
}

function surfaceSafetyScore(candidate, maximumSlope = SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFunctionalSlopeDegrees) {
	if (candidate.waterDepth > SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFunctionalWaterDepthMeters) return 0;
	if (candidate.slopeDegrees > maximumSlope) return 0;
	return clamp01(1 - candidate.slopeDegrees / Math.max(0.01, maximumSlope));
}

function serviceSpacingScore(candidate) {
	const minimum = SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.minimumBuildingSeparationMeters;
	const distance = candidate.nearestSettlementRoleDistanceMeters;
	if (!Number.isFinite(distance)) return 1;
	if (distance < minimum) return 0;
	return clamp01((distance - minimum) / minimum);
}

function innerSettlementScore(candidate, preferredRadius, radiusSpread, roadPreferred, roadSpread) {
	const radiusScore = ringScore(candidate.radiusMeters, preferredRadius, radiusSpread);
	const roadScore = smoothPreference(candidate.roadDistanceMeters, roadPreferred, roadSpread);
	return radiusScore * 0.46 + roadScore * 0.4 + candidate.roadAccessScore * 0.14;
}

function peripheralServiceScore(candidate, preferredRadius, roadPreferred, roadSpread) {
	const radiusScore = ringScore(candidate.radiusMeters, preferredRadius, 8);
	const roadScore = smoothPreference(candidate.roadDistanceMeters, roadPreferred, roadSpread);
	return radiusScore * 0.42 + roadScore * 0.24 + candidate.roadAccessScore * 0.12 + candidate.visibilityScore * 0.22;
}

function farmWaterAccessScore(candidate) {
	if (candidate.waterDepth > SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFunctionalWaterDepthMeters) return 0;
	const distance = candidate.waterDistanceMeters;
	if (distance > SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFarmWaterAccessMeters) return 0;
	return smoothPreference(distance, SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.preferredFarmWaterAccessMeters, 72);
}

/**
 * Score a candidate for one functional role. A score of 0 means the parcel is unsuitable.
 */
export function scoreSettlementFunctionalSite(role, candidate = {}) {
	const normalized = normalizeCandidate(candidate);
	const availability = availabilityPenalty(normalized);
	if (availability === 0) return 0;

	const surfaceScore = role === 'farm' || role === 'barn'
		? surfaceSafetyScore(normalized, SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFarmSlopeDegrees)
		: surfaceSafetyScore(normalized);
	if (surfaceScore <= 0) return 0;

	const spacingScore = serviceSpacingScore(normalized);
	if (spacingScore <= 0) return 0;

	let roleScore = 0;
	switch (role) {
		case 'market':
			roleScore = innerSettlementScore(
				normalized,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.innerRadiusMeters,
				9,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.preferredMarketRoadDistanceMeters,
				14,
			);
			break;
		case 'tavern':
			roleScore = innerSettlementScore(
				normalized,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.innerRadiusMeters + 2,
				10,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.preferredTavernRoadDistanceMeters,
				16,
			) * 0.8 + normalized.visibilityScore * 0.2;
			break;
		case 'blacksmith':
			roleScore = innerSettlementScore(
				normalized,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.innerRadiusMeters + 5,
				12,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.preferredBlacksmithRoadDistanceMeters,
				15,
			) * 0.7 + normalized.visibilityScore * 0.3;
			break;
		case 'stable':
			roleScore = peripheralServiceScore(
				normalized,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.minimumStableEdgeRadiusMeters + 4,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.preferredStableRoadDistanceMeters,
				20,
			) * 0.78 + normalized.visibilityScore * 0.22;
			if (normalized.radiusMeters < SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.minimumStableEdgeRadiusMeters) return 0;
			if (normalized.roadDistanceMeters > SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumStableRoadDistanceMeters) return 0;
			break;
		case 'farm':
			roleScore = clamp01(
				candidate.soilAccessScore * 0.45 +
				farmWaterAccessScore(normalized) * 0.35 +
				smoothPreference(normalized.radiusMeters, 44, 18) * 0.1 +
				(1 - normalized.roadDistanceMeters / Math.max(1, SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFarmRoadDistanceMeters)) * 0.1,
			);
			if (normalized.radiusMeters < SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.outerServiceRadiusMeters) return 0;
			if (normalized.roadDistanceMeters > SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFarmRoadDistanceMeters) return 0;
			break;
		case 'barn':
			roleScore = clamp01(
				candidate.soilAccessScore * 0.42 +
				farmWaterAccessScore(normalized) * 0.2 +
				smoothPreference(normalized.radiusMeters, 40, 16) * 0.26 +
				normalized.roadAccessScore * 0.12,
			);
			if (normalized.radiusMeters < SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.outerServiceRadiusMeters - 3) return 0;
			break;
		case 'barracks':
			if (normalized.radiusMeters < SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.minimumBarracksRoadDistanceMeters) return 0;
			roleScore = peripheralServiceScore(
				normalized,
				SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.preferredBarracksRadiusMeters,
				24,
				22,
			) * 0.6 + normalized.visibilityScore * 0.3 + normalized.roadAccessScore * 0.1;
			break;
		default:
			return 0;
	}

	const spacingWeight = role === 'farm' || role === 'barn' ? 0.8 : 1;
	return clamp01(roleScore * 0.72 + surfaceScore * 0.16 + spacingScore * 0.12 * spacingWeight);
}

/**
 * Score all known roles for a candidate. Keeping this as one call avoids subtle divergence between
 * role-specific UI/manifest generation and scene placement decisions.
 */
export function scoreSettlementFunctionalRoles(candidate = {}) {
	return Object.freeze(Object.fromEntries(
		SETTLEMENT_FUNCTIONAL_ROLES.map((role) => [role, scoreSettlementFunctionalSite(role, candidate)]),
	));
}

function stableCandidateComparator(left, right) {
	if (left.score !== right.score) return right.score - left.score;
	if (left.roadDistanceMeters !== right.roadDistanceMeters) return left.roadDistanceMeters - right.roadDistanceMeters;
	if (left.radiusMeters !== right.radiusMeters) return left.radiusMeters - right.radiusMeters;
	if (left.x !== right.x) return left.x - right.x;
	return left.z - right.z;
}

/**
 * Pick one site for a role from a candidate set. Ties are deterministic and do not depend on array
 * insertion order after the candidate's explicit x/z values have been supplied.
 */
export function selectSettlementFunctionalSite(role, candidates = [], {
	minimumScore = 0.22,
	reservedRoles = [],
} = {}) {
	if (!SETTLEMENT_FUNCTIONAL_ROLES.includes(role) || !Array.isArray(candidates)) return null;
	const reserved = new Set(Array.isArray(reservedRoles) ? reservedRoles : []);
	const ranked = candidates
		.map((candidate) => {
			const normalized = normalizeCandidate(candidate);
			return {
				...normalized,
				score: scoreSettlementFunctionalSite(role, normalized),
			};
		})
		.filter((candidate) => candidate.score >= minimumScore && !reserved.has(candidate.role || ''))
		.sort(stableCandidateComparator);
	if (ranked.length === 0) return null;
	return Object.freeze({
		role,
		score: ranked[0].score,
		x: ranked[0].x,
		z: ranked[0].z,
		radiusMeters: ranked[0].radiusMeters,
		roadDistanceMeters: ranked[0].roadDistanceMeters,
		waterDistanceMeters: ranked[0].waterDistanceMeters,
		soilAccessScore: ranked[0].soilAccessScore,
	});
}

/**
 * Build a complete role→parcel plan. One candidate cannot be reused unless explicitly allowed,
 * preventing all functional buildings from collapsing onto the strongest market parcel.
 */
export function buildSettlementFunctionalPlacementPlan(candidates = [], {
	minimumScore = 0.22,
	roles = SETTLEMENT_FUNCTIONAL_ROLES,
} = {}) {
	const requestedRoles = [...new Set((Array.isArray(roles) ? roles : []).filter((role) => SETTLEMENT_FUNCTIONAL_ROLES.includes(role)))];
	const available = (Array.isArray(candidates) ? candidates : []).map(normalizeCandidate);
	const assigned = [];
	const used = new Set();
	const plan = [];

	for (const role of requestedRoles) {
		const ranked = available
			.filter((candidate) => !used.has(`${candidate.x}:${candidate.z}`))
			.map((candidate) => ({
				...candidate,
				score: scoreSettlementFunctionalSite(role, candidate),
			}))
			.filter((candidate) => candidate.score >= minimumScore)
			.sort(stableCandidateComparator);
		if (ranked.length === 0) {
			plan.push(Object.freeze({ role, available: false, reason: 'no-safe-canonical-parcel' }));
			continue;
		}
		const selected = ranked[0];
		const key = `${selected.x}:${selected.z}`;
		used.add(key);
		assigned.push(key);
		plan.push(Object.freeze({
			role,
			available: true,
			score: selected.score,
			x: selected.x,
			z: selected.z,
			radiusMeters: selected.radiusMeters,
			roadDistanceMeters: selected.roadDistanceMeters,
			waterDistanceMeters: selected.waterDistanceMeters,
			soilAccessScore: selected.soilAccessScore,
		}));
	}

	return Object.freeze({
		policyId: SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.id,
		roles: Object.freeze(plan),
		assignedCandidateCount: assigned.length,
		candidateCount: available.length,
	});
}

export function resolveSettlementFunctionalAssetClass(role) {
	switch (role) {
		case 'market': return 'vendor-stall';
		case 'tavern': return 'tavern-house';
		case 'blacksmith': return 'blacksmith-forge';
		case 'stable': return 'stable-barn';
		case 'farm': return 'farm-plot';
		case 'barn': return 'barn-storage';
		case 'barracks': return 'barracks-garrison';
		default: return null;
	}
}

export function resolveSettlementFunctionalInteraction(role) {
	switch (role) {
		case 'market': return Object.freeze({ interaction: 'trade', service: 'market-trade' });
		case 'tavern': return Object.freeze({ interaction: 'rest', service: 'tavern-rest' });
		case 'blacksmith': return Object.freeze({ interaction: 'craft', service: 'smithing' });
		case 'stable': return Object.freeze({ interaction: 'travel', service: 'stable-travel' });
		case 'farm': return Object.freeze({ interaction: 'provision', service: 'farm-provisioning' });
		case 'barn': return Object.freeze({ interaction: 'storage', service: 'farm-storage' });
		case 'barracks': return Object.freeze({ interaction: 'quest', service: 'barracks-quest' });
		default: return null;
	}
}

export function createSettlementFunctionalPlacementManifest(plan) {
	if (!plan || !Array.isArray(plan.roles)) return null;
	return Object.freeze({
		policyId: SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.id,
		entries: Object.freeze(plan.roles.map((entry) => Object.freeze({
			role: entry.role,
			available: entry.available === true,
			assetClass: resolveSettlementFunctionalAssetClass(entry.role),
			interaction: entry.available ? resolveSettlementFunctionalInteraction(entry.role) : null,
			score: Number.isFinite(entry.score) ? entry.score : null,
			position: entry.available && Number.isFinite(entry.x) && Number.isFinite(entry.z)
				? Object.freeze({ x: entry.x, z: entry.z })
				: null,
			roadDistanceMeters: Number.isFinite(entry.roadDistanceMeters) ? entry.roadDistanceMeters : null,
			waterDistanceMeters: Number.isFinite(entry.waterDistanceMeters) ? entry.waterDistanceMeters : null,
		}))),
	});
}

export function isSettlementFunctionalPlacementPolicySane() {
	const policy = SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY;
	return policy.innerRadiusMeters < policy.outerServiceRadiusMeters
		&& policy.minimumBuildingSeparationMeters > 0
		&& policy.maximumFunctionalSlopeDegrees > 0
		&& policy.maximumFarmSlopeDegrees > 0
		&& policy.maximumFarmSlopeDegrees < policy.maximumFunctionalSlopeDegrees
		&& policy.minimumStableEdgeRadiusMeters < policy.maximumStableRoadDistanceMeters
		&& policy.minimumBarracksRoadDistanceMeters < policy.maximumBarracksRoadDistanceMeters
		&& policy.preferredFarmWaterAccessMeters < policy.maximumFarmWaterAccessMeters;
}
