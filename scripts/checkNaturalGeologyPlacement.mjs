#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY,
  checksumNaturalGeologyPlacements,
  generateNaturalGeologyPlacements,
  minimumDistanceToRoadMeters,
  minimumDistanceToSeatMeters,
  naturalGeologyCandidateUv,
  naturalGeologyCandidateWorld,
  sampleTerrainFrame,
} from '../src/3d/world/naturalGeologyPlacement.js';
import { VALYRIA_GEOLOGY_POLICY } from '../src/3d/world/valyriaGeology.js';

const WIDTH = 13296.078906418774;
const DEPTH = 10341.394704992379;
const SEA = 6;
const SEED = 1337;
const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;

function terrain(x, z) {
  const nx = x / WIDTH;
  const nz = z / DEPTH;
  const regional = 74
    + Math.sin(nx * Math.PI * 3.2 + nz * 1.7) * 42
    + Math.sin(nz * Math.PI * 4.5 - nx * 1.1) * 29;
  const ridges = Math.pow(Math.abs(Math.sin((nx * 0.78 + nz * 0.34) * Math.PI * 17)), 1.55) * 88;
  const valleys = Math.pow(Math.abs(Math.sin((nx * -0.21 + nz * 0.87) * Math.PI * 9)), 2.3) * -31;
  return Math.max(SEA + 2, regional + ridges + valleys + Math.max(0, nz + 0.18) * 45);
}

const seats = [
  { x: -1700, z: -1200 },
  { x: 1850, z: 900 },
  { x: 400, z: 2700 },
];
const roadEdges = [{
  points: [
    { x: -1700, z: -1200 },
    { x: -650, z: -450 },
    { x: 500, z: 80 },
    { x: 1850, z: 900 },
  ],
}];
const generate = (options = {}) => generateNaturalGeologyPlacements({
  sampleHeightMeters: terrain,
  seaLevelMeters: SEA,
  seed: SEED,
  seats,
  roadEdges,
  worldWidthMeters: WIDTH,
  worldDepthMeters: DEPTH,
  maxPlacements: 420,
  ...options,
});

assert(P.id.includes('v3-r2-morphology-blue-noise'));
assert.equal(P.candidateDistribution, 'r2-low-discrepancy-cranley-patterson');
assert.equal(P.candidateGridOwnsCoordinates, false);
assert.equal(P.lowDiscrepancySequence, true);
assert.equal(P.cranleyPattersonScramble, true);
assert.equal(P.valyriaMorphologyAligned, true);
assert(P.valyriaClusterCandidateTrials >= 4);

const desktopCandidateCount = P.desktopGridColumns * P.desktopGridRows;
const candidateUvs = Array.from({ length: desktopCandidateCount }, (_, index) => naturalGeologyCandidateUv(SEED, index));
const repeatedUvs = Array.from({ length: desktopCandidateCount }, (_, index) => naturalGeologyCandidateUv(SEED, index));
assert.deepEqual(candidateUvs, repeatedUvs);
const uniqueCandidates = new Set(candidateUvs.map(({ u, v }) => `${u.toFixed(12)}:${v.toFixed(12)}`));
assert.equal(uniqueCandidates.size, desktopCandidateCount, 'R2 sequence produced duplicate candidates');
assert.notDeepEqual(candidateUvs.slice(0, 64), Array.from({ length: 64 }, (_, index) => naturalGeologyCandidateUv(SEED + 1, index)));

const legacyCells = new Map();
const xCoverage = new Set();
const zCoverage = new Set();
const fractionX = new Set();
const fractionZ = new Set();
for (const point of candidateUvs) {
  assert(point.u >= 0 && point.u < 1 && point.v >= 0 && point.v < 1);
  const cx = Math.floor(point.u * P.desktopGridColumns);
  const cz = Math.floor(point.v * P.desktopGridRows);
  const key = `${cx}:${cz}`;
  legacyCells.set(key, (legacyCells.get(key) ?? 0) + 1);
  xCoverage.add(Math.floor(point.u * 32));
  zCoverage.add(Math.floor(point.v * 32));
  fractionX.add(Math.floor(((point.u * P.desktopGridColumns) % 1) * 32));
  fractionZ.add(Math.floor(((point.v * P.desktopGridRows) % 1) * 32));
}
const legacyCollisionCount = [...legacyCells.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
const legacyEmptyCellCount = desktopCandidateCount - legacyCells.size;
assert(legacyCollisionCount > desktopCandidateCount * 0.10,
  `candidate lattice still behaves like one-per-cell: collisions=${legacyCollisionCount}`);
assert(legacyEmptyCellCount > desktopCandidateCount * 0.10,
  `candidate lattice still fills nearly every legacy cell: empty=${legacyEmptyCellCount}`);
assert.equal(xCoverage.size, 32);
assert.equal(zCoverage.size, 32);
assert(fractionX.size >= 28 && fractionZ.size >= 28,
  `sub-cell sequence collapsed: ${fractionX.size}/${fractionZ.size}`);

for (let index = 0; index < 512; index += 1) {
  const p = naturalGeologyCandidateWorld(SEED, index, WIDTH, DEPTH);
  assert(p.x >= -WIDTH * 0.5 && p.x < WIDTH * 0.5);
  assert(p.z >= -DEPTH * 0.5 && p.z < DEPTH * 0.5);
}

const first = generate();
const second = generate();
assert.equal(first.policyId, P.id);
assert.deepEqual(first.placements, second.placements);
assert.equal(checksumNaturalGeologyPlacements(first.placements), checksumNaturalGeologyPlacements(second.placements));
assert(first.placements.length >= 90 && first.placements.length <= 420);
assert.notEqual(
  checksumNaturalGeologyPlacements(first.placements),
  checksumNaturalGeologyPlacements(generate({ seed: SEED + 1 }).placements),
);
assert.equal(first.stats.candidateDistribution, P.candidateDistribution);
assert.equal(first.stats.candidateGridOwnsCoordinates, false);
assert.equal(first.stats.candidateCount, desktopCandidateCount);

const faultWorldAngle = Math.atan2(
  Math.sin(VALYRIA_GEOLOGY_POLICY.faultStrikeRadians) * VALYRIA_GEOLOGY_POLICY.coreRadius.ny * DEPTH,
  Math.cos(VALYRIA_GEOLOGY_POLICY.faultStrikeRadians) * VALYRIA_GEOLOGY_POLICY.coreRadius.nx * WIDTH,
);
const axialDifference = (a, b) => {
  let difference = Math.abs((a - b) % Math.PI);
  if (difference > Math.PI * 0.5) difference = Math.PI - difference;
  return difference;
};

let minSeat = Infinity;
let minRoad = Infinity;
let minPair = Infinity;
let maxSlope = 0;
let valyriaCount = 0;
let proxyCount = 0;
let faultDominant = 0;
let drainageDominant = 0;
let shoulderDominant = 0;
let faultYawDeviationSum = 0;
let maxFaultYawDeviation = 0;
const kinds = new Set();
const clusterKinds = new Set();
const clusterMorphologyModes = new Set();
const placementMorphologyKinds = new Set();
const yawBuckets = new Set();
const acceptedCandidateIndices = new Set();

for (const cluster of first.clusters) {
  clusterKinds.add(cluster.kind);
  clusterMorphologyModes.add(cluster.morphologyMode);
  if (cluster.morphologyMode !== 'regional-strata') {
    assert(Number.isFinite(cluster.morphologySignal));
    assert(cluster.morphologySignal >= 0 && cluster.morphologySignal <= 1);
  }
}

for (let index = 0; index < first.placements.length; index += 1) {
  const placement = first.placements[index];
  kinds.add(placement.kind);
  if (placement.volcanic) valyriaCount += 1;
  if (placement.kind === 'asset-proxy') proxyCount += 1;
  yawBuckets.add(Math.round((((placement.yawRadians % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 12)));
  assert.equal(placement.candidateDistribution, P.candidateDistribution);
  assert(Number.isInteger(placement.candidateIndex));
  assert(!acceptedCandidateIndices.has(placement.candidateIndex));
  acceptedCandidateIndices.add(placement.candidateIndex);

  const seatDistance = minimumDistanceToSeatMeters(placement.x, placement.z, seats);
  const roadDistance = minimumDistanceToRoadMeters(placement.x, placement.z, roadEdges);
  minSeat = Math.min(minSeat, seatDistance);
  minRoad = Math.min(minRoad, roadDistance);
  maxSlope = Math.max(maxSlope, placement.slopeDegrees);
  assert(seatDistance >= P.settlementReserveMeters - 1e-9);
  assert(roadDistance >= P.roadReserveMeters - 1e-9);
  assert(placement.heightAboveSeaMeters > P.shorelineReserveMeters);
  assert(placement.slopeDegrees <= P.maxRockSlopeDegrees + 1e-9);
  assert(placement.scale.x > 0 && placement.scale.y > 0 && placement.scale.z > 0);

  for (let other = 0; other < index; other += 1) {
    minPair = Math.min(minPair, Math.hypot(
      placement.x - first.placements[other].x,
      placement.z - first.placements[other].z,
    ));
  }

  if (!placement.volcanic) continue;
  assert.equal(typeof placement.valyriaMorphologyDominant, 'string');
  assert(Number.isFinite(placement.valyriaMorphologyStrength));
  assert(placement.valyriaMorphologyStrength >= 0 && placement.valyriaMorphologyStrength <= 1);
  placementMorphologyKinds.add(placement.valyriaMorphologyDominant);
  if (placement.valyriaMorphologyDominant === 'fault') {
    faultDominant += 1;
    const deviation = axialDifference(placement.yawRadians, faultWorldAngle);
    faultYawDeviationSum += deviation;
    maxFaultYawDeviation = Math.max(maxFaultYawDeviation, deviation);
  } else if (placement.valyriaMorphologyDominant === 'lava-drainage' || placement.valyriaMorphologyDominant === 'erosion-gully') {
    drainageDominant += 1;
  } else if (placement.valyriaMorphologyDominant === 'shoulder') {
    shoulderDominant += 1;
  }
}

assert(minPair >= P.minimumNearestNeighborMeters - 1e-9);
assert(kinds.size >= 4, `morphology too uniform: ${[...kinds]}`);
assert(clusterKinds.size === 3, `cluster families missing: ${[...clusterKinds]}`);
assert(clusterMorphologyModes.has('regional-strata'));
assert(clusterMorphologyModes.has('fault'));
assert(clusterMorphologyModes.size >= 4);
assert(yawBuckets.size >= 8, `orientation too repetitive: ${yawBuckets.size}`);
assert(proxyCount > 0, 'real GLB proxy family never activated');
assert(valyriaCount >= 8, `Valyria geology too sparse: ${valyriaCount}`);
assert(placementMorphologyKinds.size >= 3);
assert(faultDominant > 0);
assert(drainageDominant > 0);
assert(shoulderDominant > 0);
assert.equal(first.stats.valyriaMorphologyAligned, true);
assert.equal(first.stats.faultAlignedPlacementCount, faultDominant);
assert.equal(first.stats.drainageAlignedPlacementCount, drainageDominant);

const meanFaultYawDeviation = faultDominant ? faultYawDeviationSum / faultDominant : Infinity;
assert(meanFaultYawDeviation < 0.48,
  `fault outcrops lost regional strike alignment: ${meanFaultYawDeviation.toFixed(3)} rad`);
assert(maxFaultYawDeviation < 0.78,
  `individual fault outcrop diverged too far from regional strike: ${maxFaultYawDeviation.toFixed(3)} rad`);

const frame = sampleTerrainFrame(terrain, 1250, -860, 9);
assert(Math.abs(Math.hypot(frame.nx, frame.ny, frame.nz) - 1) < 1e-10);
const mobile = generate({ isMobileClass: true, maxPlacements: undefined });
assert(mobile.placements.length <= P.mobileMaxPlacements);
assert.equal(mobile.stats.genericClusterCount, P.mobileClusterCount);
assert.equal(mobile.stats.valyriaClusterCount, P.mobileValyriaClusterCount);
assert.equal(mobile.stats.candidateDistribution, P.candidateDistribution);

console.log('[checkNaturalGeologyPlacement] PASS');
console.log(JSON.stringify({
  policyId: first.policyId,
  checksum: checksumNaturalGeologyPlacements(first.placements),
  candidateDistribution: first.stats.candidateDistribution,
  desktopCandidateCount,
  legacyOccupiedCells: legacyCells.size,
  legacyEmptyCellCount,
  legacyCollisionCount,
  subCellBins: { x: fractionX.size, z: fractionZ.size },
  placedCount: first.placements.length,
  mobilePlacedCount: mobile.placements.length,
  valyriaPlacementCount: valyriaCount,
  proxyCount,
  faultDominant,
  drainageDominant,
  shoulderDominant,
  minimumPairDistanceMeters: Number(minPair.toFixed(3)),
  minimumSeatDistanceMeters: Number(minSeat.toFixed(3)),
  minimumRoadDistanceMeters: Number(minRoad.toFixed(3)),
  maximumSlopeDegrees: Number(maxSlope.toFixed(3)),
  meanFaultYawDeviationRadians: Number(meanFaultYawDeviation.toFixed(4)),
  maximumFaultYawDeviationRadians: Number(maxFaultYawDeviation.toFixed(4)),
  orientationBuckets: yawBuckets.size,
}, null, 2));