/**
 * Canonical river-mouth resolver.
 *
 * `generateRiverPath()` stops on numeric sea level, but owner-map water classification is the actual
 * coastline authority. This terminal-only helper bridges that final discrepancy without becoming a
 * second river tracer: it keeps the incoming course heading, tries a small deterministic fan, and is
 * allowed to add at most a bounded coastal tail.
 *
 * @module world/riverMouth
 */

import { WORLD_SCALE } from '../config.js';
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';
import { classifyReferenceBaseSurface } from './worldReferenceSurfacePindexes.js';

export const RIVER_MOUTH_POLICY = Object.freeze({
	id: 'canonical-river-mouth-terminal-extension-2026-08-31-v2',
	canonicalSurfaceAuthority: 'worldReferenceSurfacePindexes.classifyReferenceBaseSurface',
	stepMeters: 40,
	maxSteps: 50,
	maxExtensionMeters: 2000,
	deterministic: true,
	terminalOnly: true,
});

const HEADING_FAN_RADIANS = Object.freeze([0, 0.30, -0.30, 0.60, -0.60, 0.95, -0.95]);

function normalizedAtWorld(worldX, worldZ) {
	try {
		return worldXZToNormalizedReference(
			worldX,
			worldZ,
			WORLD_SCALE.MAP_BOUNDS,
			WORLD_SCALE.METERS_PER_MAP_UNIT,
		);
	} catch {
		return null;
	}
}

export function canonicalSurfaceAtWorld(worldX, worldZ) {
	const normalized = normalizedAtWorld(worldX, worldZ);
	if (!normalized) return 'outside';
	return classifyReferenceBaseSurface(normalized.x, normalized.y);
}

export function isCanonicalWater(worldX, worldZ) {
	const surface = canonicalSurfaceAtWorld(worldX, worldZ);
	return surface === 'sea' || surface === 'lake';
}

/**
 * Extends a traced course to the first canonical-water sample in a short deterministic coastal fan.
 * Returns diagnostics as well as the course so callers cannot silently treat a failed mouth as valid.
 *
 * @param {{x:number,y:number,z:number}[]} points
 * @param {(x:number,z:number)=>number} sampleHeightMeters
 * @param {(x:number,y:number,z:number)=>any} [makePoint]
 */
export function extendCourseToCanonicalWater(points, sampleHeightMeters, makePoint = (x, y, z) => ({ x, y, z })) {
	if (!Array.isArray(points) || points.length < 2) {
		return Object.freeze({ points, reachedCanonicalWater: false, extensionMeters: 0, addedPointCount: 0 });
	}
	const originalMouth = points[points.length - 1];
	if (isCanonicalWater(originalMouth.x, originalMouth.z)) {
		return Object.freeze({ points, reachedCanonicalWater: true, extensionMeters: 0, addedPointCount: 0 });
	}

	const P = RIVER_MOUTH_POLICY;
	const previous = points[points.length - 2];
	let heading = Math.atan2(originalMouth.z - previous.z, originalMouth.x - previous.x);
	let x = originalMouth.x;
	let z = originalMouth.z;
	const tail = [];

	for (let step = 0; step < P.maxSteps; step += 1) {
		let best = null;
		for (const offset of HEADING_FAN_RADIANS) {
			const angle = heading + offset;
			const candidateX = x + Math.cos(angle) * P.stepMeters;
			const candidateZ = z + Math.sin(angle) * P.stepMeters;
			const surface = canonicalSurfaceAtWorld(candidateX, candidateZ);
			if (surface === 'outside') continue;
			const height = sampleHeightMeters(candidateX, candidateZ);
			if (surface === 'sea' || surface === 'lake') {
				tail.push(makePoint(candidateX, height, candidateZ));
				const extensionMeters = tail.length * P.stepMeters;
				return Object.freeze({
					points: points.concat(tail),
					reachedCanonicalWater: true,
					extensionMeters,
					addedPointCount: tail.length,
				});
			}
			if (!best || height < best.height) best = { x: candidateX, z: candidateZ, height, heading: angle };
		}
		if (!best) break;
		x = best.x;
		z = best.z;
		heading = best.heading;
		tail.push(makePoint(x, best.height, z));
	}

	return Object.freeze({
		points,
		reachedCanonicalWater: false,
		extensionMeters: 0,
		addedPointCount: 0,
	});
}
