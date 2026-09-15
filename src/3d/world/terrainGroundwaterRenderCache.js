/**
 * Small deterministic render-cache helpers for groundwater frames.
 *
 * The cache stores presentation frames only. It does not own terrain data,
 * water topology, entity state, or simulation time. A caller can use the key
 * helpers with its existing tile/material cache without creating a second
 * world authority.
 */
import { TERRAIN_GROUNDWATER_POLICY, resolveTerrainGroundwaterState, terrainGroundwaterSignature } from './terrainGroundwaterRegime.js';
import { resolveGroundwaterSurfaceFrame } from './terrainGroundwaterSurfaceAdapter.js';

const freeze = Object.freeze;
const safe = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, safe(value)));

export const TERRAIN_GROUNDWATER_CACHE_POLICY = freeze({
  id: 'terrain-groundwater-render-cache-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  renderOnly: true,
  deterministic: true,
  keyVersion: 1,
  maxEntriesDefault: 256,
});

export function groundwaterCacheKey(input = {}, options = {}) {
  const signature = terrainGroundwaterSignature(input);
  const baseMaterialKey = typeof options.materialKey === 'string' ? options.materialKey : 'terrain-default-material';
  const layerKey = typeof options.layerKey === 'string' ? options.layerKey : TERRAIN_GROUNDWATER_POLICY.materialKey;
  return [
    TERRAIN_GROUNDWATER_CACHE_POLICY.keyVersion,
    layerKey,
    baseMaterialKey,
    signature.policyId,
    input.worldX ?? 0,
    input.worldZ ?? 0,
    input.dayOfYear ?? 0,
    input.groundwaterDepthMeters ?? 0,
    input.waterDistanceMeters ?? 0,
  ].join('|');
}

export function groundwaterCacheEntry(input = {}, options = {}) {
  const frame = resolveGroundwaterSurfaceFrame(input);
  return freeze({
    key: groundwaterCacheKey(input, options),
    createdFromPolicyId: TERRAIN_GROUNDWATER_CACHE_POLICY.id,
    sourcePolicyId: frame.sourcePolicyId,
    frame,
  });
}

export function createGroundwaterRenderCache({ maxEntries = TERRAIN_GROUNDWATER_CACHE_POLICY.maxEntriesDefault } = {}) {
  const limit = Math.max(1, Math.floor(safe(maxEntries, TERRAIN_GROUNDWATER_CACHE_POLICY.maxEntriesDefault)));
  const map = new Map();
  const order = [];
  const touch = (key) => { const index = order.indexOf(key); if (index >= 0) order.splice(index, 1); order.push(key); };
  const trim = () => { while (order.length > limit) { const oldest = order.shift(); map.delete(oldest); } };
  return {
    get size() { return map.size; },
    get limit() { return limit; },
    get(key) { if (!map.has(key)) return undefined; const value = map.get(key); touch(key); return value; },
    has(key) { return map.has(key); },
    set(key, value) { if (typeof key !== 'string') throw new TypeError('groundwater cache key must be a string'); map.set(key, value); touch(key); trim(); return value; },
    delete(key) { const removed = map.delete(key); const index = order.indexOf(key); if (index >= 0) order.splice(index, 1); return removed; },
    clear() { map.clear(); order.length = 0; },
    keys() { return [...order]; },
    snapshot() { return freeze([...order].map((key) => freeze({ key, present: map.has(key) }))); },
  };
}

export function cacheGroundwaterFrame(cache, input = {}, options = {}) {
  const key = groundwaterCacheKey(input, options);
  const cached = cache.get(key);
  if (cached) return freeze({ hit: true, key, entry: cached });
  const entry = groundwaterCacheEntry(input, options);
  cache.set(key, entry);
  return freeze({ hit: false, key, entry });
}

export function invalidateGroundwaterKey(cache, input = {}, options = {}) {
  return cache.delete(groundwaterCacheKey(input, options));
}

export function invalidateGroundwaterPolicy(cache, policyId = TERRAIN_GROUNDWATER_POLICY.id) {
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.includes(`|${policyId}|`)) {
      if (cache.delete(key)) removed += 1;
    }
  }
  return removed;
}

export function cacheStats(cache) {
  return freeze({ size: cache.size, limit: cache.limit, utilization: cache.size / Math.max(cache.limit, 1), keys: cache.keys() });
}

export function cacheUtilization(cache) { return clamp01(cache.size / Math.max(cache.limit, 1)); }

export function cachePressure(cache, warningThreshold = .82) {
  const utilization = cacheUtilization(cache);
  const threshold = clamp01(warningThreshold);
  return freeze({ utilization, threshold, warning: utilization >= threshold, full: utilization >= 1 });
}

export function warmGroundwaterCache(cache, inputs = [], options = {}) {
  if (!Array.isArray(inputs)) return freeze({ inserted: 0, hits: 0, total: 0 });
  let inserted = 0;
  let hits = 0;
  for (const input of inputs) {
    const result = cacheGroundwaterFrame(cache, input, options);
    if (result.hit) hits += 1;
    else inserted += 1;
  }
  return freeze({ inserted, hits, total: inputs.length, stats: cacheStats(cache) });
}

export function readGroundwaterCacheOrResolve(cache, input = {}, options = {}) {
  const result = cacheGroundwaterFrame(cache, input, options);
  return result.entry.frame;
}

export function compareCachedToFresh(cache, input = {}, options = {}) {
  const cached = readGroundwaterCacheOrResolve(cache, input, options);
  const fresh = resolveGroundwaterSurfaceFrame(input);
  const cachedSignature = terrainGroundwaterSignature(cached.state.sample);
  const freshSignature = terrainGroundwaterSignature(input);
  return freeze({ signatureEqual: JSON.stringify(cachedSignature) === JSON.stringify(freshSignature), sourcePolicyEqual: cached.sourcePolicyId === fresh.sourcePolicyId, cached, fresh });
}

export function cacheFrameAudit(cache, input = {}, options = {}) {
  const result = cacheGroundwaterFrame(cache, input, options);
  const frame = result.entry.frame;
  return freeze({
    hit: result.hit,
    key: result.key,
    sourcePolicyId: frame.sourcePolicyId,
    canonical: frame.canonical,
    channelCount: Object.keys(frame.channels).length,
    material: freeze({ roughness: frame.material.roughness, normalStrength: frame.material.normalStrength, wetness: frame.material.wetness }),
    cache: cachePressure(cache),
  });
}

export function cacheSignatureManifest(cache) {
  return freeze(cache.keys().map((key) => freeze({ key, policyId: TERRAIN_GROUNDWATER_CACHE_POLICY.id })));
}
