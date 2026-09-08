#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { terrainDrainageSignals } from '../src/3d/world/terrainMacroWeathering.js';
import {
  MAJOR_RIVER_NETWORK_POLICY,
  generateMajorRiverNetwork,
  riverWorldToNormalized,
  summarizeMajorRiverNetwork,
} from '../src/3d/world/riverNetwork.js';

const P = MAJOR_RIVER_NETWORK_POLICY;
const EPS = 1e-7;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

assert.equal(P.deterministic, true);
assert.equal(P.rendererIndependent, true);
assert.equal(P.terrainHeightAuthority, 'world/terrain.js');
assert.equal(P.canonicalWaterClassificationUnchanged, true);
assert.equal(P.canonicalCoastlineUnchanged, true);
assert.equal(P.riverCarvesTerrain, false);
assert(P.desktopTargetRiverCount >= 6);
assert(P.traceDirectionCount >= 12);
assert(P.traceEscalationMultipliers.length >= 4);
assert(P.sourceMinimumSpacingMeters >= 900);
assert(P.confluenceMaximumVerticalRiseMeters <= 0.25);

const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const build = () => generateMajorRiverNetwork({
  sampleHeightMeters,
  seed: WORLD_DEFAULTS.WORLD_SEED,
  seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
  worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
  isMobileClass: false,
});

const startedAt = performance.now();
const first = build();
const elapsedMs = performance.now() - startedAt;
const second = build();

assert.equal(first.policyId, P.id);
assert.equal(first.stats.checksum, second.stats.checksum, 'same seed/terrain must keep exact river checksum');
assert.equal(first.stats.riverCount, second.stats.riverCount);
assert(first.stats.riverCount >= 5, `canonical world produced too few major rivers: ${first.stats.riverCount}`);
assert(first.stats.totalLengthMeters >= 8_000, `major network is too short: ${first.stats.totalLengthMeters}`);
assert(first.stats.averageLengthMeters >= 900, `average river is too short: ${first.stats.averageLengthMeters}`);
assert(first.stats.maxUphillFraction <= P.maximumAcceptedUphillFraction + EPS);
assert(first.stats.localMinimumTerminations <= Math.max(2, Math.floor(first.stats.riverCount * 0.35)));
assert(elapsedMs < 9_000, `major river generation became too expensive: ${elapsedMs.toFixed(1)}ms`);

const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
let sampledPointCount = 0;
let uphillSegmentCount = 0;
let segmentCount = 0;
let drainageSum = 0;
let confluenceSignalSum = 0;
let sourceHeightMin = Infinity;
let sourceHeightMax = -Infinity;
const sourcePairs = [];
const quadrantCounts = [0, 0, 0, 0];
const endReasons = new Map();
const riverDiagnostics = [];

for (let riverIndex = 0; riverIndex < first.rivers.length; riverIndex += 1) {
  const river = first.rivers[riverIndex];
  assert.equal(river.accepted, true);
  assert(river.points.length >= P.minimumAcceptedPointCount);
  assert(river.lengthMeters >= P.minimumAcceptedRiverLengthMeters);
  assert(river.source.y - WORLD_DEFAULTS.WATER_LEVEL_METERS >= P.sourceMinimumHeightAboveSeaMeters - 1e-6);
  sourceHeightMin = Math.min(sourceHeightMin, river.source.y - WORLD_DEFAULTS.WATER_LEVEL_METERS);
  sourceHeightMax = Math.max(sourceHeightMax, river.source.y - WORLD_DEFAULTS.WATER_LEVEL_METERS);
  sourcePairs.push(river.source);
  endReasons.set(river.endReason, (endReasons.get(river.endReason) ?? 0) + 1);

  const firstPoint = river.points[0];
  const quadrant = (firstPoint.x >= 0 ? 1 : 0) + (firstPoint.z >= 0 ? 2 : 0);
  quadrantCounts[quadrant] += 1;

  let previousWidth = -Infinity;
  let maxRise = 0;
  for (let pointIndex = 0; pointIndex < river.points.length; pointIndex += 1) {
    const point = river.points[pointIndex];
    sampledPointCount += 1;
    assert(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    assert(Math.abs(point.x) <= halfWidth + 1e-6, `river escaped world X: ${point.x}`);
    assert(Math.abs(point.z) <= halfDepth + 1e-6, `river escaped world Z: ${point.z}`);
    assert(point.widthMeters + EPS >= previousWidth, `river width narrowed downstream at ${riverIndex}:${pointIndex}`);
    previousWidth = point.widthMeters;

    const canonicalY = sampleHeightMeters(point.x, point.z);
    assert(Math.abs(canonicalY - point.y) <= 1e-7, `river point detached from canonical terrain at ${riverIndex}:${pointIndex}`);
    const { nx, ny } = riverWorldToNormalized(point.x, point.z);
    const drainage = terrainDrainageSignals(nx, ny);
    drainageSum += clamp01(drainage.channel);
    confluenceSignalSum += clamp01(drainage.confluence);

    if (pointIndex > 0) {
      const previous = river.points[pointIndex - 1];
      const rise = point.y - previous.y;
      maxRise = Math.max(maxRise, rise);
      segmentCount += 1;
      if (rise > 0.05) uphillSegmentCount += 1;
    }
  }
  assert(maxRise <= Math.max(0.13, P.confluenceMaximumVerticalRiseMeters + 0.02), `river has implausible uphill jump: ${maxRise}`);
  riverDiagnostics.push({
    riverIndex,
    endReason: river.endReason,
    lengthKm: river.lengthMeters / 1000,
    points: river.points.length,
    sourceHeightAboveSeaMeters: river.source.y - WORLD_DEFAULTS.WATER_LEVEL_METERS,
    uphillFraction: river.uphillFraction,
    escalatedStepCount: river.escalatedStepCount,
  });
}

for (let i = 0; i < sourcePairs.length; i += 1) {
  for (let j = i + 1; j < sourcePairs.length; j += 1) {
    const distance = Math.hypot(sourcePairs[i].x - sourcePairs[j].x, sourcePairs[i].z - sourcePairs[j].z);
    assert(distance >= P.sourceMinimumSpacingMeters - 1e-5, `sources collapsed together: ${distance}`);
  }
}

const occupiedQuadrants = quadrantCounts.filter((count) => count > 0).length;
assert(occupiedQuadrants >= 3, `major rivers are spatially concentrated: ${quadrantCounts.join(',')}`);
assert(segmentCount > 0);
const uphillFraction = uphillSegmentCount / segmentCount;
assert(uphillFraction <= P.maximumAcceptedUphillFraction + EPS);

// Compare the network with a deterministic owner-map lattice rather than arbitrary hand-picked points.
// Only dry/high-enough samples enter the baseline, so this checks hydrologic alignment rather than the
// trivial fact that river sources are on land.
let baselineDrainageSum = 0;
let baselineConfluenceSum = 0;
let baselineCount = 0;
const columns = 36;
const rows = 28;
for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const nx = (column + 0.5) / columns;
    const ny = (row + 0.5) / rows;
    const x = (nx - 0.5) * WORLD_SCALE.WORLD_WIDTH_METERS;
    const z = (ny - 0.5) * WORLD_SCALE.WORLD_DEPTH_METERS;
    const heightAboveSea = sampleHeightMeters(x, z) - WORLD_DEFAULTS.WATER_LEVEL_METERS;
    if (heightAboveSea < 25) continue;
    const signals = terrainDrainageSignals(nx, ny);
    baselineDrainageSum += clamp01(signals.channel);
    baselineConfluenceSum += clamp01(signals.confluence);
    baselineCount += 1;
  }
}
assert(baselineCount > 200);
const riverDrainageMean = drainageSum / sampledPointCount;
const riverConfluenceMean = confluenceSignalSum / sampledPointCount;
const baselineDrainageMean = baselineDrainageSum / baselineCount;
const baselineConfluenceMean = baselineConfluenceSum / baselineCount;
assert(riverDrainageMean > baselineDrainageMean * 1.08, `river network ignored terrain drainage fabric: ${riverDrainageMean} vs ${baselineDrainageMean}`);
assert(riverConfluenceMean >= baselineConfluenceMean * 0.80, `river confluence signal unexpectedly weak: ${riverConfluenceMean} vs ${baselineConfluenceMean}`);

const summary = summarizeMajorRiverNetwork(first);
const result = {
  policyId: P.id,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  checksum: first.stats.checksum,
  summary,
  sourceCandidateCount: first.sourceCandidateCount,
  rejectedCount: first.rejected.length,
  sampledPointCount,
  sourceHeightAboveSeaMeters: {
    min: Number(sourceHeightMin.toFixed(2)),
    max: Number(sourceHeightMax.toFixed(2)),
  },
  endReasons: Object.fromEntries([...endReasons.entries()].sort()),
  quadrantCounts,
  occupiedQuadrants,
  uphillSegmentFraction: uphillFraction,
  drainage: {
    riverMean: riverDrainageMean,
    dryLandBaselineMean: baselineDrainageMean,
    ratio: riverDrainageMean / Math.max(1e-9, baselineDrainageMean),
  },
  confluence: {
    riverMean: riverConfluenceMean,
    dryLandBaselineMean: baselineConfluenceMean,
  },
  rivers: riverDiagnostics,
};

console.log('[checkMajorRiverNetwork] PASS');
console.log(JSON.stringify(result, null, 2));
