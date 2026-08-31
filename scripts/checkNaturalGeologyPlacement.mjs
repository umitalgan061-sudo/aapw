#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  NATURAL_GEOLOGY_PLACEMENT_POLICY,
  checksumNaturalGeologyPlacements,
  generateNaturalGeologyPlacements,
  minimumDistanceToRoadMeters,
  minimumDistanceToSeatMeters,
  sampleTerrainFrame,
} from '../src/3d/world/naturalGeologyPlacement.js';
import { VALYRIA_GEOLOGY_POLICY } from '../src/3d/world/valyriaGeology.js';

const WIDTH = 13296.078906418774;
const DEPTH = 10341.394704992379;
const SEA = 6;
const SEED = 1337;

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

const first = generate();
const second = generate();
assert.equal(first.policyId, NATURAL_GEOLOGY_PLACEMENT_POLICY.id);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.id.includes('v2-valyria-morphology-aligned'));
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMorphologyAligned, true);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaClusterCandidateTrials >= 4);
assert.deepEqual(first.placements, second.placements);
assert.equal(
  checksumNaturalGeologyPlacements(first.placements),
  checksumNaturalGeologyPlacements(second.placements),
);
assert(first.placements.length >= 90 && first.placements.length <= 420);
assert.notEqual(
  checksumNaturalGeologyPlacements(first.placements),
  checksumNaturalGeologyPlacements(generate({ seed: SEED + 1 }).placements),
);

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
const xBins = new Set();
const zBins = new Set();

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

  const seatDistance = minimumDistanceToSeatMeters(placement.x, placement.z, seats);
  const roadDistance = minimumDistanceToRoadMeters(placement.x, placement.z, roadEdges);
  minSeat = Math.min(minSeat, seatDistance);
  minRoad = Math.min(minRoad, roadDistance);
  maxSlope = Math.max(maxSlope, placement.slopeDegrees);
  assert(seatDistance >= NATURAL_GEOLOGY_PLACEMENT_POLICY.settlementReserveMeters - 1e-9);
  assert(roadDistance >= NATURAL_GEOLOGY_PLACEMENT_POLICY.roadReserveMeters - 1e-9);
  assert(placement.heightAboveSeaMeters > NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters);
  assert(placement.slopeDegrees <= NATURAL_GEOLOGY_PLACEMENT_POLICY.maxRockSlopeDegrees + 1e-9);
  assert(placement.scale.x > 0 && placement.scale.y > 0 && placement.scale.z > 0);

  for (let other = 0; other < index; other += 1) {
    minPair = Math.min(
      minPair,
      Math.hypot(placement.x - first.placements[other].x, placement.z - first.placements[other].z),
    );
  }

  const fx = ((placement.x + WIDTH * 0.5) / first.stats.cellWidthMeters) % 1;
  const fz = ((placement.z + DEPTH * 0.5) / first.stats.cellDepthMeters) % 1;
  xBins.add(Math.floor(fx * 10));
  zBins.add(Math.floor(fz * 10));

  if (!placement.volcanic) continue;
  assert.equal(typeof placement.valyriaMorphologyDominant, 'string');
  assert(Number.isFinite(placement.valyriaMorphologyStrength));
  assert(placement.valyriaMorphologyStrength >= 0 && placement.valyriaMorphologyStrength <= 1);
  assert(placement.valyriaMorphology && typeof placement.valyriaMorphology === 'object');
  placementMorphologyKinds.add(placement.valyriaMorphologyDominant);

  if (placement.valyriaMorphologyDominant === 'fault') {
    faultDominant += 1;
    const deviation = axialDifference(placement.yawRadians, faultWorldAngle);
    faultYawDeviationSum += deviation;
    maxFaultYawDeviation = Math.max(maxFaultYawDeviation, deviation);
  } else if (
    placement.valyriaMorphologyDominant === 'lava-drainage'
    || placement.valyriaMorphologyDominant === 'erosion-gully'
  ) {
    drainageDominant += 1;
  } else if (placement.valyriaMorphologyDominant === 'shoulder') {
    shoulderDominant += 1;
  }
}

assert(minPair >= NATURAL_GEOLOGY_PLACEMENT_POLICY.minimumNearestNeighborMeters - 1e-9);
assert(kinds.size >= 4, `morphology too uniform: ${[...kinds]}`);
assert(clusterKinds.size === 3, `cluster families missing: ${[...clusterKinds]}`);
assert(clusterMorphologyModes.has('regional-strata'));
assert(clusterMorphologyModes.has('fault'), `Valyria fault clusters missing: ${[...clusterMorphologyModes]}`);
assert(clusterMorphologyModes.size >= 4,
  `Valyria morphology cluster diversity too low: ${[...clusterMorphologyModes]}`);
assert(yawBuckets.size >= 8, `orientation too repetitive: ${yawBuckets.size}`);
assert(xBins.size >= 6 && zBins.size >= 6, `grid read remains: ${xBins.size}/${zBins.size}`);
assert(proxyCount > 0, 'real GLB proxy family never activated');
assert(valyriaCount >= 8, `Valyria geology too sparse: ${valyriaCount}`);
assert(placementMorphologyKinds.size >= 3,
  `Valyria placement morphology collapsed: ${[...placementMorphologyKinds]}`);
assert(faultDominant > 0, 'fault morphology never reached accepted Valyria outcrops');
assert(drainageDominant > 0, 'lava/gully morphology never reached accepted Valyria outcrops');
assert(shoulderDominant > 0, 'broken-caldera shoulder morphology never reached accepted Valyria outcrops');
assert.equal(first.stats.valyriaMorphologyAligned, true);
assert.equal(first.stats.faultAlignedPlacementCount, faultDominant);
assert.equal(first.stats.drainageAlignedPlacementCount, drainageDominant);
assert(Object.keys(first.stats.valyriaMorphologyKinds).length >= 3);

const meanFaultYawDeviation = faultDominant ? faultYawDeviationSum / faultDominant : Infinity;
assert(meanFaultYawDeviation < 0.48,
  `fault outcrops lost regional strike alignment: ${meanFaultYawDeviation.toFixed(3)} rad`);
assert(maxFaultYawDeviation < 0.78,
  `individual fault outcrop diverged too far from regional strike: ${maxFaultYawDeviation.toFixed(3)} rad`);

const frame = sampleTerrainFrame(terrain, 1250, -860, 9);
assert(Math.abs(Math.hypot(frame.nx, frame.ny, frame.nz) - 1) < 1e-10);
const mobile = generate({ isMobileClass: true, maxPlacements: undefined });
assert(mobile.placements.length <= NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileMaxPlacements);
assert.equal(mobile.stats.genericClusterCount, NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileClusterCount);
assert.equal(mobile.stats.valyriaClusterCount, NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileValyriaClusterCount);
assert.equal(mobile.stats.valyriaMorphologyAligned, true);

console.log('[checkNaturalGeologyPlacement] PASS');
console.log(JSON.stringify({
  policyId: first.policyId,
  checksum: checksumNaturalGeologyPlacements(first.placements),
  placedCount: first.placements.length,
  mobilePlacedCount: mobile.placements.length,
  valyriaPlacementCount: valyriaCount,
  proxyCount,
  faultDominant,
  drainageDominant,
  shoulderDominant,
  valyriaMorphologyKinds: first.stats.valyriaMorphologyKinds,
  clusterMorphologyModes: [...clusterMorphologyModes].sort(),
  kinds: first.stats.kinds,
  assetFamilies: first.stats.assetFamilies,
  minimumPairDistanceMeters: Number(minPair.toFixed(3)),
  minimumSeatDistanceMeters: Number(minSeat.toFixed(3)),
  minimumRoadDistanceMeters: Number(minRoad.toFixed(3)),
  maximumSlopeDegrees: Number(maxSlope.toFixed(3)),
  meanFaultYawDeviationRadians: Number(meanFaultYawDeviation.toFixed(4)),
  maximumFaultYawDeviationRadians: Number(maxFaultYawDeviation.toFixed(4)),
  orientationBuckets: yawBuckets.size,
  antiGridBins: { x: xBins.size, z: zBins.size },
}, null, 2));
