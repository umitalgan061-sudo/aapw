/**
 * Deterministic shader/material variant registry.
 *
 * WebGPU migrations often create many subtly different material permutations. This registry turns
 * feature flags into canonical variant keys, tracks bounded compile requests and lets the renderer
 * own actual shader/module compilation. It intentionally knows nothing about Three.js objects.
 *
 * @module shaderVariantRegistry
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value) => String(value ?? '').slice(0, 64);

export const SHADER_VARIANT_FEATURES = freeze([
  'skinning', 'morphing', 'instancing', 'vertexColors', 'normalMap', 'roughnessMap', 'metalnessMap',
  'clearcoat', 'transmission', 'iridescence', 'emissive', 'fog', 'shadow', 'lightmap', 'ambientOcclusion',
  'velocity', 'motionVectors', 'alphaTest', 'doubleSided', 'vertexNormal',
]);

export const SHADER_VARIANT_POLICY = freeze({
  id: 'shader-variant-registry-2026-09-v1',
  maxVariants: 2048,
  maxRequests: 512,
  maxFeatureCount: 32,
  maxSourceLength: 128,
});

function bool(value) { return value === true; }

export function canonicalShaderVariant(features = {}, options = {}) {
  const values = [];
  const source = features && typeof features === 'object' ? features : {};
  for (const feature of SHADER_VARIANT_FEATURES) {
    if (bool(source[feature])) values.push(feature);
  }
  const extras = Array.isArray(options.extraFeatures) ? options.extraFeatures.map(text).filter(Boolean).sort() : [];
  const all = [...new Set([...values, ...extras])].slice(0, SHADER_VARIANT_POLICY.maxFeatureCount);
  const backend = options.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  const quality = text(options.quality || 'balanced');
  const material = text(options.materialFamily || 'standard');
  return `${backend}|${quality}|${material}|${all.join(',')}`;
}

export function parseShaderVariantKey(key) {
  const parts = String(key || '').split('|');
  const backend = parts[0] === 'webgpu' ? 'webgpu' : 'webgl2';
  const quality = parts[1] || 'balanced';
  const materialFamily = parts[2] || 'standard';
  const features = (parts[3] || '').split(',').filter(Boolean).slice(0, SHADER_VARIANT_POLICY.maxFeatureCount);
  return freeze({ backend, quality, materialFamily, features: freeze([...new Set(features)].sort()) });
}

export function createShaderVariantRegistry(options = {}) {
  const policy = freeze({ ...SHADER_VARIANT_POLICY, ...(options.policy || {}) });
  const variants = new Map();
  const requests = new Map();
  let revision = 0;

  function register(key, metadata = {}) {
    const canonical = String(key || '').slice(0, policy.maxSourceLength * 2);
    if (!canonical || (variants.size >= policy.maxVariants && !variants.has(canonical))) return false;
    const existing = variants.get(canonical);
    variants.set(canonical, freeze({
      key: canonical,
      parsed: parseShaderVariantKey(canonical),
      materialPath: text(metadata.materialPath || 'node-material'),
      sourceId: text(metadata.sourceId || canonical),
      estimatedCompileMs: Math.max(0, finite(metadata.estimatedCompileMs, 1)),
      hitCount: (existing?.hitCount || 0),
      lastRequestedFrame: existing?.lastRequestedFrame ?? -1,
    }));
    revision += 1;
    return true;
  }

  function request(features, context = {}) {
    const key = canonicalShaderVariant(features, context);
    register(key, context);
    const existing = requests.get(key) || { count: 0, frames: [] };
    const count = existing.count + 1;
    const frames = [...existing.frames, Math.max(0, Math.floor(finite(context.frame, -1)))].filter((value) => value >= 0).slice(-16);
    requests.set(key, { count, frames });
    const entry = variants.get(key);
    variants.set(key, freeze({ ...(entry || { key, parsed: parseShaderVariantKey(key) }), hitCount: (entry?.hitCount || 0) + 1, lastRequestedFrame: context.frame ?? entry?.lastRequestedFrame ?? -1 }));
    revision += 1;
    return freeze({ key, parsed: parseShaderVariantKey(key), requestCount: count });
  }

  function topVariants(limit = 16) {
    return freeze([...variants.values()].sort((a, b) => (b.hitCount - a.hitCount) || a.key.localeCompare(b.key)).slice(0, Math.max(1, Math.min(64, Math.floor(finite(limit, 16))))));
  }

  function compileBudget({ maxCompileMs = 8, limit = 32 } = {}) {
    let spent = 0;
    const selected = [];
    for (const variant of topVariants(limit)) {
      if (spent + variant.estimatedCompileMs > maxCompileMs && selected.length > 0) continue;
      selected.push(variant);
      spent += variant.estimatedCompileMs;
      if (spent >= maxCompileMs) break;
    }
    return freeze({ maxCompileMs, estimatedMs: Number(spent.toFixed(3)), variants: freeze(selected) });
  }

  function snapshot() {
    return freeze({ policy, revision, variantCount: variants.size, requestCount: requests.size, topVariants: topVariants(32), compileBudget: compileBudget({}) });
  }

  function reset() { variants.clear(); requests.clear(); revision += 1; }
  return freeze({ register, request, topVariants, compileBudget, snapshot, reset, get revision() { return revision; } });
}

export function shaderVariantDigest(variants = []) {
  return (Array.isArray(variants) ? variants : []).map((variant) => `${variant.key}:${variant.hitCount}`).sort().join('|');
}
