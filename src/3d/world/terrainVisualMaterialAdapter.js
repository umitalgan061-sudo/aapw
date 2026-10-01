/**
 * Runtime-facing terrain material adapter.
 *
 * Applies caller-owned surface samples to already hydrated MeshStandard-like materials.
 * It never creates geometry, performs placement, imports editor code, or mutates canonical
 * terrain/hydrology/collider state. The caller remains responsible for MaterialAssignmentCore
 * and WorldAssetPlacementPipeline when a model-bearing placement is involved.
 *
 * @module world/terrainVisualMaterialAdapter
 */

export const TERRAIN_VISUAL_MATERIAL_ADAPTER_POLICY = Object.freeze({
  id: 'terrain-visual-material-adapter-2026-09-08-v16',
  renderOnly: true,
  canonicalMutation: false,
  editorRuntimeImport: false,
  geometryMutation: false,
  maxRoughness: 0.98,
  minRoughness: 0.58,
  maxNormalEnergy: 0.42,
  minNormalEnergy: 0.02,
  maxColorChannel: 1,
  minColorChannel: 0,
});

const clamp01 = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
};

const finite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const smoothstep = (edge0, edge1, value) => {
  const range = Math.max(1e-6, edge1 - edge0);
  const t = clamp01((value - edge0) / range);
  return t * t * (3 - 2 * t);
};

const normalizeSurfaceSample = (sample = {}) => {
  const slope = clamp01(finite(sample.slopeDegrees, 0) / 90);
  const height = clamp01(finite(sample.heightAboveSeaMeters, 0) / 900);
  const moisture = clamp01(sample.moisture, 0.4);
  const waterDistance = clamp01(finite(sample.waterDistanceMeters, 40) / 240);
  const snowline = clamp01(finite(sample.snowlineFactor, height));
  const biome = typeof sample.biome === 'string' ? sample.biome.toLowerCase() : 'temperate';
  const shoreline = clamp01(1 - waterDistance);
  const rockExposure = clamp01(Math.max(slope * 1.25, (height - 0.68) * 1.8));
  const snowExposure = clamp01(Math.max(snowline, (height - 0.78) * 2.1));
  const wetEdge = smoothstep(0.72, 1, shoreline) * moisture;
  const soil = clamp01((1 - rockExposure) * (1 - snowExposure) * (0.82 + moisture * 0.18));
  const grass = clamp01((1 - rockExposure) * (1 - snowExposure) * (0.88 - moisture * 0.18));
  const scree = clamp01(rockExposure * (0.38 + slope * 0.62));
  const rock = clamp01(rockExposure * (0.55 + height * 0.45));
  const snow = clamp01(snowExposure * (0.72 + (1 - moisture) * 0.28));
  const mud = clamp01(wetEdge * (0.72 + moisture * 0.28));
  const shorelineSand = biome.includes('coast') || biome.includes('desert') ? clamp01(wetEdge * 0.78) : clamp01(wetEdge * 0.18);
  const total = grass + soil + mud + rock + scree + snow + shorelineSand;
  const normalEnergy = clamp01((1 - smoothstep(0.72, 1, clamp01(finite(sample.cameraDistanceMeters, 0) / 3600))) * (0.55 + slope * 0.45));
  const antiTiling = clamp01(0.42 + Math.abs(Math.sin(finite(sample.worldX, 0) * 0.013 + finite(sample.worldZ, 0) * 0.009)) * 0.38 + (1 - waterDistance) * 0.2);
  const surfaceClass = snow > 0.56 ? 'snow' : rock > 0.58 ? 'rock' : mud > 0.46 ? 'wet-edge' : grass > soil ? 'grass' : 'soil';
  return Object.freeze({
    grass: total ? grass / total : 0,
    soil: total ? soil / total : 0,
    mud: total ? mud / total : 0,
    rock: total ? rock / total : 0,
    scree: total ? scree / total : 0,
    snow: total ? snow / total : 0,
    shorelineSand: total ? shorelineSand / total : 0,
    wetEdge,
    rockExposure,
    snowExposure,
    normalEnergy,
    antiTiling,
    surfaceClass,
    waterSafe: waterDistance > 0.08,
    slopeSafe: slope < 0.86,
    canonicalHeightUnchanged: true,
    canonicalHydrologyUnchanged: true,
  });
};

const paletteFor = (context) => {
  const warm = clamp01(context.warmth, 0.35);
  const cool = clamp01(context.coolness, 0.25);
  const soil = { r: 0.23 + warm * 0.08, g: 0.20 + warm * 0.05, b: 0.14 + cool * 0.03 };
  const grass = { r: 0.22 + warm * 0.05, g: 0.33 + (1 - cool) * 0.08, b: 0.16 + cool * 0.03 };
  const rock = { r: 0.31 + cool * 0.08, g: 0.30 + cool * 0.07, b: 0.28 + cool * 0.09 };
  const snow = { r: 0.78 + cool * 0.12, g: 0.82 + cool * 0.11, b: 0.84 + cool * 0.12 };
  const wet = { r: 0.15 + cool * 0.04, g: 0.20 + cool * 0.06, b: 0.18 + cool * 0.05 };
  return { soil, grass, rock, snow, wet };
};

const mix = (a, b, amount) => {
  const t = clamp01(amount);
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
};

const colorFor = (weights, palette) => {
  const base = { r: 0.08, g: 0.08, b: 0.08 };
  const add = (color, amount) => {
    base.r += color.r * amount;
    base.g += color.g * amount;
    base.b += color.b * amount;
  };
  add(palette.grass, weights.grass);
  add(palette.soil, weights.soil);
  add(palette.wet, weights.mud + weights.shorelineSand * 0.35);
  add(palette.rock, weights.rock + weights.scree * 0.8);
  add(palette.snow, weights.snow);
  const luminance = Math.max(0.42, Math.min(1.18, 0.82 + weights.antiTiling * 0.17 + weights.rockExposure * 0.09));
  return Object.freeze({
    r: clamp01(base.r * luminance),
    g: clamp01(base.g * luminance),
    b: clamp01(base.b * luminance),
  });
};

const updateColorObject = (target, color) => {
  if (!target || typeof target !== 'object') return;
  if (typeof target.setRGB === 'function') target.setRGB(color.r, color.g, color.b);
  else { target.r = color.r; target.g = color.g; target.b = color.b; }
};

const applyMaterial = (material, weights, palette) => {
  if (!material || typeof material !== 'object') return false;
  const color = colorFor(weights, palette);
  updateColorObject(material.color, color);
  material.roughness = Math.max(TERRAIN_VISUAL_MATERIAL_ADAPTER_POLICY.minRoughness, Math.min(TERRAIN_VISUAL_MATERIAL_ADAPTER_POLICY.maxRoughness, 0.94 - weights.wetEdge * 0.18 - weights.rock * 0.06));
  material.metalness = 0;
  material.flatShading = false;
  material.userData = { ...(material.userData ?? {}), terrainVisualMaterialAdapter: TERRAIN_VISUAL_MATERIAL_ADAPTER_POLICY.id, surfaceClass: weights.surfaceClass, antiTiling: weights.antiTiling };
  if (material.normalScale && typeof material.normalScale.set === 'function') material.normalScale.set(weights.normalEnergy, weights.normalEnergy);
  else material.normalEnergy = weights.normalEnergy;
  material.needsUpdate = true;
  return true;
};

export function deriveTerrainVisualMaterialContext(sample = {}, context = {}) {
  const normalized = normalizeSurfaceSample(sample);
  const palette = paletteFor(context);
  const color = colorFor(normalized, palette);
  return Object.freeze({
    policyId: TERRAIN_VISUAL_MATERIAL_ADAPTER_POLICY.id,
    weights: normalized,
    palette,
    color,
    manifest: Object.freeze({
      surfaceClass: normalized.surfaceClass,
      recipe: ['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'shorelineSand'],
      multiMaterial: true,
      antiTiling: normalized.antiTiling,
      normalEnergy: normalized.normalEnergy,
    }),
  });
}

export function applyTerrainVisualMaterialContext(material, sample = {}, context = {}) {
  const derived = deriveTerrainVisualMaterialContext(sample, context);
  const applied = applyMaterial(material, derived.weights, derived.palette);
  return Object.freeze({ ...derived, applied });
}

export function applyTerrainVisualMaterialToObject3D(object3D, sample = {}, context = {}) {
  const derived = deriveTerrainVisualMaterialContext(sample, context);
  let materialCount = 0;
  object3D?.traverse?.((node) => {
    if (!node?.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) if (applyMaterial(material, derived.weights, derived.palette)) materialCount += 1;
  });
  return Object.freeze({ ...derived, applied: materialCount > 0, materialCount });
}

export function validateTerrainVisualMaterialContext(context) {
  const weights = context?.weights ?? {};
  const values = ['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'shorelineSand', 'normalEnergy', 'antiTiling'].map((key) => Number(weights[key]));
  const finiteValues = values.every(Number.isFinite);
  const bounded = values.every((value) => value >= 0 && value <= 1);
  const sum = ['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'shorelineSand'].reduce((total, key) => total + Number(weights[key] ?? 0), 0);
  return Object.freeze({
    valid: finiteValues && bounded && Math.abs(sum - 1) < 1e-6,
    finite: finiteValues,
    bounded,
    normalized: Math.abs(sum - 1) < 1e-6,
    canonicalHeightUnchanged: context?.weights?.canonicalHeightUnchanged === true,
    canonicalHydrologyUnchanged: context?.weights?.canonicalHydrologyUnchanged === true,
  });
}

export function serializeTerrainVisualMaterialContext(context) {
  return JSON.stringify({
    policyId: context?.policyId ?? TERRAIN_VISUAL_MATERIAL_ADAPTER_POLICY.id,
    weights: context?.weights ?? {},
    color: context?.color ?? {},
    manifest: context?.manifest ?? {},
  });
}
