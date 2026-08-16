/**
 * Şafak Kartalı / NE G71 — Near Detail through pinned Terrain3D.
 * Canonical G71 is 96/96 open sea. This layer changes only continuous marine
 * Color/Roughness detail in global physical metres. Height, control, Road/Path
 * and foliage remain unchanged; east of normalized x=1 remains out of world.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { G71_TERRAIN3D_ROAD_PATH_POLICY, sampleG71RoadPath } from './g71_road_path.mjs';

export const G71_TERRAIN3D_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'safak-kartali-g71-terrain3d-near-detail-2026-08-16-v1',
  sourceMapSha256: G71_TERRAIN3D_ROAD_PATH_POLICY.sourceMapSha256,
  roadPathPolicyId: G71_TERRAIN3D_ROAD_PATH_POLICY.id,
  geoCell: 'G71', gx: 7, gy: 1, layer: 'Near Detail',
  normalizedBounds: G71_TERRAIN3D_ROAD_PATH_POLICY.normalizedBounds,
  guardNormalized: G71_TERRAIN3D_ROAD_PATH_POLICY.guardNormalized,
  sourceGridSize: 129,
  denseEnvelopeSize: 193,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: G71_TERRAIN3D_ROAD_PATH_POLICY.baseTextureId,
  overlayTextureId: G71_TERRAIN3D_ROAD_PATH_POLICY.substrateOverlayTextureId,
  microWavelengthMeters: Object.freeze([47, 71, 109, 163]),
  tintFloor: 0.925,
  tintCeiling: 0.995,
  roughnessFloor: 0.79,
  roughnessCeiling: 0.95,
  foliageDensity: 0,
  eastWorldBoundaryX: 1,
  eastGuardAllowed: false,
});

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round8 = (value) => Number(value.toFixed(8));
const tintDelta = (a, b) => Math.max(
  Math.abs(a.tintR - b.tintR), Math.abs(a.tintG - b.tintG), Math.abs(a.tintB - b.tintB),
);

function physicalCoordinates(nx, ny) {
  return Object.freeze({
    xMeters: (nx - 0.5) * FULL_REFERENCE_EXTENT_PLAN.widthMeters,
    zMeters: (ny - 0.5) * FULL_REFERENCE_EXTENT_PLAN.depthMeters,
  });
}

/** Global physical-metre phase: no GeoCell/Pindex/grid term. */
export function g71NearDetailSignal(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const { xMeters, zMeters } = physicalCoordinates(nx, ny);
  const w = G71_TERRAIN3D_NEAR_DETAIL_POLICY.microWavelengthMeters;
  const a = Math.sin(TAU * (xMeters / w[0] + zMeters / w[1]));
  const b = Math.cos(TAU * (xMeters / w[2] - zMeters / w[3]));
  const c = Math.sin(TAU * ((xMeters + 0.37 * zMeters) / 233));
  return Math.max(-1, Math.min(1, 0.48 * a + 0.34 * b + 0.18 * c));
}

export function sampleG71NearDetail(nx, ny) {
  const base = sampleG71RoadPath(nx, ny);
  if (!base.water || base.body !== 'sea') throw new Error(`G71 Near Detail requires canonical sea at ${nx},${ny}`);
  if (base.coverage !== 0 || base.roadPathControlBlend !== 0) throw new Error(`G71 Near Detail cannot author over Road/Path at ${nx},${ny}`);
  const detailSignal = g71NearDetailSignal(nx, ny);
  const basin = clamp01((-base.authoredHeight - 4.0) / 8.0);
  const amplitude = 0.010 + 0.012 * basin;
  return Object.freeze({
    ...base,
    detailSignal,
    tintR: clamp01(0.966 + amplitude * detailSignal),
    tintG: clamp01(0.974 + amplitude * detailSignal * 0.82),
    tintB: clamp01(0.982 + amplitude * detailSignal * 0.55),
    roughness: clamp01(0.872 + 0.050 * detailSignal + 0.018 * basin),
    macroColor: base.color,
    macroRoughness: base.roughness,
    foliageDensity: 0,
  });
}

function hashByte(checksum, value) {
  return Math.imul((checksum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}

export function g71NearDetailGuardBounds() {
  const p = G71_TERRAIN3D_NEAR_DETAIL_POLICY, b = p.normalizedBounds, g = p.guardNormalized;
  return Object.freeze({ xMin: b.xMin - g, xMax: 1, yMin: b.yMin - g, yMax: b.yMax + g });
}

export function measureG71Terrain3DNearDetail() {
  const p = G71_TERRAIN3D_NEAR_DETAIL_POLICY, b = p.normalizedBounds, size = p.sourceGridSize;
  let canonicalWaterCells = 0, canonicalLandCells = 0;
  for (let y = 8; y < 16; y += 1) for (let x = 84; x < 96; x += 1) {
    sampleG71NearDetail((x + 0.5) / 96, (y + 0.5) / 64).water ? canonicalWaterCells++ : canonicalLandCells++;
  }
  let minSignal = 1, maxSignal = -1, minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0;
  let maxAdjacentTintDelta = 0, maxAdjacentRoughnessDelta = 0;
  let maxHeightDelta = 0, maxControlDelta = 0, maxRoadPathDelta = 0, maxFoliageDensity = 0, maxMacroColorDelta = 0;
  let checksum = 2166136261, previous = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1);
      const before = sampleG71RoadPath(nx, ny), s = sampleG71NearDetail(nx, ny);
      minSignal = Math.min(minSignal, s.detailSignal); maxSignal = Math.max(maxSignal, s.detailSignal);
      minTint = Math.min(minTint, s.tintR, s.tintG, s.tintB); maxTint = Math.max(maxTint, s.tintR, s.tintG, s.tintB);
      minRoughness = Math.min(minRoughness, s.roughness); maxRoughness = Math.max(maxRoughness, s.roughness);
      maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - before.authoredHeight));
      maxControlDelta = Math.max(maxControlDelta, Math.abs(s.controlBlend - before.controlBlend), Math.abs(s.rockWeight - before.rockWeight), Math.abs(s.snowWeight - before.snowWeight));
      maxRoadPathDelta = Math.max(maxRoadPathDelta, Math.abs(s.coverage - before.coverage), Math.abs(s.roadPathControlBlend - before.roadPathControlBlend));
      maxFoliageDensity = Math.max(maxFoliageDensity, Math.abs(s.foliageDensity));
      maxMacroColorDelta = Math.max(maxMacroColorDelta, ...s.macroColor.map((v, i) => Math.abs(v - before.color[i])));
      if (x) { maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, tintDelta(s, row[x - 1])); maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(s.roughness - row[x - 1].roughness)); }
      if (previous) { maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, tintDelta(s, previous[x])); maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(s.roughness - previous[x].roughness)); }
      for (const v of [s.tintR, s.tintG, s.tintB, s.roughness]) checksum = hashByte(checksum, Math.round(clamp01(v) * 255));
      row.push(s);
    }
    previous = row;
  }
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, roadPathPolicyId: p.roadPathPolicyId,
    geoCell: p.geoCell, layer: p.layer, sourceGridSize: size, sourceSamples: size * size,
    canonicalWaterCells, canonicalLandCells,
    minSignal: round8(minSignal), maxSignal: round8(maxSignal), minTint: round8(minTint), maxTint: round8(maxTint),
    minRoughness: round8(minRoughness), maxRoughness: round8(maxRoughness),
    maxAdjacentTintDelta: round8(maxAdjacentTintDelta), maxAdjacentRoughnessDelta: round8(maxAdjacentRoughnessDelta),
    maxHeightDelta: round8(maxHeightDelta), maxControlDelta: round8(maxControlDelta), maxRoadPathDelta: round8(maxRoadPathDelta),
    maxFoliageDensity: round8(maxFoliageDensity), maxMacroColorDelta: round8(maxMacroColorDelta),
    detailChecksum: checksum >>> 0, terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    eastWorldBoundaryX: p.eastWorldBoundaryX, eastGuardAllowed: p.eastGuardAllowed,
  });
}

export function buildG71Terrain3DNearDetailProbe() {
  const p = G71_TERRAIN3D_NEAR_DETAIL_POLICY, b = p.normalizedBounds, rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1), row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1), s = sampleG71NearDetail(nx, ny);
      row.push([Number(s.authoredHeight.toFixed(6)), Number(s.controlBlend.toFixed(8)), Number(s.tintR.toFixed(8)), Number(s.tintG.toFixed(8)), Number(s.tintB.toFixed(8)), Number(s.roughness.toFixed(8)), s.water ? 1 : 0, s.foliageDensity]);
    }
    rows.push(row);
  }
  return Object.freeze({ schema: 'westeros-g71-terrain3d-near-detail-probe-v1', ...measureG71Terrain3DNearDetail(), normalizedBounds: p.normalizedBounds, guardBounds: g71NearDetailGuardBounds(), baseTextureId: p.baseTextureId, overlayTextureId: p.overlayTextureId, rows });
}
