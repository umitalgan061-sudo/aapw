#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY as P,
  checksumNaturalGeologyPlacements,
  classifyNaturalGeologyMorphology,
  generateNaturalGeologyPlacements,
  minimumDistanceToRoadMeters,
  minimumDistanceToSeatMeters,
} from '../src/3d/world/naturalGeologyPlacement.js';

const WIDTH = WORLD_SCALE.WORLD_WIDTH_METERS;
const DEPTH = WORLD_SCALE.WORLD_DEPTH_METERS;
const SEA = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const SEED = WORLD_DEFAULTS.WORLD_SEED;

const roleFixture = (overrides) => classifyNaturalGeologyMorphology({
  slopeDegrees: 15,
  localReliefMeters: 8,
  directionalReliefMeters: 5,
  broadCurvatureMeters: 0,
  ...overrides,
});
assert.equal(roleFixture({ slopeDegrees: 43, localReliefMeters: 28, directionalReliefMeters: 22, broadCurvatureMeters: -3.5 }).role, 'ridge-scarp');
assert.equal(roleFixture({ slopeDegrees: 31, localReliefMeters: 8, directionalReliefMeters: 3, broadCurvatureMeters: 3.2 }).role, 'talus-apron');
assert.equal(roleFixture({ slopeDegrees: 20, localReliefMeters: 14, directionalReliefMeters: 10, broadCurvatureMeters: -0.4 }).role, 'bedrock-exposure');
assert.equal(roleFixture({ slopeDegrees: 5, localReliefMeters: 3, directionalReliefMeters: 2, broadCurvatureMeters: 0.5 }).role, 'boulder-field');

function ruggedFixture(x, z) {
  const nx = x / WIDTH;
  const nz = z / DEPTH;
  const broad = 112 + Math.sin(nx * Math.PI * 3.1 + nz * 1.8) * 58 + Math.cos(nz * Math.PI * 3.8) * 41;
  const ridgePhase = (nx * 0.81 + nz * 0.39) * Math.PI * 24;
  const ridge = Math.pow(Math.abs(Math.sin(ridgePhase)), 1.35) * 128;
  const scar = Math.pow(Math.max(0, Math.sin((nx * -0.34 + nz * 0.92) * Math.PI * 14)), 2.7) * 72;
  const valley = -Math.pow(Math.abs(Math.sin((nx * 0.22 - nz * 0.76) * Math.PI * 11)), 2.2) * 46;
  return Math.max(SEA + 2, broad + ridge + scar + valley);
}
const seats = [{ x: -1800, z: -1300 }, { x: 1850, z: 900 }, { x: 460, z: 2740 }];
const roads = [{ points: [{ x: -1800, z: -1300 }, { x: -700, z: -470 }, { x: 520, z: 120 }, { x: 1850, z: 900 }] }];
const generateFixture = (options = {}) => generateNaturalGeologyPlacements({
  sampleHeightMeters: ruggedFixture,
  seaLevelMeters: SEA,
  seed: SEED,
  seats,
  roadEdges: roads,
  worldWidthMeters: WIDTH,
  worldDepthMeters: DEPTH,
  maxPlacements: 420,
  ...options,
});

const first = generateFixture();
const repeat = generateFixture();
assert.deepEqual(first.placements, repeat.placements, 'placement must remain deterministic');
assert.equal(checksumNaturalGeologyPlacements(first.placements), checksumNaturalGeologyPlacements(repeat.placements));
assert.notEqual(checksumNaturalGeologyPlacements(first.placements), checksumNaturalGeologyPlacements(generateFixture({ seed: SEED + 17 }).placements));
assert(first.placements.length >= 120 && first.placements.length <= 420, `unexpected rugged placement count ${first.placements.length}`);

const roles = new Set();
const kinds = new Set();
const xPhaseBins = new Set();
const zPhaseBins = new Set();
const nearest = [];
let minRoad = Infinity;
let minSeat = Infinity;
let ridgeAligned = 0;
let talusAligned = 0;
let spacingViolations = 0;
let groundingViolations = 0;
let scarpProportionViolations = 0;
for (let index = 0; index < first.placements.length; index += 1) {
  const p = first.placements[index];
  roles.add(p.formationRole);
  kinds.add(p.kind);
  minRoad = Math.min(minRoad, minimumDistanceToRoadMeters(p.x, p.z, roads));
  minSeat = Math.min(minSeat, minimumDistanceToSeatMeters(p.x, p.z, seats));
  assert(p.heightAboveSeaMeters > P.shorelineReserveMeters, `shoreline leak ${p.id}`);
  assert(p.slopeDegrees <= P.maxRockSlopeDegrees + 1e-9, `slope leak ${p.id}`);
  assert(p.buryFraction >= 0.08 && p.buryFraction <= 0.42, `bury out of range ${p.id}`);
  assert([p.x, p.y, p.z, p.scale.x, p.scale.y, p.scale.z, p.minimumSpacingMeters].every(Number.isFinite), `non-finite placement ${p.id}`);
  const expectedY = ruggedFixture(p.x, p.z) - p.scale.y * p.buryFraction;
  if (Math.abs(p.y - expectedY) > 1e-7) groundingViolations++;
  if ((p.kind === 'fractured-scarp' || (p.kind === 'asset-proxy' && p.formationRole === 'ridge-scarp'))
    && (p.scale.x / p.scale.z > P.maximumScarpPlanAspect + 1e-9 || p.scale.y / p.scale.x > P.maximumScarpHeightToWidth + 1e-9)) scarpProportionViolations++;
  if (p.formationRole === 'ridge-scarp' && ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(p.kind)) ridgeAligned++;
  if (p.formationRole === 'talus-apron' && ['talus', 'boulder'].includes(p.kind)) talusAligned++;
  const fx = ((p.x + WIDTH * 0.5) / first.stats.cellWidthMeters) % 1;
  const fz = ((p.z + DEPTH * 0.5) / first.stats.cellDepthMeters) % 1;
  xPhaseBins.add(Math.floor(fx * 12));
  zPhaseBins.add(Math.floor(fz * 12));
  let closest = Infinity;
  for (let otherIndex = 0; otherIndex < first.placements.length; otherIndex += 1) {
    if (index === otherIndex) continue;
    const other = first.placements[otherIndex];
    const distance = Math.hypot(p.x - other.x, p.z - other.z);
    closest = Math.min(closest, distance);
    if (distance + 1e-9 < Math.max(p.minimumSpacingMeters, other.minimumSpacingMeters)) spacingViolations++;
  }
  if (Number.isFinite(closest)) nearest.push(closest);
}
assert.equal(groundingViolations, 0, `grounding parity failures ${groundingViolations}`);
assert.equal(spacingViolations, 0, `pair spacing failures ${spacingViolations}`);
assert.equal(scarpProportionViolations, 0, `thin wall-like scarp proportions ${scarpProportionViolations}`);
assert(minRoad >= P.roadReserveMeters - 1e-9);
assert(minSeat >= P.settlementReserveMeters - 1e-9);
assert(roles.has('ridge-scarp'), `rugged fixture never produced ridge scarps: ${[...roles]}`);
assert(roles.has('talus-apron'), `rugged fixture never produced talus aprons: ${[...roles]}`);
assert(roles.has('bedrock-exposure'), `rugged fixture never produced bedrock exposure: ${[...roles]}`);
assert(kinds.size >= 4, `geology kinds too uniform: ${[...kinds]}`);
assert(ridgeAligned > 0, 'ridge morphology never adopted scarp/bedrock geometry');
assert(talusAligned > 0, 'talus morphology never adopted talus/boulder geometry');
assert(xPhaseBins.size >= 7 && zPhaseBins.size >= 7, `candidate grid phase remains visible ${xPhaseBins.size}/${zPhaseBins.size}`);
const nearestMean = nearest.reduce((sum, value) => sum + value, 0) / nearest.length;
const nearestVariance = nearest.reduce((sum, value) => sum + (value - nearestMean) ** 2, 0) / nearest.length;
const nearestCv = Math.sqrt(nearestVariance) / nearestMean;
assert(nearestCv >= 0.16, `nearest-neighbour field remains too mechanically even: CV=${nearestCv}`);

const canonicalHeight = createHeightSampler(SEED, undefined, []);
const canonical = generateNaturalGeologyPlacements({
  sampleHeightMeters: canonicalHeight,
  seaLevelMeters: SEA,
  seed: SEED,
  worldWidthMeters: WIDTH,
  worldDepthMeters: DEPTH,
  maxPlacements: 360,
});
assert(canonical.placements.length >= 80, `canonical geology unexpectedly sparse: ${canonical.placements.length}`);
let canonicalGroundingViolations = 0;
let canonicalShorelineViolations = 0;
for (const p of canonical.placements) {
  const ground = canonicalHeight(p.x, p.z);
  if (Math.abs(p.y - (ground - p.scale.y * p.buryFraction)) > 1e-6) canonicalGroundingViolations++;
  if (ground - SEA <= P.shorelineReserveMeters) canonicalShorelineViolations++;
}
assert.equal(canonicalGroundingViolations, 0, `canonical visual/collider grounding mismatch ${canonicalGroundingViolations}`);
assert.equal(canonicalShorelineViolations, 0, `canonical shoreline placement leak ${canonicalShorelineViolations}`);
const mobile = generateNaturalGeologyPlacements({
  sampleHeightMeters: canonicalHeight,
  seaLevelMeters: SEA,
  seed: SEED,
  worldWidthMeters: WIDTH,
  worldDepthMeters: DEPTH,
  isMobileClass: true,
});
assert(mobile.placements.length <= P.mobileMaxPlacements, `mobile geology budget exceeded: ${mobile.placements.length}`);

console.log('[checkNaturalGeologyMorphology] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  ruggedChecksum: checksumNaturalGeologyPlacements(first.placements),
  ruggedPlacements: first.placements.length,
  canonicalPlacements: canonical.placements.length,
  mobilePlacements: mobile.placements.length,
  roles: first.stats.formationRoles,
  kinds: first.stats.kinds,
  minimumRoadDistanceMeters: Number(minRoad.toFixed(2)),
  minimumSeatDistanceMeters: Number(minSeat.toFixed(2)),
  nearestNeighborCv: Number(nearestCv.toFixed(3)),
  antiGridPhaseBins: { x: xPhaseBins.size, z: zPhaseBins.size },
}, null, 2));
