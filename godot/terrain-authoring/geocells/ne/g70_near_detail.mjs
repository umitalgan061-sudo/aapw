/**
 * Şafak Kartalı / NE GeoCell G70 — Near Detail through pinned Terrain3D.
 *
 * G70 is canonical open sea. Near Detail therefore enriches only the submerged
 * authored surface's Color/Roughness channels. Relief height, Rock/Snow control,
 * Road/Path coverage and coastline semantics remain byte-for-byte equivalent in
 * meaning. The procedural phase is anchored in full-reference metres, never in
 * GeoCell coordinates, so west/south boundaries cannot expose a square tile.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G70_TERRAIN3D_ROAD_PATH_POLICY,
  sampleG70RoadPath,
} from './g70_road_path.mjs';

export const G70_TERRAIN3D_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-near-detail-2026-08-14-v1',
  sourceMapSha256: G70_TERRAIN3D_ROAD_PATH_POLICY.sourceMapSha256,
  roadPathPolicyId: G70_TERRAIN3D_ROAD_PATH_POLICY.id,
  geoCell: 'G70', gx: 7, gy: 0, layer: 'Near Detail',
  normalizedBounds: G70_TERRAIN3D_ROAD_PATH_POLICY.normalizedBounds,
  guardBandNormalized: G70_TERRAIN3D_ROAD_PATH_POLICY.guardBandNormalized,
  sourceGridSize: 129,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  overlayTextureId: 1,
  microWavelengthMeters: Object.freeze([47, 71, 109, 163]),
  tintFloor: 0.925,
  tintCeiling: 0.995,
  roughnessFloor: 0.79,
  roughnessCeiling: 0.95,
  foliageDensity: 0,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round8 = (value) => Number(value.toFixed(8));
const TAU = Math.PI * 2;

function physicalCoordinates(nx, ny) {
  return Object.freeze({
    xMeters: (nx - 0.5) * FULL_REFERENCE_EXTENT_PLAN.widthMeters,
    zMeters: (ny - 0.5) * FULL_REFERENCE_EXTENT_PLAN.depthMeters,
  });
}

/** Continuous global-metre marine detail phase. No grid/cell/Pindex term. */
export function g70NearDetailSignal(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const { xMeters, zMeters } = physicalCoordinates(nx, ny);
  const w = G70_TERRAIN3D_NEAR_DETAIL_POLICY.microWavelengthMeters;
  const a = Math.sin(TAU * (xMeters / w[0] + zMeters / w[1]));
  const b = Math.cos(TAU * (xMeters / w[2] - zMeters / w[3]));
  const c = Math.sin(TAU * ((xMeters + 0.37 * zMeters) / 233));
  return Math.max(-1, Math.min(1, 0.48 * a + 0.34 * b + 0.18 * c));
}

export function sampleG70NearDetail(nx, ny) {
  const base = sampleG70RoadPath(nx, ny);
  if (!base.water || base.body !== 'sea') throw new Error(`G70 Near Detail requires canonical sea at ${nx},${ny}`);
  if (base.coverage !== 0 || base.roadPathControlBlend !== 0) throw new Error(`G70 Near Detail cannot author over a road/path corridor at ${nx},${ny}`);
  const signal = g70NearDetailSignal(nx, ny);
  const basin = clamp01((-base.heightMeters - 4.0) / 8.0);
  const amplitude = 0.010 + 0.012 * basin;
  const tintR = clamp01(0.966 + amplitude * signal);
  const tintG = clamp01(0.974 + amplitude * signal * 0.82);
  const tintB = clamp01(0.982 + amplitude * signal * 0.55);
  const roughness = clamp01(0.872 + 0.050 * signal + 0.018 * basin);
  return Object.freeze({
    ...base,
    detailSignal: signal,
    tintR,
    tintG,
    tintB,
    roughness,
    foliageDensity: 0,
  });
}

function maxTintDelta(a, b) {
  return Math.max(
    Math.abs(a.tintR - b.tintR),
    Math.abs(a.tintG - b.tintG),
    Math.abs(a.tintB - b.tintB),
  );
}

function hashByte(checksum, value) {
  return Math.imul((checksum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}

export function measureG70Terrain3DNearDetail() {
  const p = G70_TERRAIN3D_NEAR_DETAIL_POLICY;
  const b = p.normalizedBounds;
  const size = p.sourceGridSize;
  const guard = p.guardBandNormalized;
  let canonicalWaterCells = 0, canonicalLandCells = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 84; x < 96; x += 1) {
    sampleG70NearDetail((x + 0.5) / 96, (y + 0.5) / 64).water ? canonicalWaterCells++ : canonicalLandCells++;
  }
  let minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0;
  let minSignal = 1, maxSignal = -1, maxAdjacentTintDelta = 0, maxAdjacentRoughnessDelta = 0;
  let maxGuardTintDelta = 0, maxGuardRoughnessDelta = 0;
  let maxHeightDelta = 0, maxControlDelta = 0, maxRoadPathDelta = 0, maxFoliageDensity = 0;
  let checksum = 2166136261, previousRow = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1);
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1);
      const before = sampleG70RoadPath(nx, ny);
      const s = sampleG70NearDetail(nx, ny);
      minTint = Math.min(minTint, s.tintR, s.tintG, s.tintB); maxTint = Math.max(maxTint, s.tintR, s.tintG, s.tintB);
      minRoughness = Math.min(minRoughness, s.roughness); maxRoughness = Math.max(maxRoughness, s.roughness);
      minSignal = Math.min(minSignal, s.detailSignal); maxSignal = Math.max(maxSignal, s.detailSignal);
      maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - before.authoredHeight));
      maxControlDelta = Math.max(maxControlDelta, Math.abs(s.controlBlend - before.controlBlend), Math.abs(s.rockWeight - before.rockWeight), Math.abs(s.snowWeight - before.snowWeight));
      maxRoadPathDelta = Math.max(maxRoadPathDelta, Math.abs(s.coverage - before.coverage), Math.abs(s.roadPathControlBlend - before.roadPathControlBlend));
      maxFoliageDensity = Math.max(maxFoliageDensity, Math.abs(s.foliageDensity));
      if (x) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(s, row[x - 1]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(s.roughness - row[x - 1].roughness));
      }
      if (previousRow) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(s, previousRow[x]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(s.roughness - previousRow[x].roughness));
      }
      for (const value of [s.tintR, s.tintG, s.tintB, s.roughness]) checksum = hashByte(checksum, Math.round(clamp01(value) * 255));
      row.push(s);
    }
    previousRow = row;
  }
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = b.xMin + (b.xMax - b.xMin) * t;
    const ny = b.yMin + (b.yMax - b.yMin) * t;
    for (const [a, c] of [
      [sampleG70NearDetail(b.xMin, ny), sampleG70NearDetail(b.xMin - guard, ny)],
      [sampleG70NearDetail(nx, b.yMax), sampleG70NearDetail(nx, b.yMax + guard)],
    ]) {
      maxGuardTintDelta = Math.max(maxGuardTintDelta, maxTintDelta(a, c));
      maxGuardRoughnessDelta = Math.max(maxGuardRoughnessDelta, Math.abs(a.roughness - c.roughness));
    }
  }
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, roadPathPolicyId: p.roadPathPolicyId,
    geoCell: p.geoCell, layer: p.layer, sourceGridSize: size, sourceSamples: size * size,
    canonicalWaterCells, canonicalLandCells,
    minTint: round8(minTint), maxTint: round8(maxTint), minRoughness: round8(minRoughness), maxRoughness: round8(maxRoughness),
    minSignal: round8(minSignal), maxSignal: round8(maxSignal),
    maxAdjacentTintDelta: round8(maxAdjacentTintDelta), maxAdjacentRoughnessDelta: round8(maxAdjacentRoughnessDelta),
    maxGuardTintDelta: round8(maxGuardTintDelta), maxGuardRoughnessDelta: round8(maxGuardRoughnessDelta),
    maxHeightDelta: round8(maxHeightDelta), maxControlDelta: round8(maxControlDelta), maxRoadPathDelta: round8(maxRoadPathDelta),
    maxFoliageDensity: round8(maxFoliageDensity), detailChecksum: checksum >>> 0,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
  });
}

export function buildG70Terrain3DNearDetailProbe() {
  const p = G70_TERRAIN3D_NEAR_DETAIL_POLICY;
  const b = p.normalizedBounds;
  const rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1);
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1);
      const s = sampleG70NearDetail(nx, ny);
      row.push([
        Number(s.authoredHeight.toFixed(6)),
        Number(s.controlBlend.toFixed(8)),
        Number(s.tintR.toFixed(8)), Number(s.tintG.toFixed(8)), Number(s.tintB.toFixed(8)),
        Number(s.roughness.toFixed(8)), s.water ? 1 : 0, s.foliageDensity,
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: 'westeros-g70-terrain3d-near-detail-probe-v1',
    ...measureG70Terrain3DNearDetail(),
    baseTextureId: p.baseTextureId, overlayTextureId: p.overlayTextureId,
    rows,
  });
}
