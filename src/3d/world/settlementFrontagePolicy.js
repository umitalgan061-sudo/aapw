/**
 * Road-aware frontage policy for settlement architecture.
 *
 * This is a pure decision layer: it does not own terrain, roads, model loading or materials.
 * `villages.js` remains the scene owner and can feed its canonical roadEdges + terrain sampler here.
 * The policy makes buildings read as a lived-in settlement rather than randomly rotated objects:
 * near-road buildings face a real road segment, distant buildings retain deterministic organic yaw,
 * and frontage is scored with slope/relief/water/road evidence before an authored GLB is promoted.
 *
 * The returned records are intentionally serialisable and deterministic. They are suitable for
 * placement manifests/userData without importing any editor or DOM code into runtime.
 */

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

export const SETTLEMENT_FRONTAGE_POLICY = Object.freeze({
	id: 'settlement-road-frontage-v1-2026-09-07',
	preferredRoadDistanceMeters: 18,
	alignmentDistanceMeters: 46,
	fullAlignmentDistanceMeters: 28,
	minimumRoadDistanceMeters: 6,
	organicYawWeight: 0.22,
	roadYawWeight: 0.78,
	preferredSetbackMeters: 10,
	minimumSetbackMeters: 6,
	maximumSetbackMeters: 30,
	maxFrontageSlopeDegrees: 12,
	maxFrontageReliefMeters: 1.15,
	roadSearchMaxSegmentMeters: 82,
});

function finiteOr(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
	return Math.max(0, Math.min(1, finiteOr(value, 0)));
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function wrapRadians(value) {
	const wrapped = finiteOr(value, 0) % TAU;
	return wrapped < 0 ? wrapped + TAU : wrapped;
}

function signedAngleDelta(from, to) {
	const a = wrapRadians(from);
	const b = wrapRadians(to);
	let delta = b - a;
	if (delta > Math.PI) delta -= TAU;
	if (delta < -Math.PI) delta += TAU;
	return delta;
}

function pointDistanceSquared(ax, az, bx, bz) {
	const dx = bx - ax;
	const dz = bz - az;
	return dx * dx + dz * dz;
}

/**
 * Project a point onto a road polyline segment. The result includes the exact nearest point,
 * distance, segment index and tangent yaw. Invalid/degenerate segments are ignored.
 */
export function projectPointToRoadSegment(point, start, end, edgeIndex = 0, segmentIndex = 0) {
	if (!point || !start || !end) return null;
	const ax = finiteOr(start.x);
	const az = finiteOr(start.z);
	const bx = finiteOr(end.x);
	const bz = finiteOr(end.z);
	const px = finiteOr(point.x);
	const pz = finiteOr(point.z);
	const dx = bx - ax;
	const dz = bz - az;
	const lengthSquared = dx * dx + dz * dz;
	if (lengthSquared <= EPSILON) return null;
	const t = clamp(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0, 1);
	const x = ax + dx * t;
	const z = az + dz * t;
	const length = Math.sqrt(lengthSquared);
	const tangentYaw = Math.atan2(dx / length, dz / length);
	const normalYaw = tangentYaw + Math.PI * 0.5;
	const signedSide = ((px - x) * Math.sin(normalYaw) + (pz - z) * Math.cos(normalYaw)) >= 0 ? 1 : -1;
	return Object.freeze({
		edgeIndex,
		segmentIndex,
		t,
		x,
		z,
		distanceMeters: Math.sqrt(pointDistanceSquared(px, pz, x, z)),
		tangentYaw,
		normalYaw,
		signedSide,
		segmentLengthMeters: length,
	});
}

/**
 * Find the nearest usable road segment. The search stays inside the caller-provided canonical
 * roadEdges; the function never invents a road or uses a settlement centre as a fake road.
 */
export function findNearestSettlementRoad(point, roadEdges = [], {
	maxDistanceMeters = SETTLEMENT_FRONTAGE_POLICY.roadSearchMaxSegmentMeters,
} = {}) {
	if (!point || !Array.isArray(roadEdges)) return null;
	let best = null;
	const maxDistanceSquared = Math.pow(Math.max(0, finiteOr(maxDistanceMeters, 0)), 2);
	for (let edgeIndex = 0; edgeIndex < roadEdges.length; edgeIndex += 1) {
		const edge = roadEdges[edgeIndex];
		const points = Array.isArray(edge?.points) ? edge.points : [];
		for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
			const candidate = projectPointToRoadSegment(point, points[segmentIndex - 1], points[segmentIndex], edgeIndex, segmentIndex - 1);
			if (!candidate) continue;
			const distanceSquared = candidate.distanceMeters * candidate.distanceMeters;
			if (distanceSquared > maxDistanceSquared) continue;
			const better = !best || distanceSquared < best.distanceMeters * best.distanceMeters - EPSILON;
			const tied = best && Math.abs(candidate.distanceMeters - best.distanceMeters) <= EPSILON;
			const stableTie = tied && (edgeIndex < best.edgeIndex || (edgeIndex === best.edgeIndex && segmentIndex - 1 < best.segmentIndex));
			if (better || stableTie) best = candidate;
		}
	}
	return best ? Object.freeze(best) : null;
}

function deterministicUnit(value) {
	const n = Math.sin(finiteOr(value, 0) * 12.9898 + 78.233) * 43758.5453;
	return n - Math.floor(n);
}

function resolveOrganicYaw({ baseYaw = 0, seed = 0 } = {}) {
	const jitter = (deterministicUnit(seed) - 0.5) * Math.PI * 0.7;
	return wrapRadians(finiteOr(baseYaw, 0) + jitter);
}

/**
 * Compute a frontage yaw. When a building is close enough to a canonical road, the yaw smoothly
 * approaches the road tangent (the convention used by village house fronts). Farther out it keeps
 * a deterministic organic orientation so the settlement does not become a row of clones.
 */
export function resolveSettlementBuildingYaw({
	baseYaw = 0,
	seed = 0,
	road = null,
	roadDistanceMeters = road?.distanceMeters,
} = {}) {
	const organicYaw = resolveOrganicYaw({ baseYaw, seed });
	if (!road || !Number.isFinite(roadDistanceMeters)) return organicYaw;
	const distance = Math.max(0, roadDistanceMeters);
	if (distance >= SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters) return organicYaw;
	const targetYaw = wrapRadians(road.tangentYaw);
	const strength = distance <= SETTLEMENT_FRONTAGE_POLICY.fullAlignmentDistanceMeters
		? 1
		: clamp01(1 - ((distance - SETTLEMENT_FRONTAGE_POLICY.fullAlignmentDistanceMeters) /
			(SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters - SETTLEMENT_FRONTAGE_POLICY.fullAlignmentDistanceMeters));
	const desiredDelta = signedAngleDelta(organicYaw, targetYaw);
	const weighted = organicYaw + desiredDelta * strength * SETTLEMENT_FRONTAGE_POLICY.roadYawWeight;
	return wrapRadians(weighted);
}

/**
 * Setback keeps a building frontage readable and avoids placing entrances directly on the carriageway.
 * The result is bounded to the policy envelope and slightly increases for steep/rough sites.
 */
export function resolveSettlementFrontageSetback({
	roadDistanceMeters = 18,
	slopeDegrees = 0,
	footprintReliefMeters = 0,
} = {}) {
	const distance = Math.max(0, finiteOr(roadDistanceMeters, SETTLEMENT_FRONTAGE_POLICY.preferredRoadDistanceMeters));
	const slope = Math.max(0, Math.abs(finiteOr(slopeDegrees, 0)));
	const relief = Math.max(0, finiteOr(footprintReliefMeters, 0));
	const roadComponent = clamp(
		SETTLEMENT_FRONTAGE_POLICY.preferredSetbackMeters + (distance - SETTLEMENT_FRONTAGE_POLICY.preferredRoadDistanceMeters) * 0.2,
		SETTLEMENT_FRONTAGE_POLICY.minimumSetbackMeters,
		SETTLEMENT_FRONTAGE_POLICY.maximumSetbackMeters,
	);
	const terrainComponent = slope * 0.2 + relief * 1.25;
	return clamp(
		roadComponent + terrainComponent,
		SETTLEMENT_FRONTAGE_POLICY.minimumSetbackMeters,
		SETTLEMENT_FRONTAGE_POLICY.maximumSetbackMeters,
	);
}

export function scoreSettlementFrontage({
	roadDistanceMeters = 1_000_000,
	slopeDegrees = 0,
	footprintReliefMeters = 0,
	waterDepth = 0,
	isArchitectureLandmark = false,
} = {}) {
	const distance = Math.max(0, finiteOr(roadDistanceMeters, 1_000_000));
	const slope = Math.abs(finiteOr(slopeDegrees, 0));
	const relief = Math.max(0, finiteOr(footprintReliefMeters, 0));
	const roadScore = Math.exp(-Math.pow((distance - SETTLEMENT_FRONTAGE_POLICY.preferredRoadDistanceMeters) /
		(SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters * 0.7), 2));
	const slopeScore = 1 - clamp01((slope - SETTLEMENT_FRONTAGE_POLICY.maxFrontageSlopeDegrees * 0.35) /
		(SETTLEMENT_FRONTAGE_POLICY.maxFrontageSlopeDegrees * 0.65));
	const reliefScore = 1 - clamp01((relief - 0.25) /
		Math.max(0.01, SETTLEMENT_FRONTAGE_POLICY.maxFrontageReliefMeters - 0.25));
	const waterScore = 1 - clamp01(Math.max(0, finiteOr(waterDepth, 0)) / 2);
	const landmarkBias = isArchitectureLandmark ? 0.06 : 0;
	return clamp01(roadScore * 0.46 + slopeScore * 0.24 + reliefScore * 0.2 + waterScore * 0.1 + landmarkBias);
}

export function resolveSettlementFrontageContext({
	x = 0,
	z = 0,
	baseYaw = 0,
	seed = 0,
	roadEdges = [],
	slopeDegrees = 0,
	waterDepth = 0,
	footprintReliefMeters = 0,
	isArchitectureLandmark = false,
} = {}) {
	const nearestRoad = findNearestSettlementRoad({ x, z }, roadEdges);
	const roadDistanceMeters = nearestRoad?.distanceMeters ?? 1_000_000;
	const yaw = resolveSettlementBuildingYaw({
		baseYaw,
		seed,
		road: nearestRoad,
		roadDistanceMeters,
	});
	const setbackMeters = resolveSettlementFrontageSetback({
		roadDistanceMeters,
		slopeDegrees,
		footprintReliefMeters,
	});
	const score = scoreSettlementFrontage({
		roadDistanceMeters,
		slopeDegrees,
		footprintReliefMeters,
		waterDepth,
		isArchitectureLandmark,
	});
	const aligned = Boolean(nearestRoad && roadDistanceMeters < SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters);
	return Object.freeze({
		policyId: SETTLEMENT_FRONTAGE_POLICY.id,
		roadDistanceMeters,
		nearestRoad: nearestRoad ? Object.freeze({ ...nearestRoad }) : null,
		buildingYawRadians: yaw,
		frontageSetbackMeters: setbackMeters,
		frontageScore: score,
		alignedToCanonicalRoad: aligned,
	});
}

export function compareSettlementFrontageQuality(left = {}, right = {}) {
	const leftScore = finiteOr(left.frontageScore, scoreSettlementFrontage(left));
	const rightScore = finiteOr(right.frontageScore, scoreSettlementFrontage(right));
	if (leftScore !== rightScore) return rightScore - leftScore;
	const leftDistance = finiteOr(left.roadDistanceMeters, 1_000_000);
	const rightDistance = finiteOr(right.roadDistanceMeters, 1_000_000);
	if (leftDistance !== rightDistance) return leftDistance - rightDistance;
	const leftX = finiteOr(left.x, 0);
	const rightX = finiteOr(right.x, 0);
	if (leftX !== rightX) return leftX - rightX;
	return finiteOr(left.z, 0) - finiteOr(right.z, 0);
}

export function isSettlementFrontagePolicySane() {
	const values = SETTLEMENT_FRONTAGE_POLICY;
	return values.alignmentDistanceMeters > values.fullAlignmentDistanceMeters
		&& values.fullAlignmentDistanceMeters > values.minimumRoadDistanceMeters
		&& values.maximumSetbackMeters > values.minimumSetbackMeters
		&& values.maximumSetbackMeters >= values.preferredSetbackMeters
		&& values.maxFrontageSlopeDegrees > 0
		&& values.maxFrontageReliefMeters > 0
		&& values.roadYawWeight >= 0 && values.roadYawWeight <= 1
		&& values.organicYawWeight >= 0 && values.organicYawWeight <= 1;
}
