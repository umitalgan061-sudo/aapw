/**
 * Geographic planner for small, non-interactive settlement ambient props.
 *
 * All coordinates come from existing kingdom-seat, routed-road and collider-owned terrain data.
 * This module never edits terrain, roads, hydrology, collision or gameplay. Its only job is to turn
 * those authorities into deterministic render-only placement metadata that can be consumed by the
 * renderer/material layer in `settlementAmbientProps.js`.
 *
 * The v3 planner replaces the old "look roughly toward a road from the seat" rule with actual
 * incident-road segment sampling. Logistics props are sampled from a routed road centreline, offset
 * onto a bounded shoulder and then re-validated against the live terrain/road surface query. Social
 * props keep a looser apron distribution. This removes the visible procedural ring without inventing
 * a new settlement, road or coastline.
 * @module world/settlementAmbientPlacement
 */

import { mulberry32 } from './terrain.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';
import { valyriaInfluenceAtWorldXZ } from './valyriaGeology.js';

export const SETTLEMENT_AMBIENT_PROP_POLICY = Object.freeze({
	id: 'settlement-ambient-props-2026-09-02-v3-road-shoulder-geographic-dressing',
	renderOnly: true,
	deterministic: true,
	canonicalSettlementAnchorsUnchanged: true,
	canonicalTerrainUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalRoadsUnchanged: true,
	canonicalCollidersUnchanged: true,
	gameplayInactive: true,
	innerRadiusMeters: 52,
	outerRadiusMeters: 86,
	desktopPropsPerSeat: 5,
	mobilePropsPerSeat: 3,
	minimumPropSpacingMeters: 8.5,
	minimumRoadDistanceMeters: 7,
	maximumLogisticsRoadDistanceMeters: 23,
	shorelineClearanceMeters: 1.5,
	maximumSlopeDegrees: 14,
	terrainSlopeSampleMeters: 2.5,
	maximumAttemptsPerProp: 22,
	logisticsSlotsPerSeat: 3,
	logisticsAttemptsBeforeSocialFallback: 15,
	routeShoulderMinMeters: 8,
	routeShoulderMaxMeters: 19,
	routeApronSearchPaddingMeters: 28,
	routeSegmentRadiusSampleCount: 9,
	routeTangentYawJitterRadians: 0.16,
	socialBenchYawJitterRadians: 0.34,
	fallbackFabricTextureSize: 96,
	fallbackFabricRepeat: 2.8,
	hostedPreflightMinBytes: 512,
	maximumHydratedSourceBytes: 12 * 1024 * 1024,
	maximumHydratedPrimitiveCount: 18,
	sourceExtentEpsilonMeters: 0.001,
	maximumSourceAspectRatio: 24,
	groupName: 'settlement-ambient-props',
	hydratedGroupName: 'settlement-ambient-props-hydrated',
	placementAuthority: 'kingdom-seat + collider-owned terrain + routed roads',
	routeFacingDistribution: true,
	routeShoulderProjection: true,
	fallbackSurfaceFabric: true,
	climateAuthorities: Object.freeze([
		'northReferenceCryosphereAtWorldXZ',
		'valyriaInfluenceAtWorldXZ',
	]),
});

export const SETTLEMENT_AMBIENT_PROP_FAMILIES = Object.freeze({
	barrel: Object.freeze({
		id: 'barrel',
		assetUrl: 'assets/models/props/barrel_zjCQP1TAci.glb',
		targetHorizontalMeters: 0.92,
		fallbackColor: 0x6d4b2f,
		roughnessFloor: 0.76,
		weatheringKind: 'wood',
	}),
	crate: Object.freeze({
		id: 'crate',
		assetUrl: 'assets/models/props/crate_3OEFd1AWfa.glb',
		targetHorizontalMeters: 1.18,
		fallbackColor: 0x725337,
		roughnessFloor: 0.79,
		weatheringKind: 'wood',
	}),
	bench: Object.freeze({
		id: 'bench',
		assetUrl: 'assets/models/props/greek_stone_bench.glb',
		targetHorizontalMeters: 2.65,
		fallbackColor: 0x817b70,
		roughnessFloor: 0.87,
		weatheringKind: 'stone',
	}),
});

export const SETTLEMENT_AMBIENT_FAMILY_IDS = Object.freeze(Object.keys(SETTLEMENT_AMBIENT_PROP_FAMILIES));

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finite = (value, fallback = 0) => {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
};

function fnv1a(text) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function squaredDistance(ax, az, bx, bz) {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

export function projectPointToAmbientRoadSegment(px, pz, ax, az, bx, bz) {
	const abX = bx - ax;
	const abZ = bz - az;
	const lengthSquared = abX * abX + abZ * abZ;
	if (lengthSquared <= 1e-9) {
		const distance = Math.hypot(px - ax, pz - az);
		return Object.freeze({ x: ax, z: az, t: 0, distance, tangentX: 1, tangentZ: 0 });
	}
	const rawT = ((px - ax) * abX + (pz - az) * abZ) / lengthSquared;
	const t = Math.max(0, Math.min(1, rawT));
	const x = ax + abX * t;
	const z = az + abZ * t;
	const length = Math.sqrt(lengthSquared);
	return Object.freeze({
		x,
		z,
		t,
		distance: Math.hypot(px - x, pz - z),
		tangentX: abX / length,
		tangentZ: abZ / length,
	});
}

export function nearestAmbientRoadSegment(x, z, roadEdges = [], { seatId = null, incidentOnly = false } = {}) {
	let best = null;
	for (let edgeIndex = 0; edgeIndex < roadEdges.length; edgeIndex += 1) {
		const edge = roadEdges[edgeIndex];
		const incident = seatId != null && (edge?.fromId === seatId || edge?.toId === seatId);
		if (incidentOnly && !incident) continue;
		const points = edge?.points || [];
		for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
			const a = points[segmentIndex - 1];
			const b = points[segmentIndex];
			if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
			const projection = projectPointToAmbientRoadSegment(x, z, a.x, a.z, b.x, b.z);
			if (!best || projection.distance < best.distance) {
				best = {
					...projection,
					edge,
					edgeIndex,
					segmentIndex: segmentIndex - 1,
					incident,
					a,
					b,
				};
			}
		}
	}
	return best ? Object.freeze(best) : null;
}

export function distanceToAmbientRoads(x, z, roadEdges = []) {
	return nearestAmbientRoadSegment(x, z, roadEdges)?.distance ?? Infinity;
}

function distanceToNearestSeat(x, z, seats = []) {
	let minimum = Infinity;
	for (const seat of seats) {
		if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
		minimum = Math.min(minimum, Math.hypot(x - seat.x, z - seat.z));
	}
	return minimum;
}

export function sampleAmbientPropTerrainFrame(
	sampleHeightMeters,
	x,
	z,
	offsetMeters = SETTLEMENT_AMBIENT_PROP_POLICY.terrainSlopeSampleMeters,
) {
	const offset = Math.max(0.5, finite(offsetMeters, 2.5));
	const height = sampleHeightMeters(x, z);
	const hPosX = sampleHeightMeters(x + offset, z);
	const hNegX = sampleHeightMeters(x - offset, z);
	const hPosZ = sampleHeightMeters(x, z + offset);
	const hNegZ = sampleHeightMeters(x, z - offset);
	if (![height, hPosX, hNegX, hPosZ, hNegZ].every(Number.isFinite)) {
		return Object.freeze({
			height: Number.NaN,
			slopeDegrees: Number.POSITIVE_INFINITY,
			gradientX: 0,
			gradientZ: 0,
		});
	}
	const gradientX = (hPosX - hNegX) / (offset * 2);
	const gradientZ = (hPosZ - hNegZ) / (offset * 2);
	const slopeDegrees = Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
	return Object.freeze({ height, slopeDegrees, gradientX, gradientZ });
}

export function createAmbientPropSurfaceQuery({ sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {
	return (x, z) => {
		const frame = sampleAmbientPropTerrainFrame(sampleHeightMeters, x, z);
		const waterDepth = Math.max(0, seaLevelMeters - frame.height);
		return {
			height: frame.height,
			slopeDegrees: frame.slopeDegrees,
			waterDepth,
			roadDistance: distanceToAmbientRoads(x, z, roadEdges),
			settlementDistance: distanceToNearestSeat(x, z, seats),
			moisture: null,
			biome: null,
			waterType: waterDepth > 0 ? 'water' : null,
		};
	};
}

function climateProfileAtWorldXZ(x, z) {
	const north = northReferenceCryosphereAtWorldXZ(x, z) || {};
	const permanentIce = clamp01(finite(north.permanentIce));
	const tundra = clamp01(finite(north.tundra));
	const snow = clamp01(permanentIce * 0.92 + tundra * 0.36);
	const valyria = clamp01(finite(valyriaInfluenceAtWorldXZ(x, z)));
	return Object.freeze({ permanentIce, tundra, snow, valyria });
}

function segmentIntersectsSeatApron(seat, a, b) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	const padding = policy.routeApronSearchPaddingMeters;
	const minWanted = Math.max(0, policy.innerRadiusMeters - padding);
	const maxWanted = policy.outerRadiusMeters + padding;
	const projection = projectPointToAmbientRoadSegment(seat.x, seat.z, a.x, a.z, b.x, b.z);
	const maxEndpointDistance = Math.max(
		Math.hypot(a.x - seat.x, a.z - seat.z),
		Math.hypot(b.x - seat.x, b.z - seat.z),
	);
	return projection.distance <= maxWanted && maxEndpointDistance >= minWanted;
}

export function buildAmbientRoadApronProfile(seat, roadEdges = []) {
	const segments = [];
	let incidentSegmentCount = 0;
	for (let edgeIndex = 0; edgeIndex < roadEdges.length; edgeIndex += 1) {
		const edge = roadEdges[edgeIndex];
		const incident = edge?.fromId === seat?.id || edge?.toId === seat?.id;
		const points = edge?.points || [];
		for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
			const a = points[segmentIndex - 1];
			const b = points[segmentIndex];
			if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
			if (!segmentIntersectsSeatApron(seat, a, b)) continue;
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const length = Math.hypot(dx, dz);
			if (length <= 1e-4) continue;
			const midpointX = (a.x + b.x) * 0.5;
			const midpointZ = (a.z + b.z) * 0.5;
			const midpointSeatDistance = Math.hypot(midpointX - seat.x, midpointZ - seat.z);
			const segment = Object.freeze({
				edge,
				edgeIndex,
				segmentIndex: segmentIndex - 1,
				incident,
				a,
				b,
				length,
				tangentX: dx / length,
				tangentZ: dz / length,
				midpointSeatDistance,
			});
			segments.push(segment);
			if (incident) incidentSegmentCount += 1;
		}
	}

	segments.sort((left, right) => {
		if (left.incident !== right.incident) return left.incident ? -1 : 1;
		const leftDelta = Math.abs(left.midpointSeatDistance - (SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters + SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters) * 0.5);
		const rightDelta = Math.abs(right.midpointSeatDistance - (SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters + SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters) * 0.5);
		return leftDelta - rightDelta || left.edgeIndex - right.edgeIndex || left.segmentIndex - right.segmentIndex;
	});

	const selected = incidentSegmentCount > 0 ? segments.filter((segment) => segment.incident) : segments;
	return Object.freeze({
		seatId: seat?.id ?? null,
		segments: Object.freeze(selected),
		incidentSegmentCount,
		fallbackToNonIncident: incidentSegmentCount === 0 && selected.length > 0,
	});
}

function pointOnSegmentNearSeatRadius(segment, seat, targetRadiusMeters) {
	const sampleCount = SETTLEMENT_AMBIENT_PROP_POLICY.routeSegmentRadiusSampleCount;
	let best = null;
	for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
		const t = sampleCount <= 1 ? 0.5 : sampleIndex / (sampleCount - 1);
		const x = segment.a.x + (segment.b.x - segment.a.x) * t;
		const z = segment.a.z + (segment.b.z - segment.a.z) * t;
		const radius = Math.hypot(x - seat.x, z - seat.z);
		const error = Math.abs(radius - targetRadiusMeters);
		if (!best || error < best.error) best = { x, z, t, radius, error };
	}
	return best;
}

function routeShoulderCandidate(rng, seat, roadProfile, slot, attempt) {
	if (!roadProfile?.segments?.length) return null;
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	const segment = roadProfile.segments[(slot + attempt) % roadProfile.segments.length];
	const targetRadius = policy.innerRadiusMeters + 4 + rng() * (policy.outerRadiusMeters - policy.innerRadiusMeters - 8);
	const centreline = pointOnSegmentNearSeatRadius(segment, seat, targetRadius);
	if (!centreline) return null;
	const side = ((slot + attempt) & 1) === 0 ? -1 : 1;
	const shoulderMeters = policy.routeShoulderMinMeters + rng() * (policy.routeShoulderMaxMeters - policy.routeShoulderMinMeters);
	const normalX = -segment.tangentZ * side;
	const normalZ = segment.tangentX * side;
	const x = centreline.x + normalX * shoulderMeters;
	const z = centreline.z + normalZ * shoulderMeters;
	const anchorDistanceMeters = Math.hypot(x - seat.x, z - seat.z);
	if (anchorDistanceMeters < policy.innerRadiusMeters || anchorDistanceMeters > policy.outerRadiusMeters) return null;
	return {
		x,
		z,
		anchorDistanceMeters,
		distributionRole: 'logistics',
		routeFacing: true,
		routeEdgeIndex: segment.edgeIndex,
		routeSegmentIndex: segment.segmentIndex,
		routeIncident: segment.incident,
		routeShoulderTargetMeters: shoulderMeters,
		routeTangentRadians: Math.atan2(segment.tangentX, segment.tangentZ),
	};
}

function socialApronCandidate(rng, seat) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	const angle = rng() * TAU;
	const radius = Math.sqrt(
		rng() * (policy.outerRadiusMeters ** 2 - policy.innerRadiusMeters ** 2)
		+ policy.innerRadiusMeters ** 2,
	);
	return {
		x: seat.x + Math.cos(angle) * radius,
		z: seat.z + Math.sin(angle) * radius,
		anchorDistanceMeters: radius,
		distributionRole: 'social',
		routeFacing: false,
		routeEdgeIndex: null,
		routeSegmentIndex: null,
		routeIncident: false,
		routeShoulderTargetMeters: null,
		routeTangentRadians: null,
	};
}

function candidateForSlot(rng, seat, roadProfile, slot, attempt) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	const wantsLogistics = slot < policy.logisticsSlotsPerSeat
		&& attempt < policy.logisticsAttemptsBeforeSocialFallback
		&& roadProfile?.segments?.length > 0;
	return wantsLogistics
		? routeShoulderCandidate(rng, seat, roadProfile, slot, attempt)
		: socialApronCandidate(rng, seat);
}

function familyForPlacement(roll, profile, slopeDegrees, role = 'social') {
	const snow = profile.snow;
	const valyria = profile.valyria;
	if (role === 'logistics') {
		if (snow > 0.62 || valyria > 0.48) return roll < 0.52 ? 'crate' : roll < 0.88 ? 'barrel' : 'bench';
		return roll < 0.54 ? 'barrel' : roll < 0.93 ? 'crate' : 'bench';
	}
	if (snow > 0.62) return roll < 0.66 ? 'bench' : roll < 0.86 ? 'crate' : 'barrel';
	if (valyria > 0.48) return roll < 0.70 ? 'bench' : roll < 0.88 ? 'crate' : 'barrel';
	if (slopeDegrees > 9.5) return roll < 0.42 ? 'crate' : roll < 0.66 ? 'barrel' : 'bench';
	return roll < 0.18 ? 'barrel' : roll < 0.36 ? 'crate' : 'bench';
}

function isInsideWorld(x, z, worldWidthMeters, worldDepthMeters, margin = 4) {
	if (!Number.isFinite(worldWidthMeters) || !Number.isFinite(worldDepthMeters)) return true;
	return Math.abs(x) <= worldWidthMeters * 0.5 - margin && Math.abs(z) <= worldDepthMeters * 0.5 - margin;
}

function acceptedCandidate(candidate, {
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
	placed,
	worldWidthMeters,
	worldDepthMeters,
}) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	if (!candidate || !isInsideWorld(candidate.x, candidate.z, worldWidthMeters, worldDepthMeters)) return null;
	const frame = sampleAmbientPropTerrainFrame(sampleHeightMeters, candidate.x, candidate.z);
	if (!Number.isFinite(frame.height) || frame.height <= seaLevelMeters + policy.shorelineClearanceMeters) return null;
	if (frame.slopeDegrees > policy.maximumSlopeDegrees) return null;
	const road = nearestAmbientRoadSegment(candidate.x, candidate.z, roadEdges);
	const roadDistance = road?.distance ?? Infinity;
	if (roadDistance < policy.minimumRoadDistanceMeters) return null;
	if (candidate.distributionRole === 'logistics' && roadDistance > policy.maximumLogisticsRoadDistanceMeters) return null;
	if (placed.some((other) => squaredDistance(candidate.x, candidate.z, other.x, other.z) < policy.minimumPropSpacingMeters ** 2)) return null;
	const nearestSeatDistance = distanceToNearestSeat(candidate.x, candidate.z, seats);
	if (nearestSeatDistance + 0.001 < candidate.anchorDistanceMeters - 2) return null;
	return { frame, roadDistance, nearestRoad: road };
}

function placementYawRadians(rng, familyId, seat, accepted) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	if (accepted.distributionRole === 'logistics' && Number.isFinite(accepted.routeTangentRadians)) {
		if (familyId === 'bench') {
			const road = accepted.nearestRoad;
			const toRoadX = (road?.x ?? accepted.x) - accepted.x;
			const toRoadZ = (road?.z ?? accepted.z) - accepted.z;
			return Math.atan2(toRoadX, toRoadZ) + (rng() - 0.5) * policy.socialBenchYawJitterRadians;
		}
		return accepted.routeTangentRadians + (rng() - 0.5) * policy.routeTangentYawJitterRadians;
	}
	if (familyId === 'bench') {
		return Math.atan2(seat.x - accepted.x, seat.z - accepted.z)
			+ (rng() - 0.5) * policy.socialBenchYawJitterRadians;
	}
	return rng() * TAU;
}

function placementTintScalar(profile, variation) {
	const snowLift = profile.snow * 0.10;
	const ashDrop = profile.valyria * 0.14;
	return Math.max(-0.22, Math.min(0.22, (variation - 0.5) * 0.16 + snowLift - ashDrop));
}

export function checksumSettlementAmbientPlacements(placements = []) {
	const stable = placements.map((placement) => [
		placement.id,
		placement.seatId,
		placement.familyId,
		placement.x.toFixed(3),
		placement.y.toFixed(3),
		placement.z.toFixed(3),
		placement.yawRadians.toFixed(4),
		placement.scale.toFixed(4),
		placement.slopeDegrees.toFixed(3),
		placement.roadDistanceMeters.toFixed(3),
		placement.distributionRole,
		placement.routeFacing ? 'route' : 'free',
		placement.routeEdgeIndex ?? 'none',
		placement.routeSegmentIndex ?? 'none',
		placement.snow.toFixed(4),
		placement.valyria.toFixed(4),
	].join(':')).join('|');
	return fnv1a(stable).toString(16).padStart(8, '0');
}

export function generateSettlementAmbientPropPlacements({
	sampleHeightMeters,
	seaLevelMeters,
	seed,
	seats,
	roadEdges,
	worldWidthMeters = Infinity,
	worldDepthMeters = Infinity,
	isMobileClass = false,
}) {
	const policy = SETTLEMENT_AMBIENT_PROP_POLICY;
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters is required');
	if (!Array.isArray(seats) || !Array.isArray(roadEdges)) throw new TypeError('seats and roadEdges arrays are required');

	const rng = mulberry32((Number(seed) || 0) ^ 0x4150524e);
	const placements = [];
	const rejectionCounts = { attemptsExhausted: 0, invalidSurface: 0, routeCandidateMiss: 0 };
	const targetPerSeat = isMobileClass ? policy.mobilePropsPerSeat : policy.desktopPropsPerSeat;
	let routeApproachSeatCount = 0;
	let logisticsShoulderCount = 0;
	let logisticsRoadDistanceTotal = 0;
	let logisticsRoadDistanceMax = 0;

	for (const seat of seats) {
		if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
		const roadProfile = buildAmbientRoadApronProfile(seat, roadEdges);
		if (roadProfile.segments.length > 0) routeApproachSeatCount += 1;
		let placedForSeat = 0;

		for (let slot = 0; slot < targetPerSeat; slot += 1) {
			let accepted = null;
			for (let attempt = 0; attempt < policy.maximumAttemptsPerProp; attempt += 1) {
				const candidate = candidateForSlot(rng, seat, roadProfile, slot, attempt);
				if (!candidate) {
					rejectionCounts.routeCandidateMiss += 1;
					continue;
				}
				const surface = acceptedCandidate(candidate, {
					sampleHeightMeters,
					seaLevelMeters,
					seats,
					roadEdges,
					placed: placements,
					worldWidthMeters,
					worldDepthMeters,
				});
				if (!surface) {
					rejectionCounts.invalidSurface += 1;
					continue;
				}
				accepted = { ...candidate, ...surface };
				break;
			}
			if (!accepted) {
				rejectionCounts.attemptsExhausted += 1;
				continue;
			}

			const profile = climateProfileAtWorldXZ(accepted.x, accepted.z);
			const familyId = familyForPlacement(rng(), profile, accepted.frame.slopeDegrees, accepted.distributionRole);
			const family = SETTLEMENT_AMBIENT_PROP_FAMILIES[familyId];
			const variation = rng();
			const scale = (0.88 + rng() * 0.24) * (familyId === 'bench' ? 1.04 : 1);
			const yawRadians = placementYawRadians(rng, familyId, seat, accepted);
			const placement = Object.freeze({
				id: `${seat.id}-ambient-${slot}`,
				seatId: seat.id,
				familyId,
				x: accepted.x,
				y: accepted.frame.height,
				z: accepted.z,
				yawRadians,
				scale,
				targetHorizontalMeters: family.targetHorizontalMeters * scale,
				slopeDegrees: accepted.frame.slopeDegrees,
				roadDistanceMeters: accepted.roadDistance,
				seatDistanceMeters: accepted.anchorDistanceMeters,
				distributionRole: accepted.distributionRole,
				routeFacing: accepted.routeFacing,
				routeIncident: Boolean(accepted.routeIncident),
				routeEdgeIndex: accepted.routeEdgeIndex,
				routeSegmentIndex: accepted.routeSegmentIndex,
				routeShoulderTargetMeters: accepted.routeShoulderTargetMeters,
				routeTangentRadians: accepted.routeTangentRadians,
				snow: profile.snow,
				permanentIce: profile.permanentIce,
				tundra: profile.tundra,
				valyria: profile.valyria,
				variation,
				tintScalar: placementTintScalar(profile, variation),
			});
			placements.push(placement);
			placedForSeat += 1;
			if (placement.distributionRole === 'logistics') {
				logisticsShoulderCount += 1;
				logisticsRoadDistanceTotal += placement.roadDistanceMeters;
				logisticsRoadDistanceMax = Math.max(logisticsRoadDistanceMax, placement.roadDistanceMeters);
			}
		}
		if (placedForSeat === 0) rejectionCounts.attemptsExhausted += 1;
	}

	const familyCounts = Object.fromEntries(SETTLEMENT_AMBIENT_FAMILY_IDS.map((familyId) => [familyId, 0]));
	const climateCounts = { snow: 0, valyria: 0, temperate: 0 };
	const roleCounts = { logistics: 0, social: 0 };
	for (const placement of placements) {
		familyCounts[placement.familyId] += 1;
		roleCounts[placement.distributionRole] = (roleCounts[placement.distributionRole] || 0) + 1;
		if (placement.snow >= 0.25) climateCounts.snow += 1;
		else if (placement.valyria >= 0.25) climateCounts.valyria += 1;
		else climateCounts.temperate += 1;
	}

	const stats = Object.freeze({
		seatCount: seats.length,
		targetCount: seats.length * targetPerSeat,
		placedCount: placements.length,
		familyCounts: Object.freeze({ ...familyCounts }),
		climateCounts: Object.freeze({ ...climateCounts }),
		roleCounts: Object.freeze({ ...roleCounts }),
		routeApproachSeatCount,
		logisticsShoulderCount,
		meanLogisticsRoadDistanceMeters: logisticsShoulderCount > 0 ? logisticsRoadDistanceTotal / logisticsShoulderCount : null,
		maxLogisticsRoadDistanceMeters: logisticsShoulderCount > 0 ? logisticsRoadDistanceMax : null,
		rejectionCounts: Object.freeze({ ...rejectionCounts }),
		placementChecksum: checksumSettlementAmbientPlacements(placements),
	});
	return Object.freeze({ placements: Object.freeze(placements), stats });
}
