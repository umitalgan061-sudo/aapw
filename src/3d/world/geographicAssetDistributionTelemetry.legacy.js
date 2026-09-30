/*
 * Distribution telemetry for geographic asset planning.
 *
 * This module does not make placement decisions. It measures the decisions already produced by the
 * geographic context and cluster planner so visual QA can distinguish an organic distribution from a
 * hidden regular-grid or over-dense pattern. All metrics are deterministic pure calculations over the
 * supplied decision arrays.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY = Object.freeze({
  id: 'geographic-asset-distribution-telemetry-2026-09-14-v1',
  deterministic: true,
  pure: true,
  canonicalInputsOnly: true,
  minSamplesForNearestNeighbor: 6,
  nearestNeighborOutlierRatioMax: 0.42,
  familyEntropyFloor: 0.12,
  occupancyFloor: 0.08,
  occupancyCeiling: 0.92,
  mobileAcceptedCap: 12,
  desktopAcceptedCap: 28,
});

function hashString(value) {
  let h = 2166136261 >>> 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

function distance(a, b) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sortedFinite(values) {
  return values.filter(Number.isFinite).sort((a, b) => a - b);
}

function median(values) {
  const sorted = sortedFinite([...values]);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  const sorted = sortedFinite([...values]);
  if (!sorted.length) return 0;
  const index = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function standardDeviation(values) {
  return Math.sqrt(Math.max(0, variance(values)));
}

function familyCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const family = String(item?.familyId || 'unknown');
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  return counts;
}

function rejectionCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const reason = String(item?.reason || 'unknown');
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return counts;
}

function entropyFromCounts(counts, total) {
  if (!total || counts.size < 2) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  return entropy / Math.log(counts.size);
}

function bbox(items) {
  if (!items.length) return Object.freeze({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 0, depth: 0, area: 0 });
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, finiteNumber(item.x));
    maxX = Math.max(maxX, finiteNumber(item.x));
    minZ = Math.min(minZ, finiteNumber(item.z));
    maxZ = Math.max(maxZ, finiteNumber(item.z));
  }
  const width = Math.max(0, maxX - minX);
  const depth = Math.max(0, maxZ - minZ);
  return Object.freeze({ minX, maxX, minZ, maxZ, width, depth, area: width * depth });
}

function nearestNeighborDistances(items) {
  if (items.length < 2) return [];
  const distances = [];
  for (let i = 0; i < items.length; i += 1) {
    let nearest = Infinity;
    for (let j = 0; j < items.length; j += 1) {
      if (i === j) continue;
      nearest = Math.min(nearest, distance(items[i], items[j]));
    }
    if (Number.isFinite(nearest)) distances.push(nearest);
  }
  return distances;
}

function spatialOccupancy(items, cellSize = 48) {
  if (!items.length) return Object.freeze({ occupiedCells: 0, theoreticalCells: 0, occupancy: 0, cellSize });
  const size = Math.max(4, Number(cellSize) || 48);
  const bounds = bbox(items);
  const occupied = new Set();
  for (const item of items) {
    const ix = Math.floor((finiteNumber(item.x) - bounds.minX) / size);
    const iz = Math.floor((finiteNumber(item.z) - bounds.minZ) / size);
    occupied.add(`${ix}:${iz}`);
  }
  const theoretical = Math.max(1, Math.ceil(Math.max(1, bounds.width) / size) * Math.ceil(Math.max(1, bounds.depth) / size));
  return Object.freeze({
    occupiedCells: occupied.size,
    theoreticalCells: theoretical,
    occupancy: clamp01(occupied.size / theoretical),
    cellSize: size,
  });
}

function circularity(items) {
  if (items.length < 3) return 0;
  const center = {
    x: mean(items.map((item) => finiteNumber(item.x))),
    z: mean(items.map((item) => finiteNumber(item.z))),
  };
  const radii = items.map((item) => distance(item, center));
  const avg = mean(radii);
  if (avg <= 0) return 1;
  return clamp01(1 - standardDeviation(radii) / avg);
}

function directionalBias(items) {
  if (items.length < 3) return 0;
  const center = {
    x: mean(items.map((item) => finiteNumber(item.x))),
    z: mean(items.map((item) => finiteNumber(item.z))),
  };
  let sumX = 0;
  let sumZ = 0;
  for (const item of items) {
    const dx = finiteNumber(item.x) - center.x;
    const dz = finiteNumber(item.z) - center.z;
    const magnitude = Math.hypot(dx, dz) || 1;
    sumX += dx / magnitude;
    sumZ += dz / magnitude;
  }
  return clamp01(Math.hypot(sumX, sumZ) / items.length);
}

function biomeCoverage(items) {
  const counts = familyCounts(items);
  return Object.freeze({
    uniqueFamilies: counts.size,
    familyCounts: Object.freeze(Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]))),
  });
}

function summarizeReasons(items) {
  const counts = rejectionCounts(items);
  return Object.freeze(Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])));
}

function stableSignature(items) {
  return hashString(items.map((item) => `${item.familyId || ''}|${finiteNumber(item.x).toFixed(3)}|${finiteNumber(item.z).toFixed(3)}|${finiteNumber(item.scale).toFixed(4)}`).join(';'));
}

export function measureGeographicAssetDistribution(items = [], {
  cellSize = 48,
  mobile = false,
  expectedMinimumSpacing = 18,
} = {}) {
  const accepted = Array.isArray(items) ? items.filter((item) => item && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z))) : [];
  const nearest = nearestNeighborDistances(accepted);
  const bounds = bbox(accepted);
  const occupancy = spatialOccupancy(accepted, cellSize);
  const families = biomeCoverage(accepted);
  const entropy = entropyFromCounts(familyCounts(accepted), accepted.length);
  const spacingMean = mean(nearest);
  const spacingMedian = median(nearest);
  const spacingP10 = percentile(nearest, 0.10);
  const spacingP90 = percentile(nearest, 0.90);
  const spacingVariance = variance(nearest);
  const spacingOutliers = nearest.filter((value) => value < expectedMinimumSpacing * 0.55 || value > expectedMinimumSpacing * 3.6).length;
  const outlierRatio = nearest.length ? spacingOutliers / nearest.length : 0;
  const cap = mobile ? GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.mobileAcceptedCap : GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.desktopAcceptedCap;
  const capacityUse = cap > 0 ? accepted.length / cap : 0;

  return Object.freeze({
    ok: true,
    sampleCount: accepted.length,
    mobile,
    bounds,
    occupancy,
    nearestNeighbor: Object.freeze({
      count: nearest.length,
      mean: spacingMean,
      median: spacingMedian,
      p10: spacingP10,
      p90: spacingP90,
      standardDeviation: Math.sqrt(Math.max(0, spacingVariance)),
      spacingOutliers,
      outlierRatio,
      expectedMinimumSpacing,
    }),
    family: Object.freeze({
      ...families,
      entropy,
      entropyFloor: GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.familyEntropyFloor,
    }),
    shape: Object.freeze({
      radialCircularity: circularity(accepted),
      directionalBias: directionalBias(accepted),
    }),
    capacity: Object.freeze({
      cap,
      accepted: accepted.length,
      use: capacityUse,
      withinCap: accepted.length <= cap,
    }),
    signature: stableSignature(accepted),
  });
}

export function measureGeographicAssetRejections(items = []) {
  const rejected = Array.isArray(items) ? items.filter(Boolean) : [];
  const counts = rejectionCounts(rejected);
  return Object.freeze({
    total: rejected.length,
    reasons: summarizeReasons(rejected),
    uniqueReasons: counts.size,
  });
}

export function compareDistributionMeasures(first, second) {
  if (!first || !second) return Object.freeze({ ok: false, reason: 'missing-measurement' });
  const drift = {
    sampleCount: second.sampleCount - first.sampleCount,
    spacingMean: second.nearestNeighbor.mean - first.nearestNeighbor.mean,
    spacingMedian: second.nearestNeighbor.median - first.nearestNeighbor.median,
    spacingOutlierRatio: second.nearestNeighbor.outlierRatio - first.nearestNeighbor.outlierRatio,
    familyEntropy: second.family.entropy - first.family.entropy,
    occupancy: second.occupancy.occupancy - first.occupancy.occupancy,
    circularity: second.shape.radialCircularity - first.shape.radialCircularity,
    directionalBias: second.shape.directionalBias - first.shape.directionalBias,
  };
  return Object.freeze({
    ok: true,
    drift: Object.freeze(drift),
    stableSignature: first.signature === second.signature,
  });
}

export function qualifyOrganicDistribution(measurement, {
  minimumSamples = 4,
  entropyFloor = GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.familyEntropyFloor,
  outlierRatioMax = GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.nearestNeighborOutlierRatioMax,
  occupancyFloor = GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.occupancyFloor,
  occupancyCeiling = GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.occupancyCeiling,
  circularityCeiling = 0.985,
} = {}) {
  if (!measurement?.ok) return Object.freeze({ ok: false, errors: ['missing-measurement'] });
  const errors = [];
  const qualitySampleCount = Math.max(minimumSamples, GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.minSamplesForNearestNeighbor);
  if (measurement.sampleCount < minimumSamples) errors.push('insufficient-samples');
  if (measurement.sampleCount >= qualitySampleCount && measurement.nearestNeighbor.outlierRatio > outlierRatioMax) errors.push('nearest-neighbor-outlier-ratio');
  if (measurement.sampleCount >= qualitySampleCount && measurement.family.uniqueFamilies > 1 && measurement.family.entropy < entropyFloor) errors.push('family-entropy-too-low');
  if (measurement.sampleCount >= minimumSamples && measurement.occupancy.occupancy < occupancyFloor) errors.push('occupancy-too-low');
  if (measurement.sampleCount >= qualitySampleCount && measurement.occupancy.occupancy > occupancyCeiling) errors.push('occupancy-too-high');
  if (measurement.sampleCount >= qualitySampleCount && measurement.shape.radialCircularity > circularityCeiling && measurement.shape.directionalBias < 0.18) errors.push('radial-regularity-risk');
  if (!measurement.capacity.withinCap) errors.push('capacity-exceeded');
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    organic: errors.length === 0,
    qualitySampleCount,
    diagnosticsDeferred: measurement.sampleCount < qualitySampleCount,
    score: clamp01(
      1 - (
        (errors.includes('nearest-neighbor-outlier-ratio') ? 0.22 : 0) +
        (errors.includes('family-entropy-too-low') ? 0.18 : 0) +
        (errors.includes('occupancy-too-low') ? 0.16 : 0) +
        (errors.includes('occupancy-too-high') ? 0.14 : 0) +
        (errors.includes('radial-regularity-risk') ? 0.22 : 0) +
        (errors.includes('capacity-exceeded') ? 0.30 : 0)
      ),
    ),
  });
}

export function measureClusterResult(result, options = {}) {
  if (!result?.ok) return Object.freeze({ ok: false, errors: [result?.error || 'invalid-cluster'] });
  const acceptedMeasure = measureGeographicAssetDistribution(result.accepted || [], options);
  const rejectedMeasure = measureGeographicAssetRejections(result.rejected || []);
  const qualification = qualifyOrganicDistribution(acceptedMeasure, options.qualification || {});
  return Object.freeze({
    ok: true,
    accepted: acceptedMeasure,
    rejected: rejectedMeasure,
    qualification,
    plannerDigest: Number(result.digest || 0),
    plannerAttempted: Number(result.attempted || 0),
  });
}

export function aggregateDistributionTelemetry(results = []) {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const accepted = list.flatMap((result) => result.accepted || []);
  const rejected = list.flatMap((result) => result.rejected || []);
  const measure = measureGeographicAssetDistribution(accepted);
  const rejection = measureGeographicAssetRejections(rejected);
  const qualifications = list.map((result) => result.qualification?.ok === true).filter(Boolean).length;
  return Object.freeze({
    ok: true,
    clusterCount: list.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted: measure,
    rejected: rejection,
    qualifiedClusters: qualifications,
    qualificationRate: list.length ? qualifications / list.length : 0,
    signature: stableSignature(accepted),
  });
}

export function assertTelemetryDeterminism(result, replay) {
  const a = measureClusterResult(result);
  const b = measureClusterResult(replay);
  return Object.freeze({
    ok: a.accepted.signature === b.accepted.signature && a.accepted.sampleCount === b.accepted.sampleCount,
    firstSignature: a.accepted.signature,
    secondSignature: b.accepted.signature,
  });
}

export const __TEST__ = Object.freeze({
  clamp01,
  hashString,
  distance,
  finiteNumber,
  sortedFinite,
  median,
  percentile,
  mean,
  variance,
  standardDeviation,
  familyCounts,
  rejectionCounts,
  entropyFromCounts,
  bbox,
  nearestNeighborDistances,
  spatialOccupancy,
  circularity,
  directionalBias,
  stableSignature,
});
