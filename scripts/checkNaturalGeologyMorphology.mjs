#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY,
  checksumNaturalGeologyPlacements,
  classifyNaturalGeologyMorphology,
  generateNaturalGeologyPlacements,
  minimumDistanceToRoadMeters,
  minimumDistanceToSeatMeters,
  sampleTerrainFrame,
} from '../src/3d/world/naturalGeologyPlacement.js';

const seed = WORLD_DEFAULTS.WORLD_SEED;
const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const sampleHeightMeters = createHeightSampler(seed);
const seats = Object.freeze([
  Object.freeze({ x: -1860, z: -760 }),
  Object.freeze({ x: 1430, z: 820 }),
]);
const roadEdges = Object.freeze([
  Object.freeze({ points: Object.freeze([
    Object.freeze({ x: -2300, z: -1280 }),
    Object.freeze({ x: -500, z: -260 }),
    Object.freeze({ x: 1750, z: 1020 }),
  ]) }),
]);

const options = Object.freeze({
  sampleHeightMeters,
  seaLevelMeters: sea,
  seed,
  seats,
  roadEdges,
  worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
});

const first = generateNaturalGeologyPlacements(options);
const second = generateNaturalGeologyPlacements(options);
assert.equal(checksumNaturalGeologyPlacements(first.placements), checksumNaturalGeologyPlacements(second.placements), 'morphology placements lost determinism');
assert.deepEqual(first.stats.formationRoles, second.stats.formationRoles, 'formation-role counts lost determinism');
assert(first.placements.length >= 80, `desktop morphology became unexpectedly sparse: ${first.placements.length}`);
assert(first.stats.formationRoles && Object.keys(first.stats.formationRoles).length >= 3, `formation roles collapsed: ${JSON.stringify(first.stats.formationRoles)}`);

let ridgePlacements = 0;
let talusPlacements = 0;
let bedrockPlacements = 0;
let boulderPlacements = 0;
let groundingViolations = 0;
let shorelineViolations = 0;
let roadViolations = 0;
let seatViolations = 0;
let spacingViolations = 0;
let minimumPairDistance = Infinity;
const fractionalX = [];
const fractionalZ = [];

for (let index = 0; index < first.placements.length; index += 1) {
  const placement = first.placements[index];
  if (placement.formationRole === 'ridge-scarp') ridgePlacements += 1;
  if (placement.formationRole === 'talus-apron') talusPlacements += 1;
  if (placement.formationRole === 'bedrock-exposure') bedrockPlacements += 1;
  if (placement.formationRole === 'boulder-field') boulderPlacements += 1;

  const ground = sampleHeightMeters(placement.x, placement.z);
  const expected = ground - placement.scale.y * placement.buryFraction;
  if (Math.abs(placement.y - expected) > 1e-6) groundingViolations += 1;
  if (ground - sea <= NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters) shorelineViolations += 1;
  if (minimumDistanceToRoadMeters(placement.x, placement.z, roadEdges) < NATURAL_GEOLOGY_PLACEMENT_POLICY.roadReserveMeters - 1e-7) roadViolations += 1;
  if (minimumDistanceToSeatMeters(placement.x, placement.z, seats) < NATURAL_GEOLOGY_PLACEMENT_POLICY.settlementReserveMeters - 1e-7) seatViolations += 1;

  const cellWidth = first.stats.cellWidthMeters;
  const cellDepth = first.stats.cellDepthMeters;
  const phaseX = ((placement.x + WORLD_SCALE.WORLD_WIDTH_METERS * 0.5) / cellWidth) % 1;
  const phaseZ = ((placement.z + WORLD_SCALE.WORLD_DEPTH_METERS * 0.5) / cellDepth) % 1;
  fractionalX.push((phaseX + 1) % 1);
  fractionalZ.push((phaseZ + 1) % 1);

  for (let otherIndex = index + 1; otherIndex < first.placements.length; otherIndex += 1) {
    const other = first.placements[otherIndex];
    const distance = Math.hypot(placement.x - other.x, placement.z - other.z);
    minimumPairDistance = Math.min(minimumPairDistance, distance);
    if (distance + 1e-7 < Math.max(placement.minimumSpacingMeters, other.minimumSpacingMeters)) spacingViolations += 1;
    const largeA = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(placement.kind);
    const largeB = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(other.kind);
    if (largeA && largeB && distance + 1e-7 < Math.max(placement.largeSpacingMeters, other.largeSpacingMeters)) spacingViolations += 1;
  }
}

assert.equal(groundingViolations, 0, `ground/bury parity failures: ${groundingViolations}`);
assert.equal(shorelineViolations, 0, `shoreline reserve failures: ${shorelineViolations}`);
assert.equal(roadViolations, 0, `road reserve failures: ${roadViolations}`);
assert.equal(seatViolations, 0, `settlement reserve failures: ${seatViolations}`);
assert.equal(spacingViolations, 0, `pair-spacing failures: ${spacingViolations}`);
assert(ridgePlacements + bedrockPlacements > 8, `ridge/bedrock morphology missing: ${ridgePlacements}/${bedrockPlacements}`);
assert(talusPlacements + boulderPlacements > 8, `talus/boulder morphology missing: ${talusPlacements}/${boulderPlacements}`);

const variance = (values) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
};
const xVariance = variance(fractionalX);
const zVariance = variance(fractionalZ);
assert(xVariance > 0.012, `candidate x phase still looks grid-pinned: ${xVariance}`);
assert(zVariance > 0.012, `candidate z phase still looks grid-pinned: ${zVariance}`);

const representativeFrames = [
  sampleTerrainFrame(sampleHeightMeters, -2870, -2080),
  sampleTerrainFrame(sampleHeightMeters, -820, -2480),
  sampleTerrainFrame(sampleHeightMeters, 1120, 1710),
  sampleTerrainFrame(sampleHeightMeters, 2820, 2260),
];
for (const frame of representativeFrames) {
  const morphology = classifyNaturalGeologyMorphology(frame);
  for (const value of [morphology.ridgeExposure, morphology.talusPotential, morphology.bedrockExposure, morphology.boulderPotential]) {
    assert(Number.isFinite(value) && value >= 0 && value <= 1, `invalid morphology signal ${value}`);
  }
}

const mobile = generateNaturalGeologyPlacements({ ...options, isMobileClass: true });
assert(mobile.placements.length <= NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileMaxPlacements, 'mobile geology cap exceeded');
assert(mobile.placements.length > 20, `mobile morphology became unexpectedly sparse: ${JSON.stringify({ placed: mobile.placements.length, stats: mobile.stats })}`);

console.log('[checkNaturalGeologyMorphology] PASS');
console.log(JSON.stringify({
  policyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  checksum: checksumNaturalGeologyPlacements(first.placements),
  placementCount: first.placements.length,
  mobilePlacementCount: mobile.placements.length,
  mobileStats: mobile.stats,
  roles: first.stats.formationRoles,
  kindCounts: first.stats.kinds,
  ridgePlacements,
  talusPlacements,
  bedrockPlacements,
  boulderPlacements,
  minimumPairDistanceMeters: Number(minimumPairDistance.toFixed(3)),
  candidatePhaseVariance: { x: Number(xVariance.toFixed(5)), z: Number(zVariance.toFixed(5)) },
  groundingViolations,
  shorelineViolations,
  roadViolations,
  seatViolations,
  spacingViolations,
}, null, 2));
