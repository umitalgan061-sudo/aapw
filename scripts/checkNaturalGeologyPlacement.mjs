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

const WIDTH = 13296.078906418774;
const DEPTH = 10341.394704992379;
const SEA = 6;
const SEED = 1337;
function terrain(x, z) {
  const nx = x / WIDTH, nz = z / DEPTH;
  const regional = 74 + Math.sin(nx * Math.PI * 3.2 + nz * 1.7) * 42 + Math.sin(nz * Math.PI * 4.5 - nx * 1.1) * 29;
  const ridges = Math.pow(Math.abs(Math.sin((nx * 0.78 + nz * 0.34) * Math.PI * 17)), 1.55) * 88;
  const valleys = Math.pow(Math.abs(Math.sin((nx * -0.21 + nz * 0.87) * Math.PI * 9)), 2.3) * -31;
  return Math.max(SEA + 2, regional + ridges + valleys + Math.max(0, nz + 0.18) * 45);
}
const seats = [{ x: -1700, z: -1200 }, { x: 1850, z: 900 }, { x: 400, z: 2700 }];
const roadEdges = [{ points: [{ x: -1700, z: -1200 }, { x: -650, z: -450 }, { x: 500, z: 80 }, { x: 1850, z: 900 }] }];
const generate = (options = {}) => generateNaturalGeologyPlacements({ sampleHeightMeters: terrain, seaLevelMeters: SEA, seed: SEED, seats, roadEdges, worldWidthMeters: WIDTH, worldDepthMeters: DEPTH, maxPlacements: 420, ...options });

const first = generate(), second = generate();
assert.equal(first.policyId, NATURAL_GEOLOGY_PLACEMENT_POLICY.id);
assert.deepEqual(first.placements, second.placements);
assert.equal(checksumNaturalGeologyPlacements(first.placements), checksumNaturalGeologyPlacements(second.placements));
assert(first.placements.length >= 90 && first.placements.length <= 420);
assert.notEqual(checksumNaturalGeologyPlacements(first.placements), checksumNaturalGeologyPlacements(generate({ seed: SEED + 1 }).placements));

let minSeat = Infinity, minRoad = Infinity, minPair = Infinity, maxSlope = 0, valyriaCount = 0, proxyCount = 0;
const kinds = new Set(), clusterKinds = new Set(), yawBuckets = new Set(), xBins = new Set(), zBins = new Set();
for (let i = 0; i < first.placements.length; i += 1) {
  const p = first.placements[i];
  kinds.add(p.kind); clusterKinds.add(p.sourceClusterKind); if (p.volcanic) valyriaCount++; if (p.kind === 'asset-proxy') proxyCount++;
  yawBuckets.add(Math.round((((p.yawRadians % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 12)));
  const seatDistance = minimumDistanceToSeatMeters(p.x, p.z, seats), roadDistance = minimumDistanceToRoadMeters(p.x, p.z, roadEdges);
  minSeat = Math.min(minSeat, seatDistance); minRoad = Math.min(minRoad, roadDistance); maxSlope = Math.max(maxSlope, p.slopeDegrees);
  assert(seatDistance >= NATURAL_GEOLOGY_PLACEMENT_POLICY.settlementReserveMeters - 1e-9);
  assert(roadDistance >= NATURAL_GEOLOGY_PLACEMENT_POLICY.roadReserveMeters - 1e-9);
  assert(p.heightAboveSeaMeters > NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters);
  assert(p.slopeDegrees <= NATURAL_GEOLOGY_PLACEMENT_POLICY.maxRockSlopeDegrees + 1e-9);
  assert(p.scale.x > 0 && p.scale.y > 0 && p.scale.z > 0);
  for (let j = 0; j < i; j += 1) minPair = Math.min(minPair, Math.hypot(p.x - first.placements[j].x, p.z - first.placements[j].z));
  const fx = ((p.x + WIDTH * 0.5) / first.stats.cellWidthMeters) % 1;
  const fz = ((p.z + DEPTH * 0.5) / first.stats.cellDepthMeters) % 1;
  xBins.add(Math.floor(fx * 10)); zBins.add(Math.floor(fz * 10));
}
assert(minPair >= NATURAL_GEOLOGY_PLACEMENT_POLICY.minimumNearestNeighborMeters - 1e-9);
assert(kinds.size >= 4, `morphology too uniform: ${[...kinds]}`);
assert(clusterKinds.size === 3, `cluster families missing: ${[...clusterKinds]}`);
assert(yawBuckets.size >= 8, `orientation too repetitive: ${yawBuckets.size}`);
assert(xBins.size >= 6 && zBins.size >= 6, `grid read remains: ${xBins.size}/${zBins.size}`);
assert(proxyCount > 0, 'real GLB proxy family never activated');
assert(valyriaCount >= 8, `Valyria geology too sparse: ${valyriaCount}`);

const frame = sampleTerrainFrame(terrain, 1250, -860, 9);
assert(Math.abs(Math.hypot(frame.nx, frame.ny, frame.nz) - 1) < 1e-10);
const mobile = generate({ isMobileClass: true, maxPlacements: undefined });
assert(mobile.placements.length <= NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileMaxPlacements);
assert.equal(mobile.stats.genericClusterCount, NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileClusterCount);
assert.equal(mobile.stats.valyriaClusterCount, NATURAL_GEOLOGY_PLACEMENT_POLICY.mobileValyriaClusterCount);

console.log('[checkNaturalGeologyPlacement] PASS');
console.log(JSON.stringify({ policyId: first.policyId, checksum: checksumNaturalGeologyPlacements(first.placements), placedCount: first.placements.length, mobilePlacedCount: mobile.placements.length, valyriaPlacementCount: valyriaCount, proxyCount, kinds: first.stats.kinds, assetFamilies: first.stats.assetFamilies, minimumPairDistanceMeters: Number(minPair.toFixed(3)), minimumSeatDistanceMeters: Number(minSeat.toFixed(3)), minimumRoadDistanceMeters: Number(minRoad.toFixed(3)), maximumSlopeDegrees: Number(maxSlope.toFixed(3)), orientationBuckets: yawBuckets.size, antiGridBins: { x: xBins.size, z: zBins.size } }, null, 2));
