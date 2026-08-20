import { WORLD_SCALE } from '../config.js';

export const OWNER_MAP_FEATURE_GUIDE_POLICY = Object.freeze({
	id: 'owner-map-live-feature-guides-2026-08-20-v2',
	sourceAsset: 'map.png/map.png',
	sourceSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	pixelWidth: 1536,
	pixelHeight: 1024,
	roadInnerWidthNormalized: 0.006,
	roadOuterWidthNormalized: 0.024,
	roadPaintInnerWidthNormalized: 0.00035,
	roadPaintOuterWidthNormalized: 0.00155,
	roadOffGuideCostPenalty: 0.42,
	forestBackgroundAcceptance: 0.22,
});

const MAP_ASPECT = OWNER_MAP_FEATURE_GUIDE_POLICY.pixelWidth / OWNER_MAP_FEATURE_GUIDE_POLICY.pixelHeight;

// Hand-traced from the exact owner image above. Ellipses deliberately overlap: real forests on the
// painted map have soft/irregular boundaries, so the live scatter should read as connected woodland
// belts rather than hard biome decals.
export const REFERENCE_FOREST_GUIDES = Object.freeze([
	Object.freeze({ id: 'haunted-frostfang-woods', center: [0.158, 0.155], radius: [0.040, 0.055], strength: 0.72 }),
	Object.freeze({ id: 'northern-wolfswood', center: [0.156, 0.228], radius: [0.055, 0.060], strength: 1.00 }),
	Object.freeze({ id: 'riverlands-woods', center: [0.158, 0.430], radius: [0.043, 0.050], strength: 0.62 }),
	Object.freeze({ id: 'vale-woods', center: [0.225, 0.420], radius: [0.038, 0.042], strength: 0.52 }),
	Object.freeze({ id: 'qohor-forest', center: [0.405, 0.500], radius: [0.050, 0.050], strength: 0.88 }),
	Object.freeze({ id: 'ifequevron', center: [0.610, 0.425], radius: [0.078, 0.060], strength: 1.00 }),
	Object.freeze({ id: 'mossovy', center: [0.955, 0.445], radius: [0.055, 0.058], strength: 1.00 }),
	Object.freeze({ id: 'yi-ti-southern-forest', center: [0.790, 0.745], radius: [0.105, 0.060], strength: 1.00 }),
	Object.freeze({ id: 'sothoryos-west', center: [0.505, 0.955], radius: [0.095, 0.070], strength: 1.00 }),
	Object.freeze({ id: 'sothoryos-east', center: [0.610, 0.945], radius: [0.095, 0.075], strength: 1.00 }),
]);

// Major painted-road corridors visible on the reference. These do not replace settlement endpoints
// or the slope-aware A* safety rules. They are a soft preference field: when two routes are similarly
// safe, A* is cheaper near these corridors and therefore bends toward the owner map instead of
// inventing an unrelated shortest route.
export const REFERENCE_ROAD_GUIDES = Object.freeze([
	Object.freeze({ id: 'westeros-kingsroad', points: Object.freeze([[0.178, 0.168], [0.184, 0.245], [0.185, 0.320], [0.181, 0.400], [0.184, 0.485], [0.188, 0.565]]) }),
	Object.freeze({ id: 'westeros-west-branch', points: Object.freeze([[0.182, 0.320], [0.150, 0.345], [0.118, 0.405], [0.135, 0.475]]) }),
	Object.freeze({ id: 'westeros-vale-branch', points: Object.freeze([[0.181, 0.400], [0.210, 0.405], [0.242, 0.445]]) }),
	Object.freeze({ id: 'westeros-reach-branch', points: Object.freeze([[0.184, 0.485], [0.155, 0.525], [0.145, 0.585]]) }),
	Object.freeze({ id: 'dorne-road', points: Object.freeze([[0.125, 0.615], [0.175, 0.625], [0.235, 0.640]]) }),
	Object.freeze({ id: 'essos-northern-trunk', points: Object.freeze([[0.300, 0.445], [0.385, 0.470], [0.475, 0.485], [0.575, 0.500], [0.675, 0.525]]) }),
	Object.freeze({ id: 'dothraki-road', points: Object.freeze([[0.400, 0.555], [0.500, 0.575], [0.600, 0.585], [0.700, 0.590]]) }),
	Object.freeze({ id: 'eastern-trunk', points: Object.freeze([[0.700, 0.590], [0.785, 0.605], [0.870, 0.620], [0.950, 0.655]]) }),
	Object.freeze({ id: 'southern-essos-road', points: Object.freeze([[0.310, 0.590], [0.405, 0.620], [0.500, 0.640], [0.610, 0.655]]) }),
]);

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function normalizedFromWorld(worldX, worldZ) {
	return {
		x: worldX / WORLD_SCALE.WORLD_WIDTH_METERS + 0.5,
		y: worldZ / WORLD_SCALE.WORLD_DEPTH_METERS + 0.5,
	};
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= 1e-12) return Math.hypot(px - ax, py - ay);
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
	return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function minimumRoadGuideDistance(worldX, worldZ) {
	const { x, y } = normalizedFromWorld(worldX, worldZ);
	if (x < 0 || x > 1 || y < 0 || y > 1) return Infinity;
	const px = x * MAP_ASPECT;
	let minimumDistance = Infinity;
	for (const guide of REFERENCE_ROAD_GUIDES) {
		for (let index = 1; index < guide.points.length; index += 1) {
			const a = guide.points[index - 1];
			const b = guide.points[index];
			minimumDistance = Math.min(minimumDistance, pointSegmentDistance(px, y, a[0] * MAP_ASPECT, a[1], b[0] * MAP_ASPECT, b[1]));
		}
	}
	return minimumDistance;
}

export function sampleReferenceForestInfluenceWorld(worldX, worldZ) {
	const { x, y } = normalizedFromWorld(worldX, worldZ);
	if (x < 0 || x > 1 || y < 0 || y > 1) return 0;
	let strongest = 0;
	for (const zone of REFERENCE_FOREST_GUIDES) {
		const dx = (x - zone.center[0]) / zone.radius[0];
		const dy = (y - zone.center[1]) / zone.radius[1];
		const distance = Math.hypot(dx, dy);
		if (distance >= 1) continue;
		strongest = Math.max(strongest, (1 - smoothstep(0.35, 1, distance)) * zone.strength);
	}
	return strongest;
}

export function sampleReferenceRoadPreferenceWorld(worldX, worldZ) {
	const distance = minimumRoadGuideDistance(worldX, worldZ);
	return 1 - smoothstep(
		OWNER_MAP_FEATURE_GUIDE_POLICY.roadInnerWidthNormalized,
		OWNER_MAP_FEATURE_GUIDE_POLICY.roadOuterWidthNormalized,
		distance,
	);
}

export function sampleReferenceRoadPaintWorld(worldX, worldZ) {
	const distance = minimumRoadGuideDistance(worldX, worldZ);
	return 1 - smoothstep(
		OWNER_MAP_FEATURE_GUIDE_POLICY.roadPaintInnerWidthNormalized,
		OWNER_MAP_FEATURE_GUIDE_POLICY.roadPaintOuterWidthNormalized,
		distance,
	);
}
