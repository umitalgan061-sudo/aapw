/**
 * Şafak Kartalı / NE GeoCell G52 — Near Detail.
 *
 * GeoCell bounds are traversal/addressing only. Surface micro variation is a
 * continuous full-owner-map function expressed in physical metres. Runtime
 * vegetation is accepted only where the canonical G52 land field agrees.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G52_ROCK_SNOW_POLICY,
  measureG52RockSnow,
  sampleG52RockSnow,
} from './g52_rock_snow.mjs';
import { worldToNormalized } from './g52_road_path.mjs';

export const G52_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'safak-kartali-g52-terrain3d-near-detail-2026-08-13-v1',
  sourceMapSha256: G52_ROCK_SNOW_POLICY.sourceMapSha256,
  geoCell: 'G52', gx: 5, gy: 2, layer: 'Near Detail',
  normalizedBounds: G52_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G52_ROCK_SNOW_POLICY.maskBounds,
  sourceGridSize: 129,
  terrain3dRegionSize: 256,
  rockTextureId: 0,
  snowTextureId: 1,
  pineMeshId: 0,
  roundMeshId: 1,
  guardBandNormalized: 1 / 1536,
  detailWavelengthMeters: Object.freeze([53, 79, 97, 61, 149]),
  tintFloor: 0.90,
  tintCeiling: 1.0,
  roughnessFloor: 0.72,
  roughnessCeiling: 0.94,
  canonicalVegetationLandFloor: 0.55,
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

export function g52NearDetailSignal(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const { xMeters, zMeters } = physicalCoordinates(normalizedX, normalizedY);
  const a = Math.sin(TAU * (xMeters / 53 + zMeters / 79));
  const b = Math.cos(TAU * (xMeters / 97 - zMeters / 61) + 0.713);
  const c = Math.sin(TAU * ((xMeters + zMeters * 0.43) / 149) + 1.207);
  return 0.46 * a + 0.34 * b + 0.20 * c;
}

export function sampleG52NearDetail(normalizedX, normalizedY) {
  const base = sampleG52RockSnow(normalizedX, normalizedY);
  const detailSignal = g52NearDetailSignal(normalizedX, normalizedY);
  const land = clamp01(base.landFactor);
  const totalSurface = Math.max(1e-9, base.rockWeight + base.snowWeight);
  const rockRatio = land > 1e-9 ? clamp01(base.rockWeight / totalSurface) : 0;
  const snowRatio = land > 1e-9 ? clamp01(base.snowWeight / totalSurface) : 0;
  const tintAmplitude = land * (0.010 + 0.010 * rockRatio + 0.004 * (1 - snowRatio));
  const authoredR = clamp01(0.973 + tintAmplitude * detailSignal + 0.004 * rockRatio - 0.004 * snowRatio);
  const authoredG = clamp01(0.968 + tintAmplitude * detailSignal + 0.002 * rockRatio);
  const authoredB = clamp01(0.962 + tintAmplitude * detailSignal - 0.004 * rockRatio + 0.007 * snowRatio);
  const tintR = 1 - land * (1 - authoredR);
  const tintG = 1 - land * (1 - authoredG);
  const tintB = 1 - land * (1 - authoredB);
  const landRoughness = clamp01(0.842 + 0.045 * (1 - rockRatio) - 0.025 * snowRatio + 0.030 * detailSignal);
  const roughness = 0.90 + land * (landRoughness - 0.90);
  return Object.freeze({
    ...base,
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

export function measureG52NearDetailSurface() {
  const rockSnow = measureG52RockSnow();
  const { xMin, xMax, yMin, yMax } = G52_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G52_NEAR_DETAIL_POLICY.sourceGridSize;
  const guard = G52_NEAR_DETAIL_POLICY.guardBandNormalized;
  let minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0;
  let maxAdjacentTintDelta = 0, maxAdjacentRoughnessDelta = 0;
  let maxGuardBandTintDelta = 0, maxGuardBandRoughnessDelta = 0;
  let maxHeightDeltaMeters = 0, maxRockWeightDelta = 0, maxSnowWeightDelta = 0;
  let maxCanonicalWaterTintDelta = 0, maxCanonicalWaterRoughnessDelta = 0;
  let landDetailSamples = 0, checksum = 2166136261, previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const before = sampleG52RockSnow(nx, ny);
      const sample = sampleG52NearDetail(nx, ny);
      minTint = Math.min(minTint, sample.tintR, sample.tintG, sample.tintB);
      maxTint = Math.max(maxTint, sample.tintR, sample.tintG, sample.tintB);
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(sample.heightMeters - before.heightMeters));
      maxRockWeightDelta = Math.max(maxRockWeightDelta, Math.abs(sample.rockWeight - before.rockWeight));
      maxSnowWeightDelta = Math.max(maxSnowWeightDelta, Math.abs(sample.snowWeight - before.snowWeight));
      if (sample.landFactor > 0.05 && Math.max(Math.abs(sample.tintR - 1), Math.abs(sample.tintG - 1), Math.abs(sample.tintB - 1)) > 0.0001) landDetailSamples += 1;
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
      [sampleG52NearDetail(nx, yMin), sampleG52NearDetail(nx, yMin - guard)],
      [sampleG52NearDetail(nx, yMax), sampleG52NearDetail(nx, yMax + guard)],
      [sampleG52NearDetail(xMin, ny), sampleG52NearDetail(xMin - guard, ny)],
      [sampleG52NearDetail(xMax, ny), sampleG52NearDetail(xMax + guard, ny)],
    ];
    for (const [a, b] of pairs) {
      maxGuardBandTintDelta = Math.max(maxGuardBandTintDelta, maxTintDelta(a, b));
      maxGuardBandRoughnessDelta = Math.max(maxGuardBandRoughnessDelta, Math.abs(a.roughness - b.roughness));
    }
  }

  const mask = G52_NEAR_DETAIL_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const sample = sampleG52NearDetail((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.waterConfidence < 0.999999) continue;
      maxCanonicalWaterTintDelta = Math.max(maxCanonicalWaterTintDelta, Math.abs(sample.tintR - 1), Math.abs(sample.tintG - 1), Math.abs(sample.tintB - 1));
      maxCanonicalWaterRoughnessDelta = Math.max(maxCanonicalWaterRoughnessDelta, Math.abs(sample.roughness - 0.90));
    }
  }

  return Object.freeze({
    policyId: G52_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G52_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: 'G52', layer: 'Near Detail', sourceGridSize: size, sourceSamples: size * size,
    terrain3dRegionSize: G52_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: rockSnow.hydrologyFingerprint,
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
    maxCanonicalWaterTintDelta: round8(maxCanonicalWaterTintDelta),
    maxCanonicalWaterRoughnessDelta: round8(maxCanonicalWaterRoughnessDelta),
    detailChecksum: checksum,
  });
}

export function collectG52RuntimeVegetation(runtime) {
  const bounds = G52_NEAR_DETAIL_POLICY.normalizedBounds;
  const guard = G52_NEAR_DETAIL_POLICY.guardBandNormalized;
  const accepted = [];
  let rejectedCanonicalWaterInstances = 0;
  let rawCoreInstances = 0;
  for (const instance of runtime.instances ?? []) {
    const normalized = worldToNormalized(instance.x, instance.z, runtime.mapBounds, runtime.metersPerMapUnit);
    const inGuard = normalized.x >= bounds.xMin - guard && normalized.x <= bounds.xMax + guard && normalized.y >= bounds.yMin - guard && normalized.y <= bounds.yMax + guard;
    if (!inGuard) continue;
    const core = normalized.x >= bounds.xMin && normalized.x <= bounds.xMax && normalized.y >= bounds.yMin && normalized.y <= bounds.yMax;
    if (core) rawCoreInstances += 1;
    const canonical = sampleG52RockSnow(normalized.x, normalized.y);
    if (canonical.landFactor < G52_NEAR_DETAIL_POLICY.canonicalVegetationLandFloor) {
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
  return Object.freeze({ accepted, rawCoreInstances, rejectedCanonicalWaterInstances });
}

export function measureG52RuntimeVegetation(runtime) {
  const collected = collectG52RuntimeVegetation(runtime);
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

export function buildG52NearDetailProbe(runtime) {
  const surface = measureG52NearDetailSurface();
  const vegetation = measureG52RuntimeVegetation(runtime);
  const bounds = G52_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G52_NEAR_DETAIL_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG52NearDetail(nx, ny);
      row.push([
        Number(sample.rockWeight.toFixed(8)),
        Number(sample.snowWeight.toFixed(8)),
        Number(sample.heightMeters.toFixed(6)),
        Number(sample.tintR.toFixed(8)),
        Number(sample.tintG.toFixed(8)),
        Number(sample.tintB.toFixed(8)),
        Number(sample.roughness.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  const instances = collectG52RuntimeVegetation(runtime).accepted.map((instance) => ({
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
    rockTextureId: G52_NEAR_DETAIL_POLICY.rockTextureId,
    snowTextureId: G52_NEAR_DETAIL_POLICY.snowTextureId,
    pineMeshId: G52_NEAR_DETAIL_POLICY.pineMeshId,
    roundMeshId: G52_NEAR_DETAIL_POLICY.roundMeshId,
    rows,
    instances,
  });
}
