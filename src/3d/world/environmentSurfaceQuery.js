/**
 * Deterministic, render/placement-facing environment surface query.
 *
 * This module is intentionally side-effect free: it does not create meshes,
 * mutate terrain, or import editor/runtime scene owners. Callers provide the
 * canonical terrain/hydrology/context samples and receive bounded signals for
 * material selection, ground alignment, vegetation exclusion and water-aware
 * dressing. The canonical providers remain authoritative.
 *
 * @module world/environmentSurfaceQuery
 */

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const smoothstep = (edge0, edge1, value) => {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const hash2 = (x, y, seed = 0) => {
  let h = (Math.imul(Math.round(finite(x) * 4096), 374761393)
    ^ Math.imul(Math.round(finite(y) * 4096), 668265263)
    ^ Math.imul(Math.round(finite(seed) * 4096), 1442695041)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const normalizeBiome = (biome) => String(biome || 'temperate').trim().toLowerCase() || 'temperate';

export const ENVIRONMENT_SURFACE_QUERY_VERSION = 'v11';

export function queryEnvironmentSurface(input = {}) {
  const height = finite(input.height);
  const slope = clamp01(input.slope);
  const moisture = clamp01(input.moisture);
  const temperature = clamp01(input.temperature);
  const waterDistance = Math.max(0, finite(input.waterDistance, 9999));
  const waterConfidence = clamp01(input.waterConfidence);
  const roadDistance = Math.max(0, finite(input.roadDistance, 9999));
  const settlementDistance = Math.max(0, finite(input.settlementDistance, 9999));
  const biome = normalizeBiome(input.biome);
  const seed = finite(input.seed);
  const worldX = finite(input.worldX);
  const worldZ = finite(input.worldZ);

  const shoreline = 1 - smoothstep(0, 48, waterDistance);
  const wetEdge = shoreline * Math.max(waterConfidence, 1 - smoothstep(0, 10, waterDistance));
  const alpine = Math.max(0, smoothstep(0.62, 0.94, slope) * (1 - temperature));
  const snow = Math.max(0, smoothstep(0.72, 0.98, 1 - temperature) * smoothstep(0.45, 0.95, height / 120));
  const exposedRock = Math.max(0, smoothstep(0.55, 0.9, slope) * (1 - wetEdge * 0.55));
  const mud = Math.max(0, moisture * (1 - slope * 0.6) * (1 - waterConfidence * 0.35));
  const grass = Math.max(0, (1 - exposedRock) * (1 - snow) * (1 - shoreline * 0.7));
  const scree = Math.max(0, exposedRock * (0.35 + alpine * 0.65));
  const sand = Math.max(0, shoreline * (1 - exposedRock) * (1 - moisture * 0.5));
  const soil = Math.max(0, (1 - grass) * (1 - exposedRock) * (1 - snow) * (1 - sand));

  const carrierA = hash2(worldX * 0.031, worldZ * 0.031, seed);
  const carrierB = hash2(worldX * 0.077 + 17.3, worldZ * 0.077 - 9.1, seed + 11);
  const macroBreakup = 0.5 + (carrierA - 0.5) * 0.42 + (carrierB - 0.5) * 0.18;
  const microBreakup = 0.5 + (hash2(worldX * 0.41, worldZ * 0.41, seed + 29) - 0.5) * 0.32;

  const roadExclusion = smoothstep(0, 12, roadDistance);
  const settlementExclusion = smoothstep(0, 28, settlementDistance);
  const vegetationAllowance = clamp01(roadExclusion * settlementExclusion * (1 - waterConfidence) * (1 - exposedRock * 0.85));
  const waterBodyClass = waterConfidence >= 0.72 ? 'water' : waterConfidence >= 0.28 ? 'shore' : 'land';
  const groundConfidence = clamp01((1 - waterConfidence) * (0.55 + 0.45 * roadExclusion));

  return Object.freeze({
    version: ENVIRONMENT_SURFACE_QUERY_VERSION,
    biome,
    height,
    slope,
    moisture,
    temperature,
    waterDistance,
    waterConfidence,
    waterBodyClass,
    groundConfidence,
    materialWeights: Object.freeze({
      grass: clamp01(grass),
      soil: clamp01(soil),
      mud: clamp01(mud),
      rock: clamp01(exposedRock),
      scree: clamp01(scree),
      snow: clamp01(snow),
      sand: clamp01(sand),
      wetEdge: clamp01(wetEdge),
    }),
    breakup: Object.freeze({
      macro: clamp01(macroBreakup),
      micro: clamp01(microBreakup),
      antiTiling: clamp01(0.65 + Math.abs(carrierA - carrierB) * 0.35),
    }),
    placement: Object.freeze({
      vegetationAllowance,
      roadExclusion: clamp01(roadExclusion),
      settlementExclusion: clamp01(settlementExclusion),
      mustStayGrounded: true,
      rejectIfWater: waterBodyClass === 'water',
      rejectIfSteep: slope >= 0.92,
    }),
    canonicalMutation: false,
  });
}

export function serializeEnvironmentSurfaceQuery(query) {
  const value = queryEnvironmentSurface(query);
  return JSON.stringify(value);
}
