/**
 * Grounded surface profile for world/environment consumers.
 *
 * This is a render-facing, side-effect-free contract. It consumes canonical caller-owned
 * terrain/hydrology samples and returns bounded material, relief and placement guidance.
 * It deliberately does not mutate terrain, collider, roads, settlements or shared placement state.
 */

const clamp01 = (value, fallback = 0) => {
  const numeric = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numeric));
};

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const smoothstep = (edge0, edge1, value) => {
  const span = Math.max(1e-6, edge1 - edge0);
  const t = clamp01((value - edge0) / span);
  return t * t * (3 - 2 * t);
};

const hash2 = (x, y, seed) => {
  const raw = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return raw - Math.floor(raw);
};

const normalize = (weights) => {
  const clean = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, clamp01(value)]));
  const total = Object.values(clean).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-8) return { grass: 1, soil: 0, mud: 0, rock: 0, scree: 0, snow: 0, wetEdge: 0 };
  return Object.fromEntries(Object.entries(clean).map(([key, value]) => [key, value / total]));
};

export const GROUNDED_SURFACE_PROFILE_POLICY = Object.freeze({
  id: 'buzul-grounded-surface-profile-v14',
  renderOnly: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  noGridTerms: true,
  noPlaceholderGeometry: true,
  maxMacroContrast: 0.28,
  maxMicroContrast: 0.16,
  normalFadeDistanceMeters: 1500,
});

export function createGroundedSurfaceProfile(input = {}) {
  const terrain = input.terrain ?? {};
  const hydrology = input.hydrology ?? {};
  const biome = input.biome ?? {};
  const seed = finite(input.seed, 17.25);
  const x = finite(input.x);
  const z = finite(input.z);
  const height = finite(terrain.height);
  const slope = clamp01(terrain.slope);
  const moisture = clamp01(terrain.moisture);
  const waterDistance = Math.max(0, finite(hydrology.waterDistance, 9999));
  const waterConfidence = clamp01(hydrology.waterConfidence, 0);
  const shoreline = clamp01(1 - waterDistance / 80);
  const snowline = finite(biome.snowline, 160);
  const treeline = finite(biome.treeline, snowline * 0.72);
  const temperature = finite(biome.temperature, 0.38);
  const cameraDistance = Math.max(0, finite(input.cameraDistance, 0));
  const local = 0.84 + hash2(x * 0.009, z * 0.011, seed) * 0.32;
  const macro = 0.82 + hash2(x * 0.0027 + 7, z * 0.0031 - 5, seed + 2.2) * 0.36;
  const micro = hash2(x * 0.037 - 3, z * 0.041 + 9, seed + 5.1);
  const cold = smoothstep(0.7, 0.1, temperature);
  const snow = smoothstep(snowline - 18, snowline + 20, height) * (0.55 + 0.45 * cold) * (0.68 + 0.32 * macro);
  const snowFade = smoothstep(0.15, 0.8, snow);
  const rockExposure = clamp01(smoothstep(0.28, 0.82, slope) * (0.68 + 0.28 * local) + snowFade * 0.18);
  const scree = clamp01(rockExposure * (0.46 + 0.38 * slope) * (0.9 + micro * 0.18));
  const wetEdge = clamp01(shoreline * (0.48 + moisture * 0.42) * (1 - waterConfidence * 0.65));
  const mud = clamp01(moisture * (1 - slope * 0.5) * (0.5 + wetEdge * 0.5));
  const grass = clamp01((1 - snowFade) * (1 - rockExposure * 0.5) * (1 - waterConfidence) * (0.72 + moisture * 0.28));
  const soil = clamp01((1 - grass) * 0.36 + (1 - moisture) * 0.35 + rockExposure * 0.12);
  const transition = clamp01(1 - Math.abs(height - treeline) / 26) * (1 - rockExposure * 0.55);
  const vegetationCapacity = clamp01((1 - snowFade) * (1 - rockExposure * 0.72) * (0.65 + 0.35 * moisture));
  const normalEnergy = clamp01(0.18 + 0.72 * (1 - cameraDistance / GROUNDED_SURFACE_PROFILE_POLICY.normalFadeDistanceMeters));
  const groundConfidence = clamp01(terrain.groundConfidence, 0);
  const steep = slope > 0.82;
  const submerged = waterConfidence > 0.72 || (waterDistance < 2.5 && groundConfidence < 0.55);
  const exclusionReason = submerged ? 'canonical-water' : steep ? 'steep-slope' : groundConfidence < 0.2 ? 'low-ground-confidence' : null;

  return Object.freeze({
    version: 1,
    finite: true,
    canonicalMutation: false,
    surface: Object.freeze({
      weights: Object.freeze(normalize({ grass, soil, mud, rock: rockExposure * 0.8, scree, snow, wetEdge })),
      macroVariation: clamp01(0.34 + (macro - 0.82) * 0.92),
      microVariation: clamp01(0.18 + micro * 0.52),
      antiTiling: clamp01(0.62 + 0.25 * hash2(x * 0.014 + 11, z * 0.016 - 13, seed + 8.4)),
      normalEnergy,
      roughness: clamp01(0.42 + rockExposure * 0.22 + snowFade * 0.18 + wetEdge * 0.08),
      shorelineMask: shoreline,
      snowlineMask: clamp01(snow),
    }),
    ecotone: Object.freeze({
      snowline: clamp01(snow),
      treeline: smoothstep(treeline - 18, treeline + 14, height),
      transition,
      vegetationCapacity,
      scaleVariation: 0.88 + hash2(x * 0.019 + 4, z * 0.017 - 6, seed + 4.4) * 0.24,
    }),
    relief: Object.freeze({
      rockExposure,
      screeBias: scree,
      microRelief: clamp01(0.14 + rockExposure * 0.48 + snowFade * 0.22 + micro * 0.16),
      slopeBreakup: clamp01(slope * 0.72 + rockExposure * 0.28),
    }),
    placement: Object.freeze({
      grounded: groundConfidence >= 0.2 && !submerged,
      vegetationAllowed: exclusionReason === null && vegetationCapacity > 0.16,
      exclusionReason,
      waterConfidence,
      waterDistance,
    }),
  });
}

export function summarizeGroundedSurfaceProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : createGroundedSurfaceProfile();
  const weights = source.surface?.weights ?? {};
  const finiteValues = [
    source.surface?.macroVariation,
    source.surface?.microVariation,
    source.surface?.normalEnergy,
    source.surface?.roughness,
    ...Object.values(weights),
  ].every(Number.isFinite);
  return Object.freeze({
    finite: finiteValues,
    canonicalMutation: source.canonicalMutation === true,
    grounded: source.placement?.grounded === true,
    vegetationAllowed: source.placement?.vegetationAllowed === true,
    exclusionReason: source.placement?.exclusionReason ?? null,
    snow: weights.snow ?? 0,
    rock: (weights.rock ?? 0) + (weights.scree ?? 0),
    wetEdge: weights.wetEdge ?? 0,
    normalEnergy: source.surface?.normalEnergy ?? 0,
  });
}
