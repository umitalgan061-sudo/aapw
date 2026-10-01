/**
 * Runtime adapter for map-derived named rivers.
 *
 * Important ownership boundary:
 * - `worldReferenceRivers.js` owns which named rivers/headwater regions exist.
 * - `rivers.js` remains the only downhill tracer and river material/flow implementation.
 * - this module only translates each headwater to tracer-local coordinates, validates the result
 *   against canonical water, densifies the water surface, and grounds the finished ribbon banks.
 *
 * This avoids forking the river engine while fixing the historical world-origin assumption that made
 * off-origin named rivers terminate immediately.
 *
 * @module world/namedRiverRuntime
 */

import {
	createRiverMesh,
	createWaterfallMesh,
	detectWaterfalls,
	disposeRiverMesh,
	disposeWaterfallMesh,
	generateRiverPath,
} from './rivers.js';
import { allRiverHeadwaters, REFERENCE_RIVERS_POLICY } from './worldReferenceRivers.js';
import {
	canonicalSurfaceAtWorld,
	extendCourseToCanonicalWater,
	isCanonicalWater,
	RIVER_MOUTH_POLICY,
} from './riverMouth.js';

export const NAMED_RIVER_RUNTIME_POLICY = Object.freeze({
	id: 'named-river-runtime-2026-08-31-v1-local-tracer',
	headwaterPolicyId: REFERENCE_RIVERS_POLICY.id,
	mouthPolicyId: RIVER_MOUTH_POLICY.id,
	tracerAuthority: 'world/rivers.js.generateRiverPath',
	terrainAuthority: 'world/terrain.js',
	canonicalWaterAuthority: 'worldReferenceSurfacePindexes.classifyReferenceBaseSurface',
	surfaceSpacingMeters: 10,
	waterFreeboardMeters: 0.42,
	bankFreeboardMeters: 0.24,
	maxCourseRadiusMeters: 4600,
	maxTraceSteps: 520,
	minimumUsefulPointCount: 8,
	minimumUsefulLengthMeters: 240,
	maxTotalTriangles: 24000,
	deterministic: true,
});

function hashString32(text) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function courseLengthMeters(points) {
	let total = 0;
	for (let index = 1; index < points.length; index += 1) {
		total += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
	}
	return total;
}

function translatedPoint(point, offsetX, offsetZ) {
	return { x: point.x + offsetX, y: point.y, z: point.z + offsetZ };
}

/**
 * Run the existing world-origin tracer in a river-local coordinate frame.
 * The tracer still believes its origin is (0,0), so its established search/bounds math stays intact;
 * only the sampler translates coordinates into the named river's owner-map headwater region.
 */
export function traceNamedRiver(headwater, {
	seed,
	sampleHeightMeters,
	seaLevelMeters,
} = {}) {
	if (!headwater) throw new TypeError('headwater is required');
	if (!Number.isFinite(seed)) throw new TypeError('seed must be finite');
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
	if (!Number.isFinite(seaLevelMeters)) throw new TypeError('seaLevelMeters must be finite');

	const localSampler = (localX, localZ) => sampleHeightMeters(headwater.x + localX, headwater.z + localZ);
	const taggedSeed = (seed ^ hashString32(headwater.id) ^ 0x4e525652) >>> 0; // "NRVR"
	const traced = generateRiverPath({
		seed: taggedSeed,
		sampleHeightMeters: localSampler,
		seaLevelMeters,
		searchRadiusMeters: headwater.searchRadiusMeters,
		maxRiverRadiusMeters: NAMED_RIVER_RUNTIME_POLICY.maxCourseRadiusMeters,
		stepMeters: 40,
		maxSteps: NAMED_RIVER_RUNTIME_POLICY.maxTraceSteps,
	});

	const worldPoints = traced.points.map((point) => translatedPoint(point, headwater.x, headwater.z));
	const extended = extendCourseToCanonicalWater(
		worldPoints,
		sampleHeightMeters,
		(x, y, z) => ({ x, y, z }),
	);
	const points = extended.points;
	const source = points[0] ?? null;
	const mouth = points[points.length - 1] ?? null;
	const lengthMeters = courseLengthMeters(points);
	const sourceSurface = source ? canonicalSurfaceAtWorld(source.x, source.z) : 'outside';
	const mouthSurface = mouth ? canonicalSurfaceAtWorld(mouth.x, mouth.z) : 'outside';
	const sourceDry = sourceSurface === 'soil' || sourceSurface === 'rock' || sourceSurface === 'snow';
	const mouthWet = Boolean(mouth && isCanonicalWater(mouth.x, mouth.z));
	const useful = points.length >= NAMED_RIVER_RUNTIME_POLICY.minimumUsefulPointCount
		&& lengthMeters >= NAMED_RIVER_RUNTIME_POLICY.minimumUsefulLengthMeters
		&& sourceDry
		&& mouthWet;

	return Object.freeze({
		id: headwater.id,
		name: headwater.name,
		widthMeters: headwater.widthMeters,
		points,
		useful,
		diagnostics: Object.freeze({
			tracerEndReason: traced.endReason,
			pointCount: points.length,
			lengthMeters,
			sourceSurface,
			mouthSurface,
			sourceDry,
			mouthWet,
			mouthExtensionMeters: extended.extensionMeters,
			mouthExtensionPointCount: extended.addedPointCount,
		}),
	});
}

export function traceNamedRiverNetwork(options) {
	const rivers = allRiverHeadwaters().map((headwater) => traceNamedRiver(headwater, options));
	return Object.freeze({
		policyId: NAMED_RIVER_RUNTIME_POLICY.id,
		rivers: Object.freeze(rivers),
		usefulRivers: Object.freeze(rivers.filter((river) => river.useful)),
		rejectedRivers: Object.freeze(rivers.filter((river) => !river.useful)),
	});
}

/**
 * Densify a sparse traced course and construct a downstream-monotone water surface.
 * Traversing upstream from the mouth with a running maximum means surface height can stay level to
 * form a pool behind a small rise, but can never climb while travelling downstream.
 */
export function buildTerrainConformingRiverSurface(points, sampleHeightMeters, {
	spacingMeters = NAMED_RIVER_RUNTIME_POLICY.surfaceSpacingMeters,
	freeboardMeters = NAMED_RIVER_RUNTIME_POLICY.waterFreeboardMeters,
} = {}) {
	if (!Array.isArray(points) || points.length < 2) return [];
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
	const dense = [];
	for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
		const from = points[segmentIndex - 1];
		const to = points[segmentIndex];
		const length = Math.hypot(to.x - from.x, to.z - from.z);
		const steps = Math.max(1, Math.ceil(length / spacingMeters));
		for (let step = segmentIndex === 1 ? 0 : 1; step <= steps; step += 1) {
			const t = step / steps;
			const x = from.x + (to.x - from.x) * t;
			const z = from.z + (to.z - from.z) * t;
			dense.push({ x, z, bed: sampleHeightMeters(x, z) });
		}
	}
	if (dense.length < 2) return [];

	const waterY = new Float64Array(dense.length);
	let downstreamSurface = -Infinity;
	for (let index = dense.length - 1; index >= 0; index -= 1) {
		downstreamSurface = Math.max(downstreamSurface, dense[index].bed + freeboardMeters);
		waterY[index] = downstreamSurface;
	}
	return dense.map((point, index) => ({ x: point.x, y: waterY[index], z: point.z }));
}

/**
 * `createRiverMesh` historically gives both banks the centreline Y. Re-found each cross-section on
 * the actual left/right terrain and keep one level surface across the channel. This prevents the
 * uphill bank burying while avoiding a diagonally twisted water sheet.
 */
export function groundRiverRibbonBanks(mesh, sampleHeightMeters, freeboardMeters = NAMED_RIVER_RUNTIME_POLICY.bankFreeboardMeters) {
	const position = mesh?.geometry?.getAttribute?.('position');
	if (!position || position.count % 2 !== 0) return Object.freeze({ adjustedCrossSections: 0, maxLiftMeters: 0 });
	let adjustedCrossSections = 0;
	let maxLiftMeters = 0;
	for (let index = 0; index < position.count; index += 2) {
		const leftGround = sampleHeightMeters(position.getX(index), position.getZ(index));
		const rightGround = sampleHeightMeters(position.getX(index + 1), position.getZ(index + 1));
		const currentY = Math.max(position.getY(index), position.getY(index + 1));
		const requiredY = Math.max(currentY, leftGround + freeboardMeters, rightGround + freeboardMeters);
		const lift = requiredY - currentY;
		if (lift > 1e-6) {
			position.setY(index, requiredY);
			position.setY(index + 1, requiredY);
			adjustedCrossSections += 1;
			maxLiftMeters = Math.max(maxLiftMeters, lift);
		}
	}
	position.needsUpdate = true;
	mesh.geometry.computeVertexNormals();
	mesh.geometry.computeBoundingBox();
	mesh.geometry.computeBoundingSphere();
	return Object.freeze({ adjustedCrossSections, maxLiftMeters });
}

/**
 * Build render meshes with the existing `rivers.js` material. No alternate water shader is invented.
 */
export function createNamedRiverRuntime({ network, sampleHeightMeters }) {
	if (!network?.usefulRivers) throw new TypeError('traceNamedRiverNetwork result is required');
	const meshes = [];
	const waterfalls = [];
	const diagnostics = [];
	let totalTriangles = 0;
	let sharedTimeUniform = null;

	for (const river of network.usefulRivers) {
		const surface = buildTerrainConformingRiverSurface(river.points, sampleHeightMeters);
		if (surface.length < 2) continue;
		const mesh = createRiverMesh(surface, river.widthMeters);
		if (!mesh) continue;
		mesh.name = `named-river-${river.id}`;
		mesh.userData.namedRiver = Object.freeze({ id: river.id, name: river.name, widthMeters: river.widthMeters });
		const bankGrounding = groundRiverRibbonBanks(mesh, sampleHeightMeters);
		const flowUniforms = mesh.material?.userData?.flowUniforms;
		if (flowUniforms?.uTime) {
			if (!sharedTimeUniform) sharedTimeUniform = flowUniforms.uTime;
			else flowUniforms.uTime = sharedTimeUniform;
		}
		const triangleCount = Math.floor((mesh.geometry.index?.count ?? 0) / 3);
		totalTriangles += triangleCount;
		meshes.push(mesh);

		for (const waterfall of detectWaterfalls(surface)) {
			const waterfallMesh = createWaterfallMesh(waterfall);
			if (!waterfallMesh) continue;
			const waterfallUniforms = waterfallMesh.material?.userData?.flowUniforms;
			if (sharedTimeUniform && waterfallUniforms?.uTime) waterfallUniforms.uTime = sharedTimeUniform;
			waterfallMesh.userData.namedRiverId = river.id;
			waterfalls.push(waterfallMesh);
		}
		diagnostics.push(Object.freeze({
			id: river.id,
			name: river.name,
			surfacePointCount: surface.length,
			triangleCount,
			bankGrounding,
		}));
	}

	if (totalTriangles > NAMED_RIVER_RUNTIME_POLICY.maxTotalTriangles) {
		for (const mesh of meshes) disposeRiverMesh(mesh);
		for (const mesh of waterfalls) disposeWaterfallMesh(mesh);
		throw new Error(`named river triangle budget exceeded: ${totalTriangles} > ${NAMED_RIVER_RUNTIME_POLICY.maxTotalTriangles}`);
	}

	return {
		policyId: NAMED_RIVER_RUNTIME_POLICY.id,
		meshes,
		waterfalls,
		primaryFlowMesh: meshes[0] ?? null,
		totalTriangles,
		diagnostics: Object.freeze(diagnostics),
	};
}

export function disposeNamedRiverRuntime(runtime) {
	if (!runtime) return;
	for (const mesh of runtime.meshes ?? []) disposeRiverMesh(mesh);
	for (const mesh of runtime.waterfalls ?? []) disposeWaterfallMesh(mesh);
}
