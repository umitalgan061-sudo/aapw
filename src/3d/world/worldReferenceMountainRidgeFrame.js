/**
 * Allocation-free local-frame helpers for canonical owner-map mountain chains.
 *
 * The reference map owns the mountain centerlines. This module does not invent or move geography;
 * it only derives tangent/normal/progress coordinates around those source-owned polylines so the
 * live relief sampler can vary ridge morphology without falling back to axis-aligned noise.
 *
 * Coordinates passed here are normalized owner-map coordinates. X distances are multiplied by the
 * map aspect ratio before geometric operations so a normalized X/Y offset represents the same
 * physical distance in map space.
 *
 * @module world/worldReferenceMountainRidgeFrame
 */

const EPSILON = 1e-12;

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

/**
 * Calculates the nearest local frame on a canonical relief polyline.
 *
 * This diagnostic form allocates one small result object and is intended for tests, tooling, and
 * infrequent placement queries. The live height hot path uses `sampleMountainRidgeFrameInto`.
 */
export function sampleMountainRidgeFrame(
	normalizedX,
	normalizedY,
	points,
	mapAspect,
	pointsAreAspectCorrected = true,
) {
	const out = {};
	sampleMountainRidgeFrameInto(
		normalizedX,
		normalizedY,
		points,
		mapAspect,
		out,
		pointsAreAspectCorrected,
	);
	return Object.freeze({ ...out });
}

/**
 * Allocation-free ridge-frame sampler.
 *
 * The caller owns `out`; no arrays or result objects are created while sampling. `points` can be the
 * aspect-corrected compiled chain used by worldReferenceMountainRelief.js, or ordinary normalized
 * [x,y] points when `pointsAreAspectCorrected=false`.
 */
export function sampleMountainRidgeFrameInto(
	normalizedX,
	normalizedY,
	points,
	mapAspect,
	out,
	pointsAreAspectCorrected = true,
) {
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
		throw new TypeError('normalized ridge-frame coordinates must be finite');
	}
	if (!(mapAspect > 0) || !Number.isFinite(mapAspect)) {
		throw new TypeError('mapAspect must be a finite positive number');
	}
	if (!Array.isArray(points) || points.length < 2) {
		throw new TypeError('mountain chain needs at least two points');
	}
	if (!out || typeof out !== 'object') throw new TypeError('out scratch object is required');

	const px = normalizedX * mapAspect;
	const py = normalizedY;
	const pointXScale = pointsAreAspectCorrected ? 1 : mapAspect;
	let totalLength = 0;
	let nearestDistanceSquared = Infinity;
	let nearestSignedDistance = 0;
	let nearestSegment = 0;
	let nearestT = 0;
	let nearestX = 0;
	let nearestY = 0;
	let nearestTangentX = 1;
	let nearestTangentY = 0;
	let nearestNormalX = 0;
	let nearestNormalY = 1;
	let nearestProgressDistance = 0;

	for (let index = 0; index < points.length - 1; index += 1) {
		const a = points[index];
		const b = points[index + 1];
		const ax = a[0] * pointXScale;
		const ay = a[1];
		const bx = b[0] * pointXScale;
		const by = b[1];
		const dx = bx - ax;
		const dy = by - ay;
		const lengthSquared = dx * dx + dy * dy;
		const length = Math.sqrt(lengthSquared);
		let t = 0;
		if (lengthSquared > EPSILON) {
			const projection = (px - ax) * dx + (py - ay) * dy;
			t = projection <= 0 ? 0 : projection >= lengthSquared ? 1 : projection / lengthSquared;
		}
		const projectedX = ax + dx * t;
		const projectedY = ay + dy * t;
		const offsetX = px - projectedX;
		const offsetY = py - projectedY;
		const distanceSquared = offsetX * offsetX + offsetY * offsetY;
		if (distanceSquared < nearestDistanceSquared) {
			const inverseLength = length > EPSILON ? 1 / length : 0;
			const tangentX = inverseLength ? dx * inverseLength : 1;
			const tangentY = dy * inverseLength;
			const normalX = -tangentY;
			const normalY = tangentX;
			nearestDistanceSquared = distanceSquared;
			nearestSignedDistance = offsetX * normalX + offsetY * normalY;
			nearestSegment = index;
			nearestT = t;
			nearestX = projectedX;
			nearestY = projectedY;
			nearestTangentX = tangentX;
			nearestTangentY = tangentY;
			nearestNormalX = normalX;
			nearestNormalY = normalY;
			nearestProgressDistance = totalLength + length * t;
		}
		totalLength += length;
	}

	out.distance = Math.sqrt(nearestDistanceSquared);
	out.signedDistance = nearestSignedDistance;
	out.side = nearestSignedDistance < -EPSILON ? -1 : nearestSignedDistance > EPSILON ? 1 : 0;
	out.segmentIndex = nearestSegment;
	out.segmentT = nearestT;
	out.progress = totalLength > EPSILON ? clamp01(nearestProgressDistance / totalLength) : 0;
	out.nearestX = nearestX;
	out.nearestY = nearestY;
	out.tangentX = nearestTangentX;
	out.tangentY = nearestTangentY;
	out.normalX = nearestNormalX;
	out.normalY = nearestNormalY;
	out.totalLength = totalLength;
	return out;
}

/**
 * Samples a point offset from a source-owned mountain centerline in normalized owner-map space.
 * Useful for deterministic cross-section tests and downstream placement probes.
 */
export function offsetMountainFramePoint(frame, lateralDistance, longitudinalDistance, mapAspect) {
	if (!frame || typeof frame !== 'object') throw new TypeError('frame is required');
	for (const value of [lateralDistance, longitudinalDistance, mapAspect]) {
		if (!Number.isFinite(value)) throw new TypeError('offset values must be finite');
	}
	if (!(mapAspect > 0)) throw new RangeError('mapAspect must be positive');
	const aspectXValue = frame.nearestX
		+ frame.normalX * lateralDistance
		+ frame.tangentX * longitudinalDistance;
	const y = frame.nearestY
		+ frame.normalY * lateralDistance
		+ frame.tangentY * longitudinalDistance;
	return Object.freeze({
		x: aspectXValue / mapAspect,
		y,
	});
}
