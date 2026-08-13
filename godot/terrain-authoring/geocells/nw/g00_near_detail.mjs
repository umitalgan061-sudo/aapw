/**
 * Buzul Muhafızı / NW GeoCell G00 — Near Detail.
 *
 * GeoCell bounds are authoring/traversal addresses only. Micro-surface variation
 * is evaluated continuously in full-owner-map physical metres. The already
 * qualified G00 Relief, Rock/Snow and live Road/Path controls are preserved.
 * Runtime vegetation is admitted only on canonical land and keeps the shipped
 * road/settlement/shore exclusion distances.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G00_ROCK_SNOW_POLICY,
  measureG00RockSnow,
  sampleG00RockSnow,
} from './g00_rock_snow.mjs';
import {
  G00_ROAD_PATH_POLICY,
  measureG00RoadPath,
  sampleG00RoadPath,
  worldToNormalized,
} from './g00_road_path.mjs';

export const G00_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g00-terrain3d-near-detail-2026-08-13-v1',
  sourceMapSha256: G00_ROCK_SNOW_POLICY.sourceMapSha256,
  geoCell: 'G00', gx: 0, gy: 0, layer: 'Near Detail',
  normalizedBounds: G00_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G00_ROCK_SNOW_POLICY.maskBounds,
  sourceGridSize: 257,
  terrain3dRegionSize: 256,
  rockTextureId: G00_ROAD_PATH_POLICY.rockTextureId,
  snowTextureId: G00_ROAD_PATH_POLICY.snowTextureId,
  roadTextureId: G00_ROAD_PATH_POLICY.roadTextureId,
  pathTextureId: G00_ROAD_PATH_POLICY.pathTextureId,
  pineMeshId: 0,
  roundMeshId: 1,
  guardBandNormalized: 1 / 1536,
  detailWavelengthMeters: Object.freeze([53, 79, 97, 61, 149]),
  tintFloor: 0.90,
  tintCeiling: 1.0,
  roughnessFloor: 0.72,
  roughnessCeiling: 0.94,
  canonicalVegetationLandFloor: 0.55,
  roadDetailSuppressionFloor: 0.002,
});

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round8 = (value) => Number(value.toFixed(8));

function physicalCoordinates(normalizedX, normalizedY) {
  return {
    xMeters: normalizedX * FULL_REFERENCE_EXTENT_PLAN.widthMeters,
    zMeters: normalizedY * FULL_REFERENCE_EXTENT_PLAN.depthMeters,
  };
}

export function g00NearDetailSignal(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const { xMeters, zMeters } = physicalCoordinates(normalizedX, normalizedY);
  const a = Math.sin(TAU * (xMeters / 53 + zMeters / 79));
  const b = Math.cos(TAU * (xMeters / 97 - zMeters / 61) + 0.713);
  const c = Math.sin(TAU * ((xMeters + zMeters * 0.43) / 149) + 1.207);
  return 0.46 * a + 0.34 * b + 0.20 * c;
}

export function sampleG00NearDetail(normalizedX, normalizedY, runtimeNetwork) {
  const substrate = sampleG00RockSnow(normalizedX, normalizedY);
  const roadPath = sampleG00RoadPath(normalizedX, normalizedY, runtimeNetwork);
  const detailSignal = g00NearDetailSignal(normalizedX, normalizedY);
  const roadCoverage = Math.max(roadPath.roadCoverage, roadPath.pathCoverage);
  const detailLand = clamp01(substrate.landFactor) * (1 - clamp01(roadCoverage));
  const totalSurface = Math.max(1e-9, substrate.rockWeight + substrate.snowWeight);
  const rockRatio = detailLand > 1e-9 ? clamp01(substrate.rockWeight / totalSurface) : 0;
  const snowRatio = detailLand > 1e-9 ? clamp01(substrate.snowWeight / totalSurface) : 0;
  const tintAmplitude = detailLand * (0.010 + 0.010 * rockRatio + 0.004 * (1 - snowRatio));
  const authoredR = clamp01(0.973 + tintAmplitude * detailSignal + 0.004 * rockRatio - 0.004 * snowRatio);
  const authoredG = clamp01(0.968 + tintAmplitude * detailSignal + 0.002 * rockRatio);
  const authoredB = clamp01(0.962 + tintAmplitude * detailSignal - 0.004 * rockRatio + 0.007 * snowRatio);
  const tintR = 1 - detailLand * (1 - authoredR);
  const tintG = 1 - detailLand * (1 - authoredG);
  const tintB = 1 - detailLand * (1 - authoredB);
  const landRoughness = clamp01(0.842 + 0.045 * (1 - rockRatio) - 0.025 * snowRatio + 0.030 * detailSignal);
  const roughness = 0.90 + detailLand * (landRoughness - 0.90);
  return Object.freeze({
    ...roadPath,
    rockWeight: substrate.rockWeight,
    snowWeight: substrate.snowWeight,
    landFactor: substrate.landFactor,
    waterConfidence: substrate.waterConfidence,
    detailSignal,
    tintR: clamp01(tintR),
    tintG: clamp01(tintG),
    tintB: clamp01(tintB),
    roughness: clamp01(roughness),
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

function maxTintDelta(a, b) {
  return Math.max(
    Math.abs(a.tintR - b.tintR),
    Math.abs(a.tintG - b.tintG),
    Math.abs(a.tintB - b.tintB),
  );
}

export function measureG00NearDetailSurface(runtimeNetwork) {
  const rockSnow = measureG00RockSnow();
  const roadPath = measureG00RoadPath(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G00_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G00_NEAR_DETAIL_POLICY.sourceGridSize;
  const guard = G00_NEAR_DETAIL_POLICY.guardBandNormalized;
  let minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0;
  let maxAdjacentTintDelta = 0, maxAdjacentRoughnessDelta = 0;
  let maxGuardBandTintDelta = 0, maxGuardBandRoughnessDelta = 0;
  let maxHeightDeltaMeters = 0, maxRockWeightDelta = 0, maxSnowWeightDelta = 0;
  let maxRoadCoverageDelta = 0, maxPathCoverageDelta = 0;
  let maxCanonicalWaterTintDelta = 0, maxCanonicalWaterRoughnessDelta = 0;
  let landDetailSamples = 0, checksum = 2166136261, previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const beforeSubstrate = sampleG00RockSnow(nx, ny);
      const beforeRoadPath = sampleG00RoadPath(nx, ny, runtimeNetwork);
      const sample = sampleG00NearDetail(nx, ny, runtimeNetwork);
      minTint = Math.min(minTint, sample.tintR, sample.tintG, sample.tintB);
      maxTint = Math.max(maxTint, sample.tintR, sample.tintG, sample.tintB);
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(sample.heightMeters - beforeRoadPath.heightMeters));
      maxRockWeightDelta = Math.max(maxRockWeightDelta, Math.abs(sample.rockWeight - beforeSubstrate.rockWeight));
      maxSnowWeightDelta = Math.max(maxSnowWeightDelta, Math.abs(sample.snowWeight - beforeSubstrate.snowWeight));
      maxRoadCoverageDelta = Math.max(maxRoadCoverageDelta, Math.abs(sample.roadCoverage - beforeRoadPath.roadCoverage));
      maxPathCoverageDelta = Math.max(maxPathCoverageDelta, Math.abs(sample.pathCoverage - beforeRoadPath.pathCoverage));
      const corridor = Math.max(sample.roadCoverage, sample.pathCoverage);
      if (sample.landFactor > 0.05 && corridor < 0.05
        && Math.max(Math.abs(sample.tintR - 1), Math.abs(sample.tintG - 1), Math.abs(sample.tintB - 1)) > 0.0001) {
        landDetailSamples += 1;
      }
      if (x > 0) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(sample, row[x - 1]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - row[x - 1].roughness));
      }
      if (previousRow) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(sample, previousRow[x]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - previousRow[x].roughness));
      }
      for (const value of [sample.tintR, sample.tintG, sample.tintB, sample.roughness]) checksum = fnv1a(checksum, Math.round(value * 255));
      row.push(sample);
    }
    previousRow = row;
  }

  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = xMin + (xMax - xMin) * t;
    const ny = yMin + (yMax - yMin) * t;
    const pairs = [
      [sampleG00NearDetail(nx, yMin, runtimeNetwork), sampleG00NearDetail(nx, yMin - guard, runtimeNetwork)],
      [sampleG00NearDetail(nx, yMax, runtimeNetwork), sampleG00NearDetail(nx, yMax + guard, runtimeNetwork)],
      [sampleG00NearDetail(xMin, ny, runtimeNetwork), sampleG00NearDetail(xMin - guard, ny, runtimeNetwork)],
      [sampleG00NearDetail(xMax, ny, runtimeNetwork), sampleG00NearDetail(xMax + guard, ny, runtimeNetwork)],
    ];
    for (const [a, b] of pairs) {
      maxGuardBandTintDelta = Math.max(maxGuardBandTintDelta, maxTintDelta(a, b));
      maxGuardBandRoughnessDelta = Math.max(maxGuardBandRoughnessDelta, Math.abs(a.roughness - b.roughness));
    }
  }

  const mask = G00_NEAR_DETAIL_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const nx = (x + 0.5) / 96;
      const ny = (y + 0.5) / 64;
      const substrate = sampleG00RockSnow(nx, ny);
      const sample = sampleG00NearDetail(nx, ny, runtimeNetwork);
      if (substrate.waterConfidence < 0.999999) continue;
      maxCanonicalWaterTintDelta = Math.max(maxCanonicalWaterTintDelta, Math.abs(sample.tintR - 1), Math.abs(sample.tintG - 1), Math.abs(sample.tintB - 1));
      maxCanonicalWaterRoughnessDelta = Math.max(maxCanonicalWaterRoughnessDelta, Math.abs(sample.roughness - 0.90));
    }
  }

  return Object.freeze({
    policyId: G00_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G00_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: 'G00', layer: 'Near Detail', sourceGridSize: size, sourceSamples: size * size,
    terrain3dRegionSize: G00_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: rockSnow.hydrologyFingerprint,
    roadPathFingerprint: Object.freeze({
      crossingEdges: roadPath.crossingEdges,
      activeRoadSamples: roadPath.activeRoadSamples,
      activePathSamples: roadPath.activePathSamples,
      coverageChecksum: roadPath.coverageChecksum,
      maxCanonicalWaterCoverageOutsideSettlement: roadPath.maxCanonicalWaterCoverageOutsideSettlement,
    }),
    landDetailSamples,
    minTint: round8(minTint), maxTint: round8(maxTint),
    minRoughness: round8(minRoughness), maxRoughness: round8(maxRoughness),
    maxAdjacentTintDelta: round8(maxAdjacentTintDelta),
    maxAdjacentRoughnessDelta: round8(maxAdjacentRoughnessDelta),
    maxGuardBandTintDelta: round8(maxGuardBandTintDelta),
    maxGuardBandRoughnessDelta: round8(maxGuardBandRoughnessDelta),
    maxHeightDeltaMeters: round8(maxHeightDeltaMeters),
    maxRockWeightDelta: round8(maxRockWeightDelta),
    maxSnowWeightDelta: round8(maxSnowWeightDelta),
    maxRoadCoverageDelta: round8(maxRoadCoverageDelta),
    maxPathCoverageDelta: round8(maxPathCoverageDelta),
    maxCanonicalWaterTintDelta: round8(maxCanonicalWaterTintDelta),
    maxCanonicalWaterRoughnessDelta: round8(maxCanonicalWaterRoughnessDelta),
    detailChecksum: checksum,
  });
}

function safeWorldToNormalized(instance, runtime) {
  try {
    return worldToNormalized(instance.x, instance.z, runtime.mapBounds, runtime.metersPerMapUnit);
  } catch (error) {
    if (error instanceof RangeError && /map[XY] outside 2D map canvas/.test(error.message)) return null;
    throw error;
  }
}

export function collectG00RuntimeVegetation(runtime) {
  const bounds = G00_NEAR_DETAIL_POLICY.normalizedBounds;
  const guard = G00_NEAR_DETAIL_POLICY.guardBandNormalized;
  const accepted = [];
  let rejectedCanonicalWaterInstances = 0;
  let outsideOwnerMapInstances = 0;
  let rawCoreInstances = 0;
  for (const instance of runtime.instances ?? []) {
    const normalized = safeWorldToNormalized(instance, runtime);
    if (!normalized) {
      outsideOwnerMapInstances += 1;
      continue;
    }
    const inGuard = normalized.x >= bounds.xMin - guard && normalized.x <= bounds.xMax + guard
      && normalized.y >= bounds.yMin - guard && normalized.y <= bounds.yMax + guard;
    if (!inGuard) continue;
    const core = normalized.x >= bounds.xMin && normalized.x <= bounds.xMax
      && normalized.y >= bounds.yMin && normalized.y <= bounds.yMax;
    if (core) rawCoreInstances += 1;
    const canonical = sampleG00RockSnow(normalized.x, normalized.y);
    if (canonical.landFactor < G00_NEAR_DETAIL_POLICY.canonicalVegetationLandFloor) {
      if (core) rejectedCanonicalWaterInstances += 1;
      continue;
    }
    accepted.push(Object.freeze({
      species: instance.species,
      normalizedX: normalized.x,
      normalizedY: normalized.y,
      localX: (normalized.x - bounds.xMin) / (bounds.xMax - bounds.xMin) * 255,
      localZ: (normalized.y - bounds.yMin) / (bounds.yMax - bounds.yMin) * 255,
      runtimeY: instance.y,
      yaw: instance.yaw,
      scale: instance.scale,
      roadDistanceMeters: instance.roadDistanceMeters,
      seatDistanceMeters: instance.seatDistanceMeters,
      heightAboveWaterMeters: instance.y - runtime.waterLevelMeters,
      canonicalLandFactor: canonical.landFactor,
      core,
    }));
  }
  return Object.freeze({ accepted, rawCoreInstances, rejectedCanonicalWaterInstances, outsideOwnerMapInstances });
}

export function measureG00RuntimeVegetation(runtime) {
  const collected = collectG00RuntimeVegetation(runtime);
  let coreInstanceCount = 0, guardOnlyCount = 0, pine = 0, round = 0;
  let minRoadDistanceMeters = Infinity, minSeatDistanceMeters = Infinity, minHeightAboveWaterMeters = Infinity;
  let minCanonicalLandFactor = Infinity, checksum = 2166136261;
  for (const instance of collected.accepted) {
    if (instance.core) {
      coreInstanceCount += 1;
      if (instance.species === 'pine') pine += 1;
      else if (instance.species === 'round') round += 1;
      minRoadDistanceMeters = Math.min(minRoadDistanceMeters, instance.roadDistanceMeters);
      minSeatDistanceMeters = Math.min(minSeatDistanceMeters, instance.seatDistanceMeters);
      minHeightAboveWaterMeters = Math.min(minHeightAboveWaterMeters, instance.heightAboveWaterMeters);
      minCanonicalLandFactor = Math.min(minCanonicalLandFactor, instance.canonicalLandFactor);
    } else guardOnlyCount += 1;
    for (const value of [instance.localX, instance.localZ, instance.yaw, instance.scale]) {
      const q = Math.round(value * 1000);
      for (const shift of [0, 8, 16, 24]) checksum = fnv1a(checksum, q >> shift);
    }
    checksum = fnv1a(checksum, instance.species === 'pine' ? 0 : 1);
  }
  const finiteOrNull = (value) => Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  return Object.freeze({
    runtimeRadiusMeters: runtime.radiusMeters,
    runtimeTargetCount: runtime.targetCount,
    runtimePlacedCount: runtime.placedCount,
    outsideOwnerMapInstances: collected.outsideOwnerMapInstances,
    rawCoreInstances: collected.rawCoreInstances,
    rejectedCanonicalWaterInstances: collected.rejectedCanonicalWaterInstances,
    acceptedGuardInstances: collected.accepted.length,
    coreInstanceCount,
    guardOnlyCount,
    speciesCounts: Object.freeze({ pine, round }),
    minRoadDistanceMeters: finiteOrNull(minRoadDistanceMeters),
    minSeatDistanceMeters: finiteOrNull(minSeatDistanceMeters),
    minHeightAboveWaterMeters: finiteOrNull(minHeightAboveWaterMeters),
    minCanonicalLandFactor: finiteOrNull(minCanonicalLandFactor),
    instanceChecksum: checksum,
  });
}

export function buildG00NearDetailProbe(runtime) {
  const surface = measureG00NearDetailSurface(runtime);
  const vegetation = measureG00RuntimeVegetation(runtime);
  const bounds = G00_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G00_NEAR_DETAIL_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG00NearDetail(nx, ny, runtime);
      row.push([
        Number(sample.roadCoverage.toFixed(8)),
        Number(sample.pathCoverage.toFixed(8)),
        sample.kind,
        Number(sample.heightMeters.toFixed(6)),
        Number(sample.substrateSnowWeight.toFixed(8)),
        Number(sample.substrateSnowBlend.toFixed(8)),
        Number(sample.substrateLandFactor.toFixed(8)),
        Number(sample.tintR.toFixed(8)),
        Number(sample.tintG.toFixed(8)),
        Number(sample.tintB.toFixed(8)),
        Number(sample.roughness.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  const instances = collectG00RuntimeVegetation(runtime).accepted.map((instance) => ({
    species: instance.species,
    normalizedX: Number(instance.normalizedX.toFixed(8)),
    normalizedY: Number(instance.normalizedY.toFixed(8)),
    localX: Number(instance.localX.toFixed(6)),
    localZ: Number(instance.localZ.toFixed(6)),
    runtimeY: Number(instance.runtimeY.toFixed(6)),
    yaw: Number(instance.yaw.toFixed(8)),
    scale: Number(instance.scale.toFixed(8)),
    core: instance.core,
  }));
  return Object.freeze({
    ...surface,
    vegetation,
    rockTextureId: G00_NEAR_DETAIL_POLICY.rockTextureId,
    snowTextureId: G00_NEAR_DETAIL_POLICY.snowTextureId,
    roadTextureId: G00_NEAR_DETAIL_POLICY.roadTextureId,
    pathTextureId: G00_NEAR_DETAIL_POLICY.pathTextureId,
    pineMeshId: G00_NEAR_DETAIL_POLICY.pineMeshId,
    roundMeshId: G00_NEAR_DETAIL_POLICY.roundMeshId,
    rows,
    instances,
  });
}
