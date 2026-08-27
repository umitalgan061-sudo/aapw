#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROAD_ROUTING_POLICY,
  ROAD_COMFORT_GRADE_DEGREES,
  ROAD_MAX_GRADE_DEGREES,
  ROAD_RETURN_GRADE_TARGET_DEGREES,
  ROAD_MAX_RIVER_ADJACENT_SAMPLES,
} from '../src/3d/world/roadPathfinder.js';
import { ROAD_PROFILE_POLICY } from '../src/3d/world/roadSurfaceProfile.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const routerSource = read('src/3d/world/roadPathfinder.js');
const profileSource = read('src/3d/world/roadSurfaceProfile.js');
const roadsSource = read('src/3d/world/roads.js');
const terrainSource = read('src/3d/world/terrain.js');

assert.equal(ROAD_ROUTING_POLICY.id, 'road-routing-2026-08-27-v3-subedge-profiled');
assert.equal(ROAD_ROUTING_POLICY.terrainProfilePolicyId, ROAD_PROFILE_POLICY.id);
assert.equal(ROAD_ROUTING_POLICY.geographyAuthorityUnchanged, true);
assert.equal(ROAD_ROUTING_POLICY.deterministic, true);
assert.equal(ROAD_PROFILE_POLICY.heightAuthority, 'world/terrain.js');
assert.equal(ROAD_PROFILE_POLICY.geographyAuthorityUnchanged, true);
assert.equal(ROAD_PROFILE_POLICY.deterministic, true);
assert.equal(ROAD_COMFORT_GRADE_DEGREES, 10);
assert.equal(ROAD_MAX_GRADE_DEGREES, 17);
assert(ROAD_RETURN_GRADE_TARGET_DEGREES < 20);
assert.equal(ROAD_MAX_RIVER_ADJACENT_SAMPLES, 3);
assert(ROAD_PROFILE_POLICY.maxSampleSpacingMeters <= 12);
assert(ROAD_PROFILE_POLICY.presentationSampleSpacingMeters <= 8);

const requiredRouterSnippets = [
  "from './roadSurfaceProfile.js'",
  'profileTerrainSegment',
  'profileRoadPolyline',
  'pathIsGradeSafe',
  'segmentFeasibility',
  'buildSearchStages',
  'MID_REFINEMENT_CELL_METERS = 45',
  'MIN_REFINEMENT_CELL_METERS = 36',
  'selectSafePresentation',
  'profileRiverExposure',
  'maxConsecutiveAdjacentSamples <= ROAD_MAX_RIVER_ADJACENT_SAMPLES',
  "mode: 'fallback'",
  'fallback: true',
  'geographyAuthorityUnchanged: true',
];
for (const snippet of requiredRouterSnippets) {
  assert(routerSource.includes(snippet), `road router lost required production wiring: ${snippet}`);
}

const requiredProfileSnippets = [
  'maxSampleSpacingMeters: 12',
  'presentationSampleSpacingMeters: 8',
  'profileTerrainSegment',
  'profileRoadPolyline',
  'summarizePolylineCurvature',
  'checksumProfile',
  "heightAuthority: 'world/terrain.js'",
];
for (const snippet of requiredProfileSnippets) {
  assert(profileSource.includes(snippet), `road surface profile lost required contract: ${snippet}`);
}

for (const forbidden of [
  'setTerrainHeight',
  'writeHeight',
  'flattenPads.push',
  'WORLD_REFERENCE_BASE_SURFACE_MASK =',
  'sampleHeightMeters = (',
]) {
  assert(!routerSource.includes(forbidden), `router must not become terrain authority: ${forbidden}`);
  assert(!profileSource.includes(forbidden), `profile helper must stay measurement-only: ${forbidden}`);
}

assert(roadsSource.includes("import { findSlopeAwarePath } from './roadPathfinder.js'"),
  'roads.js must route through the profiled production pathfinder');
assert(roadsSource.includes('computeSeatMST'), 'canonical MST topology contract disappeared');
assert(roadsSource.includes('buildRoadNetwork'), 'canonical road-network builder disappeared');
assert(terrainSource.includes('export function createHeightSampler'),
  'road profile height authority must remain the production terrain sampler');

const gradeLiterals = [...routerSource.matchAll(/ROAD_(?:COMFORT|MAX|RETURN)_GRADE_[A-Z_]+\s*=\s*([0-9.]+)/g)]
  .map((match) => Number(match[1]));
assert(gradeLiterals.every(Number.isFinite), 'road grade policy literals must remain finite');
assert(Math.max(...gradeLiterals) < 20, `road source contains an over-20° accepted grade literal: ${gradeLiterals}`);

const policyReport = Object.freeze({
  routingPolicyId: ROAD_ROUTING_POLICY.id,
  profilePolicyId: ROAD_PROFILE_POLICY.id,
  comfortGradeDegrees: ROAD_COMFORT_GRADE_DEGREES,
  searchGradeDegrees: ROAD_MAX_GRADE_DEGREES,
  returnGradeDegrees: ROAD_RETURN_GRADE_TARGET_DEGREES,
  maxRiverAdjacentSamples: ROAD_MAX_RIVER_ADJACENT_SAMPLES,
  gridCellMeters: ROAD_ROUTING_POLICY.gridCellMeters,
  maxCorridorPaddingMeters: ROAD_ROUTING_POLICY.maxCorridorPaddingMeters,
  profileSpacingMeters: ROAD_PROFILE_POLICY.maxSampleSpacingMeters,
  presentationSpacingMeters: ROAD_PROFILE_POLICY.presentationSampleSpacingMeters,
});
console.log('[checkRoadRoutingSourceContract] PASS');
console.log(JSON.stringify(policyReport, null, 2));
