/**
 * Live current-terrain source of truth.
 *
 * The whole owner map is covered by the canonical map.png-derived semantic/relief field. Where a
 * merged Terrain3D-authoring cell has a qualified height source, that authored height takes
 * priority and is feathered only toward unfinished neighbours. No live point falls back to the
 * historical FBM terrain. Render and physics consume this same factory through
 * currentTerrainAdapter.js.
 */
import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import { sampleReferencePindexQualityV2 } from './worldReferenceSurfacePindexes.js';
import { sampleG07Terrain3dBakeNormalized } from './g07Terrain3dBake.js';
import { sampleG00RockSnow } from '../../../godot/terrain-authoring/geocells/nw/g00_rock_snow.mjs';
import { sampleG01ReliefHeight } from '../../../godot/terrain-authoring/geocells/nw/g01_relief.mjs';
import { sampleG52RockSnow } from '../../../godot/terrain-authoring/geocells/ne/g52_rock_snow.mjs';
import { sampleG70RockSnow } from '../../../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';
import { sampleG17SeabedHeight } from '../../../godot/terrain-authoring/geocells/sw/g17_relief.mjs';
import { sampleG65Terrain3dRuntimeGridNormalized } from '../../../scripts/runtime/g65Terrain3dRuntimeGrid.mjs';
import { sampleG75RockSnow } from '../../../godot/terrain-authoring/geocells/se/g75_rock_snow.mjs';
import { sampleG77ReliefHeight } from '../../../godot/terrain-authoring/geocells/se/g77_relief.mjs';

const MAP_WIDTH = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
const MAP_HEIGHT = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
const SOURCE_PIXEL_WIDTH = 1536;
const SOURCE_PIXEL_HEIGHT = 1024;
const EDGE_FEATHER_SOURCE_PIXELS = 2;
const SEA_LEVEL = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  if (b <= a) return value >= b ? 1 : 0;
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Canonical settlement-coordinate snapshot mirrors settlements.js without importing its Three.js
// rendering dependency into this lightweight terrain source. checkWorldReferenceHydrologyExtent.js
// independently parses KINGDOM_SEATS and validates the same 14-site seat-safe hydrology contract.
const PROTECTED_SEAT_MAP_POINTS = Object.freeze([
  [3885, 5370], [1525, 1750], [1185, 4040], [1095, 4040], [1145, 3990], [1750, 3580], [2100, 3270],
  [1610, 4560], [920, 2900], [1850, 2790], [1650, 1060], [1050, 3360], [6190, 5140], [1400, 300],
]);
const PROTECTED_SEATS = Object.freeze(PROTECTED_SEAT_MAP_POINTS.map(([mapX, mapY]) => Object.freeze({
  x: clamp01(mapX / MAP_WIDTH),
  y: clamp01(mapY / MAP_HEIGHT),
})));
const PROTECTION_RADII = referenceProtectionRadiiFromMeters(75, WORLD_SCALE.METERS_PER_MAP_UNIT);
const MIN_LAND_CLEARANCE_METERS = 0.35;
const MIN_PROTECTED_CLEARANCE_METERS = 0.08;
const INLAND_PROTECTED_CLEARANCE_METERS = 1.25;
const MAX_RAW_WATER_BED_METERS = SEA_LEVEL - 0.25;

export const CURRENT_TERRAIN_POLICY = Object.freeze({
  id: 'westeros-current-terrain-single-source-2026-08-14-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  fullOwnerMapCoverage: true,
  legacyProceduralFallback: false,
  terrain3dVersion: '1.0.2-stable',
  canonicalFallback: 'map.png Pindex Quality V2 + canonical hydrology/relief',
  authoredCells: Object.freeze(['G00', 'G01', 'G07', 'G17', 'G52', 'G65', 'G70', 'G75', 'G77']),
});

const CELLS = Object.freeze([
  Object.freeze({ id: 'G00', agent: 'Buzul Muhafızı', x0: 0, x1: 1 / 8, y0: 0, y1: 1 / 8,
    sample: (x, y) => sampleG00RockSnow(x, y).heightMeters }),
  Object.freeze({ id: 'G01', agent: 'Buzul Muhafızı', x0: 0, x1: 1 / 8, y0: 1 / 8, y1: 2 / 8,
    sample: (x, y) => sampleG01ReliefHeight(x, y) }),
  Object.freeze({ id: 'G52', agent: 'Şafak Kartalı', x0: 5 / 8, x1: 6 / 8, y0: 2 / 8, y1: 3 / 8,
    sample: (x, y) => sampleG52RockSnow(x, y).heightMeters }),
  Object.freeze({ id: 'G70', agent: 'Şafak Kartalı', x0: 7 / 8, x1: 1, y0: 0, y1: 1 / 8,
    sample: (x, y) => sampleG70RockSnow(x, y).heightMeters }),
  Object.freeze({ id: 'G07', agent: 'Günbatımı Ustası', x0: 0, x1: 1 / 8, y0: 7 / 8, y1: 1,
    sample: (x, y) => sampleG07Terrain3dBakeNormalized(x, y)?.height ?? null }),
  Object.freeze({ id: 'G17', agent: 'Günbatımı Ustası', x0: 1 / 8, x1: 2 / 8, y0: 7 / 8, y1: 1,
    sample: (x, y) => sampleG17SeabedHeight(x, y).height }),
  Object.freeze({ id: 'G65', agent: 'Kızıl Ufuk', x0: 6 / 8, x1: 7 / 8, y0: 5 / 8, y1: 6 / 8,
    sample: (x, y) => sampleG65Terrain3dRuntimeGridNormalized(x, y)?.height ?? null }),
  Object.freeze({ id: 'G75', agent: 'Kızıl Ufuk', x0: 7 / 8, x1: 1, y0: 5 / 8, y1: 6 / 8,
    sample: (x, y) => sampleG75RockSnow(x, y).height }),
  Object.freeze({ id: 'G77', agent: 'Kızıl Ufuk', x0: 7 / 8, x1: 1, y0: 7 / 8, y1: 1,
    sample: (x, y) => sampleG77ReliefHeight(x, y) }),
]);

function mapCenter() {
  return {
    x: (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5,
    y: (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5,
  };
}

export function ownerMapNormalizedToCurrentWorld(normalizedX, normalizedY) {
  const nx = clamp01(normalizedX);
  const ny = clamp01(normalizedY);
  const center = mapCenter();
  return Object.freeze({
    x: (nx * MAP_WIDTH - center.x) * WORLD_SCALE.METERS_PER_MAP_UNIT,
    z: (ny * MAP_HEIGHT - center.y) * WORLD_SCALE.METERS_PER_MAP_UNIT,
  });
}

export function currentWorldToOwnerMap(worldX, worldZ) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
  const center = mapCenter();
  const rawMapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + center.x;
  const rawMapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + center.y;
  return Object.freeze({
    mapX: Math.max(0, Math.min(MAP_WIDTH, rawMapX)),
    mapY: Math.max(0, Math.min(MAP_HEIGHT, rawMapY)),
    normalizedX: clamp01(rawMapX / MAP_WIDTH),
    normalizedY: clamp01(rawMapY / MAP_HEIGHT),
    insideOwnerMap: rawMapX >= 0 && rawMapX <= MAP_WIDTH && rawMapY >= 0 && rawMapY <= MAP_HEIGHT,
  });
}

function canonicalMicroSignal(nx, ny) {
  return 0.50 * Math.sin(TAU * (nx * 13 + ny * 17) + 0.31)
    + 0.30 * Math.cos(TAU * (nx * 29 - ny * 11) + 1.13)
    + 0.20 * Math.sin(TAU * (nx * 41 + ny * 37) + 2.07);
}

/** Continuous full-map height when no cell-specific Terrain3D height is available yet. */
export function sampleCanonicalCurrentRelativeHeight(normalizedX, normalizedY) {
  const nx = clamp01(normalizedX);
  const ny = clamp01(normalizedY);
  const sample = sampleReferencePindexQualityV2(nx, ny);
  const waterWeight = clamp01((sample.surfaceWeights.sea ?? 0) + (sample.surfaceWeights.lake ?? 0));
  const rockWeight = clamp01(sample.surfaceWeights.rock ?? 0);
  const snowWeight = clamp01(sample.surfaceWeights.snow ?? 0);
  const dryWeight = 1 - waterWeight;
  const micro = canonicalMicroSignal(nx, ny) * (0.7 + sample.microAmplitude * 18);
  const dryHeight = 1.35
    + sample.reliefInfluence * 34
    + sample.biomeInfluence * 10
    + rockWeight * 12
    + snowWeight * 18
    + micro * (0.65 + dryWeight * 0.35);
  const wetHeight = -2.75
    - waterWeight * 5.5
    - sample.reliefInfluence * 1.2
    + micro * 0.18;
  // Pindex weights retain sharp map.png shoreline detail. A narrow semantic ramp (the former
  // 0.34..0.66 interval) could therefore mix tens of metres of dry relief into seabed height over
  // only one short road segment. Keep the source detail, but spread the vertical transition across
  // the full ambiguous coastal weight band so terrain remains cart-walkable without moving roads.
  const coastBlend = smoothstep(0.05, 0.95, waterWeight);
  return lerp(dryHeight, wetHeight, coastBlend);
}

function overlaps(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0) > 1e-10;
}

function hasAuthoredNeighbour(cell, side) {
  return CELLS.some((other) => {
    if (other === cell) return false;
    if (side === 'left') return Math.abs(other.x1 - cell.x0) < 1e-10 && overlaps(other.y0, other.y1, cell.y0, cell.y1);
    if (side === 'right') return Math.abs(other.x0 - cell.x1) < 1e-10 && overlaps(other.y0, other.y1, cell.y0, cell.y1);
    if (side === 'top') return Math.abs(other.y1 - cell.y0) < 1e-10 && overlaps(other.x0, other.x1, cell.x0, cell.x1);
    return Math.abs(other.y0 - cell.y1) < 1e-10 && overlaps(other.x0, other.x1, cell.x0, cell.x1);
  });
}

function cellWeight(cell, nx, ny) {
  const distances = [];
  if (cell.x0 > 0 && !hasAuthoredNeighbour(cell, 'left')) distances.push((nx - cell.x0) * SOURCE_PIXEL_WIDTH);
  if (cell.x1 < 1 && !hasAuthoredNeighbour(cell, 'right')) distances.push((cell.x1 - nx) * SOURCE_PIXEL_WIDTH);
  if (cell.y0 > 0 && !hasAuthoredNeighbour(cell, 'top')) distances.push((ny - cell.y0) * SOURCE_PIXEL_HEIGHT);
  if (cell.y1 < 1 && !hasAuthoredNeighbour(cell, 'bottom')) distances.push((cell.y1 - ny) * SOURCE_PIXEL_HEIGHT);
  if (!distances.length) return 1;
  return smoothstep(0, EDGE_FEATHER_SOURCE_PIXELS, Math.min(...distances));
}

function authoredCellAt(nx, ny) {
  return CELLS.find((cell) => nx >= cell.x0 && nx <= cell.x1 && ny >= cell.y0 && ny <= cell.y1) ?? null;
}

function applyCanonicalDryLandFloor(nx, ny, heightMeters) {
  const hydrology = sampleSeatSafeReferenceHydrology(nx, ny, PROTECTED_SEATS, PROTECTION_RADII);
  const protectedClearance = MIN_PROTECTED_CLEARANCE_METERS
    + (INLAND_PROTECTED_CLEARANCE_METERS - MIN_PROTECTED_CLEARANCE_METERS) * hydrology.protectedLandWeight;

  // Keep canonical water physically below the 6m water plane even while the broader coastal blend
  // approaches shore. Protected coastal seats are the sole exception and still rise continuously
  // to their seat-safe floor using the accepted hydrology protection weight.
  if (hydrology.rawWater) {
    const waterBedHeight = Math.min(heightMeters, MAX_RAW_WATER_BED_METERS);
    if (!hydrology.protectedLand) return waterBedHeight;
    const clearance = Math.max(MIN_LAND_CLEARANCE_METERS, protectedClearance);
    const protectedFloor = Math.max(waterBedHeight, SEA_LEVEL + clearance);
    return lerp(waterBedHeight, protectedFloor, hydrology.protectedLandWeight);
  }

  const clearance = hydrology.protectedLand
    ? Math.max(MIN_LAND_CLEARANCE_METERS, protectedClearance)
    : MIN_LAND_CLEARANCE_METERS;
  return Math.max(heightMeters, SEA_LEVEL + clearance);
}

export function sampleCurrentTerrainNormalized(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const nx = clamp01(normalizedX);
  const ny = clamp01(normalizedY);
  const canonicalRelativeHeight = sampleCanonicalCurrentRelativeHeight(nx, ny);
  const cell = authoredCellAt(nx, ny);
  if (!cell) {
    const rawHeightMeters = SEA_LEVEL + canonicalRelativeHeight;
    const heightMeters = applyCanonicalDryLandFloor(nx, ny, rawHeightMeters);
    return Object.freeze({
      policyId: CURRENT_TERRAIN_POLICY.id,
      source: 'canonical-full-map',
      authoredCell: null,
      authoredWeight: 0,
      relativeHeightMeters: heightMeters - SEA_LEVEL,
      heightMeters,
    });
  }
  const authoredRelativeHeight = cell.sample(nx, ny);
  if (!Number.isFinite(authoredRelativeHeight)) throw new Error(`${cell.id} current terrain source returned non-finite height`);
  const weight = cellWeight(cell, nx, ny);
  const blendedRelativeHeight = lerp(canonicalRelativeHeight, authoredRelativeHeight, weight);
  const heightMeters = applyCanonicalDryLandFloor(nx, ny, SEA_LEVEL + blendedRelativeHeight);
  return Object.freeze({
    policyId: CURRENT_TERRAIN_POLICY.id,
    source: 'terrain3d-authored',
    authoredCell: cell.id,
    agent: cell.agent,
    authoredWeight: weight,
    relativeHeightMeters: heightMeters - SEA_LEVEL,
    heightMeters,
  });
}

function flattenWeight(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
  if (distanceMeters <= innerRadiusMeters) return 1;
  if (distanceMeters >= outerRadiusMeters) return 0;
  return smoothstep(0, 1, 1 - (distanceMeters - innerRadiusMeters) / (outerRadiusMeters - innerRadiusMeters));
}

function applyFlattenPads(worldX, worldZ, baseHeightMeters, flattenPads) {
  let strongestWeight = 0;
  let anchorHeightMeters = baseHeightMeters;
  for (const pad of flattenPads) {
    const weight = flattenWeight(Math.hypot(worldX - pad.x, worldZ - pad.z), pad.innerRadiusMeters, pad.outerRadiusMeters);
    if (weight <= strongestWeight) continue;
    strongestWeight = weight;
    anchorHeightMeters = pad.anchorHeightMeters;
  }
  return strongestWeight > 0 ? lerp(baseHeightMeters, anchorHeightMeters, strongestWeight) : baseHeightMeters;
}

export function createCurrentTerrainHeightSampler({ flattenPads = [] } = {}) {
  if (!Array.isArray(flattenPads)) throw new TypeError('flattenPads must be an array');
  const sampler = function sampleCurrentTerrainHeight(worldX, worldZ) {
    const map = currentWorldToOwnerMap(worldX, worldZ);
    const base = sampleCurrentTerrainNormalized(map.normalizedX, map.normalizedY).heightMeters;
    return applyFlattenPads(worldX, worldZ, base, flattenPads);
  };
  Object.defineProperties(sampler, {
    policyId: { value: CURRENT_TERRAIN_POLICY.id },
    fullOwnerMapCoverage: { value: true },
    legacyProceduralFallback: { value: false },
  });
  return sampler;
}

export function sampleCurrentTerrainWorld(worldX, worldZ) {
  const map = currentWorldToOwnerMap(worldX, worldZ);
  return Object.freeze({ ...map, ...sampleCurrentTerrainNormalized(map.normalizedX, map.normalizedY) });
}