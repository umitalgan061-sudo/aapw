/**
 * Deterministic major-river network derived from the canonical terrain height field and the same
 * macro-drainage fabric that shapes `terrainMacroWeathering.js`.
 *
 * This module deliberately has no Three.js dependency. It owns neither terrain height nor water
 * classification: callers pass the canonical `createHeightSampler()` result and this module only
 * chooses river polylines over it. `rivers.js` renders those polylines; `roadPathfinder.js` consumes
 * the same network as its river-avoidance authority so roads can never avoid a different river than
 * the one the player actually sees.
 *
 * @module world/riverNetwork
 */

import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import {
  TERRAIN_MACRO_WEATHERING_POLICY,
  terrainDrainageSignals,
} from './terrainMacroWeathering.js';

const TAU = Math.PI * 2;
const clamp01 = (value) => value <= 0 ? 0 : value >= 1 ? 1 : value;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export const MAJOR_RIVER_NETWORK_POLICY = Object.freeze({
  id: 'major-river-network-2026-09-01-v1-canonical-drainage',
  deterministic: true,
  rendererIndependent: true,
  terrainHeightAuthority: 'world/terrain.js',
  drainageAuthorityPolicyId: TERRAIN_MACRO_WEATHERING_POLICY.id,
  canonicalWaterClassificationUnchanged: true,
  canonicalCoastlineUnchanged: true,
  riverCarvesTerrain: false,
  desktopTargetRiverCount: 8,
  mobileTargetRiverCount: 5,
  sourceGridColumns: 30,
  sourceGridRows: 24,
  sourceEdgeInsetMeters: 260,
  sourceMinimumHeightAboveSeaMeters: 82,
  sourcePreferredHeightAboveSeaMeters: 280,
  sourceMinimumDrainageChannel: 0.23,
  sourceMinimumSpacingMeters: 1220,
  sourceCandidateMultiplier: 4,
  traceStepMeters: 62,
  traceDirectionCount: 16,
  traceGradientProbeMeters: 82,
  traceMaximumSteps: 260,
  traceMaximumLengthMeters: 7600,
  traceEscalationMultipliers: Object.freeze([1, 1.65, 2.55, 3.9, 5.5]),
  traceMinimumDropMeters: 0.035,
  traceSeaStopHeightAboveSeaMeters: 0.55,
  traceBoundsInsetMeters: 35,
  traceRecentPointRejectCount: 9,
  traceRecentPointRejectRadiusMeters: 52,
  confluenceMergeRadiusMeters: 105,
  confluenceMaximumVerticalRiseMeters: 0.12,
  minimumAcceptedRiverLengthMeters: 640,
  minimumAcceptedPointCount: 9,
  maximumAcceptedUphillFraction: 0.045,
  sourceElevationWeight: 0.54,
  sourceDrainageWeight: 0.32,
  sourceReliefWeight: 0.14,
  traceDropWeight: 1.0,
  traceDrainageWeightMeters: 10.5,
  traceDirectionWeightMeters: 2.4,
  traceConfluenceAttractionMeters: 7.5,
  widthSourceMeters: 4.8,
  widthMouthMeters: 15.5,
  widthMergedMouthMeters: 18.0,
});

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hash01(seed, a = 0, b = 0, c = 0) {
  let h = mix32((seed >>> 0) ^ Math.imul((a + 1) | 0, 0x9e3779b1));
  h = mix32(h ^ Math.imul((b + 17) | 0, 0x85ebca77));
  h = mix32(h ^ Math.imul((c + 101) | 0, 0xc2b2ae3d));
  return h / 4294967296;
}

function signedHash(seed, a, b, c = 0) {
  return hash01(seed, a, b, c) * 2 - 1;
}

export function riverWorldToNormalized(x, z, {
  worldWidthMeters = WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters = WORLD_SCALE.WORLD_DEPTH_METERS,
} = {}) {
  return Object.freeze({
    nx: clamp01(x / Math.max(1, worldWidthMeters) + 0.5),
    ny: clamp01(z / Math.max(1, worldDepthMeters) + 0.5),
  });
}

function pointInsideWorld(x, z, width, depth, inset) {
  const halfW = width * 0.5 - inset;
  const halfD = depth * 0.5 - inset;
  return x >= -halfW && x <= halfW && z >= -halfD && z <= halfD;
}

function sampleDrainageAtWorld(x, z, options) {
  const { nx, ny } = riverWorldToNormalized(x, z, options);
  const sampler = options.sampleDrainageSignals ?? terrainDrainageSignals;
  const signals = sampler(nx, ny) ?? {};
  return Object.freeze({
    nx,
    ny,
    broad: clamp01(finite(signals.broad)),
    fine: clamp01(finite(signals.fine)),
    channel: clamp01(finite(signals.channel)),
    confluence: clamp01(finite(signals.confluence)),
    floodplain: clamp01(finite(signals.floodplain)),
    divide: clamp01(finite(signals.divide)),
  });
}

function sourceScore(heightAboveSea, drainage, localReliefMeters, policy) {
  const elevation = smooth01(
    (heightAboveSea - policy.sourceMinimumHeightAboveSeaMeters)
    / Math.max(1, policy.sourcePreferredHeightAboveSeaMeters - policy.sourceMinimumHeightAboveSeaMeters),
  );
  const hydrology = clamp01(drainage.channel * 0.72 + drainage.fine * 0.18 + drainage.confluence * 0.10);
  const relief = smooth01(localReliefMeters / 34);
  return elevation * policy.sourceElevationWeight
    + hydrology * policy.sourceDrainageWeight
    + relief * policy.sourceReliefWeight;
}

function localRelief(sampleHeightMeters, x, z, probe) {
  const center = sampleHeightMeters(x, z);
  const values = [
    sampleHeightMeters(x + probe, z),
    sampleHeightMeters(x - probe, z),
    sampleHeightMeters(x, z + probe),
    sampleHeightMeters(x, z - probe),
  ];
  return Math.max(center, ...values) - Math.min(center, ...values);
}

export function selectMajorRiverSources({
  sampleHeightMeters,
  seed = WORLD_DEFAULTS.WORLD_SEED,
  seaLevelMeters = WORLD_DEFAULTS.WATER_LEVEL_METERS,
  isMobileClass = false,
  worldWidthMeters = WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters = WORLD_SCALE.WORLD_DEPTH_METERS,
  sampleDrainageSignals = terrainDrainageSignals,
  policy = MAJOR_RIVER_NETWORK_POLICY,
} = {}) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const target = isMobileClass ? policy.mobileTargetRiverCount : policy.desktopTargetRiverCount;
  const candidates = [];
  const columns = policy.sourceGridColumns;
  const rows = policy.sourceGridRows;
  const inset = policy.sourceEdgeInsetMeters;
  const usableW = Math.max(1, worldWidthMeters - inset * 2);
  const usableD = Math.max(1, worldDepthMeters - inset * 2);
  const cellW = usableW / columns;
  const cellD = usableD / rows;
  const probe = Math.max(45, Math.min(cellW, cellD) * 0.31);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const jitterX = (hash01(seed ^ 0x52495652, index, 1) - 0.5) * cellW * 0.72;
      const jitterZ = (hash01(seed ^ 0x52495652, index, 2) - 0.5) * cellD * 0.72;
      const x = -worldWidthMeters * 0.5 + inset + (column + 0.5) * cellW + jitterX;
      const z = -worldDepthMeters * 0.5 + inset + (row + 0.5) * cellD + jitterZ;
      const y = finite(sampleHeightMeters(x, z), seaLevelMeters - 1000);
      const heightAboveSea = y - seaLevelMeters;
      if (heightAboveSea < policy.sourceMinimumHeightAboveSeaMeters) continue;
      const drainage = sampleDrainageAtWorld(x, z, {
        worldWidthMeters,
        worldDepthMeters,
        sampleDrainageSignals,
      });
      if (drainage.channel < policy.sourceMinimumDrainageChannel && drainage.fine < 0.34) continue;
      const relief = localRelief(sampleHeightMeters, x, z, probe);
      const score = sourceScore(heightAboveSea, drainage, relief, policy)
        + signedHash(seed, index, 3) * 0.018;
      candidates.push(Object.freeze({
        x,
        y,
        z,
        heightAboveSeaMeters: heightAboveSea,
        localReliefMeters: relief,
        drainage,
        score,
        gridIndex: index,
      }));
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.y - a.y || a.gridIndex - b.gridIndex);
  const selected = [];
  const maximumCandidates = Math.max(target, target * policy.sourceCandidateMultiplier);
  for (const candidate of candidates) {
    if (selected.some((source) => Math.hypot(source.x - candidate.x, source.z - candidate.z) < policy.sourceMinimumSpacingMeters)) continue;
    selected.push(candidate);
    if (selected.length >= maximumCandidates) break;
  }
  return Object.freeze(selected);
}

function estimateDownhillAngle(sampleHeightMeters, x, z, probeMeters) {
  const east = sampleHeightMeters(x + probeMeters, z);
  const west = sampleHeightMeters(x - probeMeters, z);
  const south = sampleHeightMeters(x, z + probeMeters);
  const north = sampleHeightMeters(x, z - probeMeters);
  const gradientX = (east - west) / (probeMeters * 2);
  const gradientZ = (south - north) / (probeMeters * 2);
  if (Math.hypot(gradientX, gradientZ) < 1e-8) return 0;
  return Math.atan2(-gradientZ, -gradientX);
}

function nearestNetworkPoint(x, z, existingRivers, maximumDistanceMeters) {
  let best = null;
  let bestDistance = maximumDistanceMeters;
  for (let riverIndex = 0; riverIndex < existingRivers.length; riverIndex += 1) {
    const river = existingRivers[riverIndex];
    for (let pointIndex = 0; pointIndex < river.points.length; pointIndex += 1) {
      const point = river.points[pointIndex];
      const distance = Math.hypot(x - point.x, z - point.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { riverIndex, pointIndex, point, distanceMeters: distance };
      }
    }
  }
  return best;
}

function recentPointConflict(candidateX, candidateZ, points, policy) {
  const start = Math.max(0, points.length - policy.traceRecentPointRejectCount);
  for (let index = start; index < points.length - 1; index += 1) {
    const point = points[index];
    if (Math.hypot(candidateX - point.x, candidateZ - point.z) < policy.traceRecentPointRejectRadiusMeters) return true;
  }
  return false;
}

function candidateDirectionAngles(baseAngle, count, seed, riverIndex, stepIndex, escalationIndex) {
  const angles = [];
  const jitter = signedHash(seed ^ 0x464c4f57, riverIndex, stepIndex, escalationIndex) * (TAU / count) * 0.32;
  angles.push(baseAngle + jitter);
  for (let rank = 1; rank < count; rank += 1) {
    const sideRank = Math.ceil(rank / 2);
    const sign = rank % 2 === 1 ? 1 : -1;
    angles.push(baseAngle + sign * sideRank * (TAU / count) + jitter);
  }
  return angles;
}

function pathLengthMeters(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  return length;
}

function uphillFraction(points) {
  if (points.length < 2) return 0;
  let uphill = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].y > points[index - 1].y + 0.05) uphill += 1;
  }
  return uphill / (points.length - 1);
}

function widthForPoint(index, count, merged, policy) {
  const t = count <= 1 ? 0 : index / (count - 1);
  const downstream = smooth01(t);
  const mouth = merged ? policy.widthMergedMouthMeters : policy.widthMouthMeters;
  return policy.widthSourceMeters + (mouth - policy.widthSourceMeters) * downstream;
}

export function traceMajorRiverPath({
  source,
  sampleHeightMeters,
  existingRivers = [],
  seed = WORLD_DEFAULTS.WORLD_SEED,
  riverIndex = 0,
  seaLevelMeters = WORLD_DEFAULTS.WATER_LEVEL_METERS,
  worldWidthMeters = WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters = WORLD_SCALE.WORLD_DEPTH_METERS,
  sampleDrainageSignals = terrainDrainageSignals,
  policy = MAJOR_RIVER_NETWORK_POLICY,
} = {}) {
  if (!source || typeof sampleHeightMeters !== 'function') throw new TypeError('source and sampleHeightMeters are required');
  let x = finite(source.x);
  let z = finite(source.z);
  let y = finite(source.y, sampleHeightMeters(x, z));
  const points = [{ x, y, z, widthMeters: policy.widthSourceMeters }];
  let endReason = 'max-steps';
  let merge = null;
  let totalLengthMeters = 0;
  let maximumSingleStepMeters = 0;
  let escalatedStepCount = 0;

  for (let stepIndex = 0; stepIndex < policy.traceMaximumSteps; stepIndex += 1) {
    const heightAboveSea = y - seaLevelMeters;
    if (heightAboveSea <= policy.traceSeaStopHeightAboveSeaMeters) {
      endReason = 'sea';
      break;
    }
    if (!pointInsideWorld(x, z, worldWidthMeters, worldDepthMeters, policy.traceBoundsInsetMeters)) {
      endReason = 'bounds';
      break;
    }
    if (totalLengthMeters >= policy.traceMaximumLengthMeters) {
      endReason = 'max-length';
      break;
    }

    const mergeCandidate = nearestNetworkPoint(x, z, existingRivers, policy.confluenceMergeRadiusMeters);
    if (mergeCandidate && mergeCandidate.point.y <= y + policy.confluenceMaximumVerticalRiseMeters) {
      const stepLength = Math.hypot(x - mergeCandidate.point.x, z - mergeCandidate.point.z);
      if (stepLength > 1) {
        points.push({
          x: mergeCandidate.point.x,
          y: mergeCandidate.point.y,
          z: mergeCandidate.point.z,
          widthMeters: policy.widthMergedMouthMeters,
        });
        totalLengthMeters += stepLength;
      }
      merge = Object.freeze({
        intoRiverIndex: mergeCandidate.riverIndex,
        intoPointIndex: mergeCandidate.pointIndex,
        distanceMeters: mergeCandidate.distanceMeters,
      });
      endReason = 'confluence';
      break;
    }

    const downhillAngle = estimateDownhillAngle(sampleHeightMeters, x, z, policy.traceGradientProbeMeters);
    let selected = null;

    for (let escalationIndex = 0; escalationIndex < policy.traceEscalationMultipliers.length && !selected; escalationIndex += 1) {
      const stepMeters = policy.traceStepMeters * policy.traceEscalationMultipliers[escalationIndex];
      const angles = candidateDirectionAngles(
        downhillAngle,
        policy.traceDirectionCount,
        seed,
        riverIndex,
        stepIndex,
        escalationIndex,
      );
      let bestScore = -Infinity;
      for (let directionIndex = 0; directionIndex < angles.length; directionIndex += 1) {
        const angle = angles[directionIndex];
        const candidateX = x + Math.cos(angle) * stepMeters;
        const candidateZ = z + Math.sin(angle) * stepMeters;
        if (!pointInsideWorld(candidateX, candidateZ, worldWidthMeters, worldDepthMeters, policy.traceBoundsInsetMeters)) continue;
        if (recentPointConflict(candidateX, candidateZ, points, policy)) continue;
        const candidateY = finite(sampleHeightMeters(candidateX, candidateZ), y + 1000);
        const drop = y - candidateY;
        if (drop < policy.traceMinimumDropMeters && candidateY > seaLevelMeters + policy.traceSeaStopHeightAboveSeaMeters) continue;
        const drainage = sampleDrainageAtWorld(candidateX, candidateZ, {
          worldWidthMeters,
          worldDepthMeters,
          sampleDrainageSignals,
        });
        const directionAlignment = Math.cos(angle - downhillAngle) * 0.5 + 0.5;
        const nearby = nearestNetworkPoint(candidateX, candidateZ, existingRivers, policy.confluenceMergeRadiusMeters * 1.75);
        const confluenceAttraction = nearby && nearby.point.y <= y + policy.confluenceMaximumVerticalRiseMeters
          ? 1 - clamp01(nearby.distanceMeters / (policy.confluenceMergeRadiusMeters * 1.75))
          : 0;
        const score = drop * policy.traceDropWeight
          + drainage.channel * policy.traceDrainageWeightMeters
          + drainage.confluence * policy.traceDrainageWeightMeters * 0.38
          + directionAlignment * policy.traceDirectionWeightMeters
          + confluenceAttraction * policy.traceConfluenceAttractionMeters;
        if (score > bestScore) {
          bestScore = score;
          selected = {
            x: candidateX,
            y: candidateY,
            z: candidateZ,
            drainage,
            stepMeters,
            escalationIndex,
            score,
          };
        }
      }
      if (selected && escalationIndex > 0) escalatedStepCount += 1;
    }

    if (!selected) {
      endReason = 'local-minimum';
      break;
    }

    const stepLength = Math.hypot(selected.x - x, selected.z - z);
    totalLengthMeters += stepLength;
    maximumSingleStepMeters = Math.max(maximumSingleStepMeters, stepLength);
    x = selected.x;
    z = selected.z;
    y = selected.y;
    points.push({ x, y, z, widthMeters: policy.widthSourceMeters });
  }

  const merged = endReason === 'confluence';
  for (let index = 0; index < points.length; index += 1) {
    points[index].widthMeters = widthForPoint(index, points.length, merged, policy);
  }
  const lengthMeters = pathLengthMeters(points);
  const uphill = uphillFraction(points);
  return Object.freeze({
    source: Object.freeze({ x: source.x, y: source.y, z: source.z, score: source.score ?? null }),
    points: Object.freeze(points.map((point) => Object.freeze(point))),
    endReason,
    merge,
    lengthMeters,
    pointCount: points.length,
    uphillFraction: uphill,
    maximumSingleStepMeters,
    escalatedStepCount,
    accepted: points.length >= policy.minimumAcceptedPointCount
      && lengthMeters >= policy.minimumAcceptedRiverLengthMeters
      && uphill <= policy.maximumAcceptedUphillFraction,
  });
}

function checksumNetwork(rivers) {
  let hash = 2166136261;
  for (const river of rivers) {
    for (const point of river.points) {
      for (const value of [point.x, point.y, point.z, point.widthMeters]) {
        const quantized = Math.round(finite(value) * 100);
        hash ^= quantized;
        hash = Math.imul(hash, 16777619);
      }
    }
    hash ^= river.endReason.length;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function generateMajorRiverNetwork({
  sampleHeightMeters,
  seed = WORLD_DEFAULTS.WORLD_SEED,
  seaLevelMeters = WORLD_DEFAULTS.WATER_LEVEL_METERS,
  isMobileClass = false,
  worldWidthMeters = WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters = WORLD_SCALE.WORLD_DEPTH_METERS,
  sampleDrainageSignals = terrainDrainageSignals,
  policy = MAJOR_RIVER_NETWORK_POLICY,
} = {}) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const targetRiverCount = isMobileClass ? policy.mobileTargetRiverCount : policy.desktopTargetRiverCount;
  const sources = selectMajorRiverSources({
    sampleHeightMeters,
    seed,
    seaLevelMeters,
    isMobileClass,
    worldWidthMeters,
    worldDepthMeters,
    sampleDrainageSignals,
    policy,
  });
  const rivers = [];
  const rejected = [];
  for (let sourceIndex = 0; sourceIndex < sources.length && rivers.length < targetRiverCount; sourceIndex += 1) {
    const river = traceMajorRiverPath({
      source: sources[sourceIndex],
      sampleHeightMeters,
      existingRivers: rivers,
      seed,
      riverIndex: rivers.length,
      seaLevelMeters,
      worldWidthMeters,
      worldDepthMeters,
      sampleDrainageSignals,
      policy,
    });
    if (river.accepted) rivers.push(river);
    else rejected.push(river);
  }

  const totalLengthMeters = rivers.reduce((sum, river) => sum + river.lengthMeters, 0);
  const seaTerminations = rivers.filter((river) => river.endReason === 'sea').length;
  const confluenceTerminations = rivers.filter((river) => river.endReason === 'confluence').length;
  const localMinimumTerminations = rivers.filter((river) => river.endReason === 'local-minimum').length;
  const averageLengthMeters = rivers.length > 0 ? totalLengthMeters / rivers.length : 0;
  const maxLengthMeters = rivers.reduce((max, river) => Math.max(max, river.lengthMeters), 0);
  const maxUphillFraction = rivers.reduce((max, river) => Math.max(max, river.uphillFraction), 0);
  const checksum = checksumNetwork(rivers);

  return Object.freeze({
    policyId: policy.id,
    targetRiverCount,
    sourceCandidateCount: sources.length,
    rivers: Object.freeze(rivers),
    rejected: Object.freeze(rejected),
    stats: Object.freeze({
      riverCount: rivers.length,
      totalLengthMeters,
      averageLengthMeters,
      maxLengthMeters,
      seaTerminations,
      confluenceTerminations,
      localMinimumTerminations,
      maxUphillFraction,
      checksum,
    }),
  });
}

export function flattenMajorRiverNetworkPoints(network) {
  const points = [];
  for (const river of network?.rivers ?? []) {
    for (const point of river.points ?? []) points.push(point);
  }
  return points;
}

export function summarizeMajorRiverNetwork(network) {
  const stats = network?.stats ?? {};
  return Object.freeze({
    policyId: network?.policyId ?? null,
    riverCount: finite(stats.riverCount),
    totalLengthKm: finite(stats.totalLengthMeters) / 1000,
    averageLengthKm: finite(stats.averageLengthMeters) / 1000,
    longestRiverKm: finite(stats.maxLengthMeters) / 1000,
    seaTerminations: finite(stats.seaTerminations),
    confluenceTerminations: finite(stats.confluenceTerminations),
    localMinimumTerminations: finite(stats.localMinimumTerminations),
    maxUphillFraction: finite(stats.maxUphillFraction),
    checksum: finite(stats.checksum),
  });
}
