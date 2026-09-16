/**
 * Runtime material policy for the AAPW renderer stack.
 *
 * The optimizer never mutates authored assets. It computes an immutable runtime recipe that callers
 * can apply to cloned materials after loading. This keeps art-source fidelity while allowing modern
 * GPU-friendly choices such as derivative-friendly maps, mip bias, anisotropy caps and shader feature
 * shedding under pressure.
 */

const QUALITY = Object.freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });
const MAP_KEYS = Object.freeze(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']);
const FEATURE_KEYS = Object.freeze(['clearcoat', 'sheen', 'transmission', 'iridescence', 'normal', 'emissive', 'ao']);

function n(value, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, n(value, lo))); }
function rank(value) { return QUALITY[value] ?? QUALITY.balanced; }

function normalizeName(value) { return String(value ?? 'material').trim().slice(0, 120) || 'material'; }
function bool(value) { return value === true; }
function bytesFromTexture(texture = {}) { return Math.max(0, n(texture.width) * n(texture.height) * 4); }

export function estimateMaterialFootprint(material = {}) {
  const maps = material.maps ?? material;
  const unique = new Set();
  let bytes = 0;
  for (const key of MAP_KEYS) {
    const texture = maps[key];
    if (!texture) continue;
    const identity = texture.uuid ?? texture.id ?? `${key}:${texture.width}x${texture.height}`;
    if (unique.has(identity)) continue;
    unique.add(identity);
    const base = bytesFromTexture(texture);
    const mip = base > 0 ? base / 3 : 0;
    bytes += base + mip;
  }
  return Object.freeze({ textureCount: unique.size, estimatedBytes: Math.round(bytes), mapKeys: Object.freeze([...unique]) });
}

export function deriveMaterialRecipe({ quality = 'balanced', backend = 'webgl2', distanceMeters = 0, screenCoverage = 1, importance = 0.5, memoryPressure = 0, transparent = false, animated = false } = {}) {
  const q = rank(quality);
  const distance = Math.max(0, n(distanceMeters));
  const coverage = clamp(screenCoverage, 0, 1);
  const importanceScore = clamp(importance, 0, 1);
  const pressure = clamp(memoryPressure, 0, 1);
  const modernBackend = backend === 'webgpu';
  const farPenalty = distance > 250 ? 1 : distance > 90 ? 0.5 : 0;
  const scalePenalty = coverage < 0.02 ? 1 : coverage < 0.08 ? 0.5 : 0;
  const aggressive = pressure > 0.72 || q === 0;
  const recipe = {
    backend: modernBackend ? 'webgpu' : 'webgl2',
    quality,
    mipBias: Number(clamp(farPenalty + scalePenalty + (pressure * 0.75) - importanceScore * 0.35, -0.25, 2.5).toFixed(2)),
    anisotropy: Math.round(modernBackend ? (q >= 2 ? 8 : 4) : (q >= 2 ? 4 : 2)),
    useNormalMap: q >= 1 && !aggressive,
    useAoMap: q >= 1 && screenCoverage > 0.015,
    useEmissive: q >= 2 && !aggressive,
    useAdvancedLayering: q >= 3 && modernBackend && !aggressive,
    alphaHash: transparent && modernBackend && q >= 2,
    depthWrite: !transparent,
    transparent,
    animated,
    preferredEncoding: modernBackend && q >= 2 ? 'srgb' : 'srgb',
  };
  if (aggressive) { recipe.anisotropy = Math.min(recipe.anisotropy, 2); recipe.useNormalMap = false; recipe.useAoMap = false; recipe.useEmissive = false; }
  return Object.freeze(recipe);
}

export function buildMaterialBatchKey(material = {}, recipe = {}) {
  const type = String(material.type ?? 'MeshStandardMaterial');
  const side = String(material.side ?? 'front');
  const transparent = bool(recipe.transparent);
  const alphaHash = bool(recipe.alphaHash);
  const advanced = bool(recipe.useAdvancedLayering);
  return [type, side, transparent ? 1 : 0, alphaHash ? 1 : 0, advanced ? 1 : 0, recipe.preferredEncoding ?? 'srgb'].join(':');
}

export function planMaterialOptimization(materials = [], context = {}) {
  const source = Array.isArray(materials) ? materials : [];
  const recipes = new Map();
  let originalBytes = 0;
  let optimizedBytes = 0;
  let advancedCount = 0;
  for (const material of source) {
    const footprint = estimateMaterialFootprint(material);
    originalBytes += footprint.estimatedBytes;
    const recipe = deriveMaterialRecipe({ ...context, transparent: bool(material.transparent), animated: bool(material.animated) });
    const multiplier = recipe.useNormalMap ? 1 : 0.82;
    const aoMultiplier = recipe.useAoMap ? 1 : 0.9;
    const estimated = Math.round(footprint.estimatedBytes * multiplier * aoMultiplier);
    optimizedBytes += estimated;
    if (recipe.useAdvancedLayering) advancedCount += 1;
    recipes.set(material.uuid ?? material.name ?? `material-${recipes.size}`, Object.freeze({ recipe, batchKey: buildMaterialBatchKey(material, recipe), originalBytes: footprint.estimatedBytes, optimizedBytes: estimated }));
  }
  return Object.freeze({ materialCount: source.length, originalBytes, optimizedBytes, savedBytes: Math.max(0, originalBytes - optimizedBytes), advancedCount, recipes });
}

export function applyMaterialRecipe(material, recipe = {}) {
  if (!material || typeof material !== 'object') return false;
  if ('normalMap' in material && recipe.useNormalMap === false) material.normalMap = null;
  if ('aoMap' in material && recipe.useAoMap === false) material.aoMap = null;
  if ('emissiveMap' in material && recipe.useEmissive === false) material.emissiveMap = null;
  if ('transparent' in material) material.transparent = bool(recipe.transparent);
  if ('depthWrite' in material) material.depthWrite = recipe.depthWrite !== false;
  if ('needsUpdate' in material) material.needsUpdate = true;
  return true;
}

export function optimizeMaterialSet(materials = [], context = {}) {
  const plan = planMaterialOptimization(materials, context);
  let applied = 0;
  for (const [id, entry] of plan.recipes.entries()) {
    const material = materials.find?.((candidate) => (candidate.uuid ?? candidate.name) === id);
    if (material && applyMaterialRecipe(material, entry.recipe)) applied += 1;
  }
  return Object.freeze({ ...plan, applied });
}

export function validateMaterialRecipe(recipe = {}) {
  return Boolean(recipe && QUALITY[recipe.quality] !== undefined && recipe.mipBias >= -0.25 && recipe.mipBias <= 2.5 && recipe.anisotropy >= 1 && recipe.anisotropy <= 16);
}

export const MATERIAL_QUALITY_RANKS = QUALITY;
export const MATERIAL_MAP_KEYS = MAP_KEYS;
export const MATERIAL_FEATURE_KEYS = FEATURE_KEYS;
