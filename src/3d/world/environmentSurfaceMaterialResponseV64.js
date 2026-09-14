const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
};

function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export const V64_SURFACE_MATERIAL_POLICY = Object.freeze({
  id: 'buzul-muhafizi-surface-material-response-v64-20260914',
  roles: Object.freeze(['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'wet', 'shore', 'ice', 'water']),
  cameraBreakpointsMeters: Object.freeze({ near: 180, mid: 900, far: 2800 }),
  antiTiling: Object.freeze({ worldSpace: true, triplanarEquivalent: true, maxRepeatVisible: 1.8 }),
});

function roleWeights({ slope = 0, moisture = 0.5, elevation01 = 0.5, snowWeight = 0, waterDistance = 5000, waterClass = 'land', curvature = 0, surface = 'grass' } = {}) {
  const wet = clamp01(moisture * 0.9 + (waterClass !== 'land' && waterDistance < 40 ? 0.24 : 0));
  const snow = Math.max(clamp01(snowWeight), clamp01((elevation01 - 0.67) / 0.33) * (1 - clamp01((slope - 48) / 32) * 0.4));
  const rock = Math.max(clamp01((slope - 18) / 52), clamp01(curvature * 0.36));
  const scree = clamp01((slope - 38) / 40) * (0.36 + elevation01 * 0.64);
  const shore = waterClass !== 'land' && waterClass !== 'unknown' ? clamp01(1 - waterDistance / 34) : 0;
  const grass = clamp01(1 - rock) * (1 - snow) * (1 - wet * 0.32);
  const soil = clamp01(0.28 + moisture * 0.42) * (1 - rock * 0.54);
  const mud = wet * 0.48;
  const water = waterClass !== 'land' && waterClass !== 'unknown' ? clamp01(0.12 + shore * 0.18) : 0;
  const raw = { grass, soil, mud, rock, scree, snow, wet: wet * 0.52, shore: shore * 0.78, ice: surface === 'ice' ? 0.8 : 0, water };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.freeze(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round(Math.max(0, value) / total)])));
}

export function createMultiscaleSurfaceMaterialResponseV64({ terrain = {}, water = {}, material = {}, cameraDistance = 420, seed = 'v64-material' } = {}) {
  const distance = clamp(cameraDistance, 0.1, 20000);
  const weights = roleWeights({
    slope: terrain.slope,
    moisture: terrain.moisture,
    elevation01: terrain.elevation01,
    snowWeight: terrain.snowWeight,
    waterDistance: water.waterDistance ?? water.distance,
    waterClass: water.waterClass ?? water.class,
    curvature: terrain.curvature,
    surface: terrain.surface,
  });
  const relief = clamp01(terrain.relief ?? terrain.localRelief);
  const roughness = clamp01(material.roughness ?? 0.75);
  const macro = clamp01(material.macroContrast ?? 0.55);
  const micro = clamp01(material.microDetail ?? 0.55);
  const distanceFade = distance < 180 ? 1 : distance < 900 ? 0.74 : distance < 2800 ? 0.42 : 0.16;
  const repeat = clamp(1.05 + (1 - relief) * 0.48 + distanceFade * 0.22, 0.8, 2.2);
  const antiTilingPhase = round(Math.sin((terrain.x ?? 0) * 0.0013 + (terrain.z ?? 0) * 0.0021 + seed.length * 0.37));
  return freeze({
    weights,
    roughness: round(clamp(roughness * (0.84 + terrain.moisture * 0.18), 0.08, 0.98)),
    normalEnergy: round(clamp(0.5 + micro * 0.52 + relief * 0.18, 0.15, 1.35)),
    ao: round(clamp(0.42 + roughness * 0.38 + relief * 0.18, 0, 1)),
    macroContrast: round(clamp(macro * (0.7 + relief * 0.5), 0, 1)),
    microDetail: round(clamp(micro * (0.66 + relief * 0.46), 0, 1)),
    distanceFade: round(distanceFade),
    normalFade: round(distanceFade * 0.94),
    worldSpaceScale: round(1.15 + relief * 0.85),
    visibleRepeatFactor: round(repeat),
    antiTilingPhase,
    antiTilingPass: repeat <= V64_SURFACE_MATERIAL_POLICY.antiTiling.maxRepeatVisible,
    triplanarEquivalent: terrain.slope > 38 || distance < 500,
    snowlineBreakup: round(clamp01(weights.snow * 0.72 + relief * 0.18)),
    shorelineBlend: round(weights.shore + weights.wet * 0.4),
    fingerprint: hash(JSON.stringify({ weights, distanceFade, repeat, antiTilingPhase, roughness, macro, micro })),
  });
}

export function validateMultiscaleSurfaceMaterialResponseV64(response) {
  const errors = [];
  const weights = response?.weights ?? {};
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.015) errors.push('weights-not-normalized');
  if (response?.visibleRepeatFactor > V64_SURFACE_MATERIAL_POLICY.antiTiling.maxRepeatVisible) errors.push('visible-texture-repeat');
  if (response?.antiTilingPass !== true) errors.push('anti-tiling');
  if (!response?.triplanarEquivalent) errors.push('missing-triplanar-equivalent');
  return freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function compareSurfaceMaterialResponseV64(first, second) {
  return freeze({
    sameFingerprint: first?.fingerprint === second?.fingerprint,
    microDetailDelta: round((second?.microDetail ?? 0) - (first?.microDetail ?? 0)),
    macroContrastDelta: round((second?.macroContrast ?? 0) - (first?.macroContrast ?? 0)),
    repeatDelta: round((second?.visibleRepeatFactor ?? 0) - (first?.visibleRepeatFactor ?? 0)),
  });
}
