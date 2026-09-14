#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	TERRAIN_SEAM_CONTINUITY_POLICY,
	buildTerrainSeamContinuityReport,
	reconstructWorldCoordinate,
} from '../src/3d/world/terrainSurfaceSeamContinuity.js';

assert.equal(TERRAIN_SEAM_CONTINUITY_POLICY.chunkSizeMeters, 500);
assert.equal(reconstructWorldCoordinate(4, 0), 2000);
assert.equal(reconstructWorldCoordinate(5, 0), 2500);
const reportA = buildTerrainSeamContinuityReport();
const reportB = buildTerrainSeamContinuityReport();
assert.deepEqual(reportA, reportB, 'seam probes must be deterministic');
assert.equal(reportA.probeCount, TERRAIN_SEAM_CONTINUITY_POLICY.sampleOffsetsMeters.length * 2);
assert.equal(reportA.dominantFaciesFlips, TERRAIN_SEAM_CONTINUITY_POLICY.maxDominantFaciesFlips);
assert(reportA.maxColorStep <= TERRAIN_SEAM_CONTINUITY_POLICY.maxColorStep, 'seam color discontinuity exceeded policy');
assert(reportA.maxRoughnessStep <= TERRAIN_SEAM_CONTINUITY_POLICY.maxRoughnessStep, 'seam roughness discontinuity exceeded policy');
assert(reportA.maxNormalStep <= TERRAIN_SEAM_CONTINUITY_POLICY.maxNormalStep, 'seam normal discontinuity exceeded policy');
assert.equal(reportA.canonicalHeightUnchanged, true);
assert.equal(reportA.canonicalHydrologyUnchanged, true);
assert.equal(reportA.canonicalColliderUnchanged, true);
console.log('[checkTerrainSeamContinuity] PASS', JSON.stringify({
	policyId: reportA.policyId,
	probeCount: reportA.probeCount,
	maxColorStep: reportA.maxColorStep,
	maxRoughnessStep: reportA.maxRoughnessStep,
	maxNormalStep: reportA.maxNormalStep,
	dominantFaciesFlips: reportA.dominantFaciesFlips,
}));
