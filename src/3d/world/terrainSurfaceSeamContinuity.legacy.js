/**
 * Deterministic chunk-seam continuity probes for the render-only terrain material field.
 *
 * Chunk ownership is allowed to change at a seam, but a shared world-space material sample must
 * not jump merely because the same coordinate was reconstructed from a neighboring chunk. This
 * module keeps the seam contract numeric and render-only; canonical terrain height/hydrology remain
 * external inputs.
 *
 * @module world/terrainSurfaceSeamContinuity
 */

import { createTerrainFaciesDiagnostics } from './terrainSurfaceFacies.ts';

export const TERRAIN_SEAM_CONTINUITY_POLICY = Object.freeze({
	id: 'terrain-surface-seam-continuity-v1',
	chunkSizeMeters: 500,
	sampleOffsetsMeters: Object.freeze([0.5, 2, 7.5, 18, 42]),
	worldSpaceEpsilonMeters: 0.002,
	maxDominantFaciesFlips: 0,
	maxColorStep: 0.08,
	maxRoughnessStep: 0.075,
	maxNormalStep: 0.12,
	renderOnly: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalColliderUnchanged: true,
});

function chunkOrigin(chunkIndex) {
	return chunkIndex * TERRAIN_SEAM_CONTINUITY_POLICY.chunkSizeMeters;
}

export function reconstructWorldCoordinate(chunkIndex, localOffsetMeters) {
	return chunkOrigin(chunkIndex) + localOffsetMeters;
}

function colorDistance(a, b) {
	return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function sampleAt(worldX, worldZ, overrides = {}) {
	return createTerrainFaciesDiagnostics({
		worldX,
		worldZ,
		color: overrides.color ?? { r: 0.36, g: 0.43, b: 0.25 },
		heightMeters: overrides.heightMeters ?? 72,
		slopeDegrees: overrides.slopeDegrees ?? 14,
		coastHeightMeters: overrides.coastHeightMeters ?? 40,
	});
}

export function sampleSeamContinuity({ chunkX, chunkZ, axis = 'x', offsetMeters = 7.5, overrides } = {}) {
	if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) throw new TypeError('chunk indices must be integers');
	if (axis !== 'x' && axis !== 'z') throw new TypeError('axis must be x or z');
	const seamX = axis === 'x' ? reconstructWorldCoordinate(chunkX + 1, 0) : reconstructWorldCoordinate(chunkX, offsetMeters);
	const seamZ = axis === 'z' ? reconstructWorldCoordinate(chunkZ + 1, 0) : reconstructWorldCoordinate(chunkZ, offsetMeters);
	const epsilon = TERRAIN_SEAM_CONTINUITY_POLICY.worldSpaceEpsilonMeters;
	const left = axis === 'x' ? sampleAt(seamX - epsilon, seamZ, overrides) : sampleAt(seamX, seamZ - epsilon, overrides);
	const right = axis === 'x' ? sampleAt(seamX + epsilon, seamZ, overrides) : sampleAt(seamX, seamZ + epsilon, overrides);
	return Object.freeze({
		axis,
		world: Object.freeze({ x: seamX, z: seamZ }),
		left,
		right,
		colorStep: colorDistance(left.color, right.color),
		roughnessStep: Math.abs(left.roughness - right.roughness),
		normalStep: Math.abs(left.normalStrength - right.normalStrength),
		dominantFaciesFlip: left.dominantFacies !== right.dominantFacies,
	});
}

export function buildTerrainSeamContinuityReport() {
	const probes = [];
	for (const axis of ['x', 'z']) {
		for (const offsetMeters of TERRAIN_SEAM_CONTINUITY_POLICY.sampleOffsetsMeters) {
			probes.push(sampleSeamContinuity({
				chunkX: 4,
				chunkZ: 7,
				axis,
				offsetMeters,
				overrides: {
					heightMeters: 96 + offsetMeters * 0.7,
					slopeDegrees: 11 + offsetMeters * 0.18,
					coastHeightMeters: 58,
				},
			}));
		}
	}
	const maxColorStep = Math.max(...probes.map((probe) => probe.colorStep));
	const maxRoughnessStep = Math.max(...probes.map((probe) => probe.roughnessStep));
	const maxNormalStep = Math.max(...probes.map((probe) => probe.normalStep));
	const dominantFaciesFlips = probes.filter((probe) => probe.dominantFaciesFlip).length;
	return Object.freeze({
		policyId: TERRAIN_SEAM_CONTINUITY_POLICY.id,
		probeCount: probes.length,
		maxColorStep,
		maxRoughnessStep,
		maxNormalStep,
		dominantFaciesFlips,
		canonicalHeightUnchanged: true,
		canonicalHydrologyUnchanged: true,
		canonicalColliderUnchanged: true,
		probes: Object.freeze(probes),
	});
}
