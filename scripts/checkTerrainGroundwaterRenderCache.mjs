#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createGroundwaterRenderCache, groundwaterCacheKey, cacheGroundwaterFrame, invalidateGroundwaterKey, invalidateGroundwaterPolicy, cacheStats, cachePressure, warmGroundwaterCache, compareCachedToFresh, cacheFrameAudit, cacheSignatureManifest } from '../src/3d/world/terrainGroundwaterRenderCache.js';

const BASE = Object.freeze({ worldX: 10, worldZ: -20, heightMeters: 31, slopeDegrees: 6, moisture: .54, rainfall: .6, runoff: .15, soilDepth: 1.1, permeability: .48, waterDistanceMeters: 40, groundwaterDepthMeters: 14, wetDays: 8, dryDays: 4, dayOfYear: 120, temperatureC: 14, drainage: .45, windExposure: .3, substrate: 'loam', biome: 'temperate' });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-cache] PASS: ${name}`); }

check('cache starts empty', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); assert.equal(cache.size, 0); assert.equal(cache.limit, 4); });
check('cache key is deterministic', () => assert.equal(groundwaterCacheKey(BASE), groundwaterCacheKey(BASE)));
check('cache key changes by coordinate', () => assert.notEqual(groundwaterCacheKey(BASE), groundwaterCacheKey({ ...BASE, worldX: 11 })));
check('first cache write is miss', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); const result = cacheGroundwaterFrame(cache, BASE); assert.equal(result.hit, false); assert.equal(cache.size, 1); });
check('second cache read is hit', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); cacheGroundwaterFrame(cache, BASE); const result = cacheGroundwaterFrame(cache, BASE); assert.equal(result.hit, true); assert.equal(cache.size, 1); });
check('cache compare fresh matches signature', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); const result = compareCachedToFresh(cache, BASE); assert.equal(result.signatureEqual, true); assert.equal(result.sourcePolicyEqual, true); });
check('cache audit exposes canonical invariants', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); const result = cacheFrameAudit(cache, BASE); assert.equal(result.canonical.heightUnchanged, true); assert.equal(result.canonical.hydrologyUnchanged, true); assert.equal(result.channelCount, 14); });
check('warm cache counts inserts', () => { const cache = createGroundwaterRenderCache({ maxEntries: 8 }); const inputs = Array.from({ length: 4 }, (_, index) => ({ ...BASE, worldX: index * 20 })); const result = warmGroundwaterCache(cache, inputs); assert.equal(result.inserted, 4); assert.equal(result.hits, 0); });
check('warm cache counts hits on repeat', () => { const cache = createGroundwaterRenderCache({ maxEntries: 8 }); const inputs = Array.from({ length: 4 }, (_, index) => ({ ...BASE, worldX: index * 20 })); warmGroundwaterCache(cache, inputs); const result = warmGroundwaterCache(cache, inputs); assert.equal(result.inserted, 0); assert.equal(result.hits, 4); });
check('LRU trim respects limit', () => { const cache = createGroundwaterRenderCache({ maxEntries: 3 }); for (let index = 0; index < 7; index += 1) cacheGroundwaterFrame(cache, { ...BASE, worldX: index * 31 }); assert.equal(cache.size, 3); });
check('cache delete removes one key', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); cacheGroundwaterFrame(cache, BASE); assert.equal(invalidateGroundwaterKey(cache, BASE), true); assert.equal(cache.size, 0); });
check('cache delete misses unknown key', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); assert.equal(invalidateGroundwaterKey(cache, BASE), false); });
check('cache stats bounded', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); warmGroundwaterCache(cache, [BASE, { ...BASE, worldX: 50 }]); const stats = cacheStats(cache); assert.ok(stats.size <= stats.limit); assert.ok(stats.utilization >= 0 && stats.utilization <= 1); });
check('cache pressure reports warning', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); warmGroundwaterCache(cache, [BASE, { ...BASE, worldX: 50 }, { ...BASE, worldX: 100 }, { ...BASE, worldX: 150 }]); assert.equal(cachePressure(cache, .8).full, true); assert.equal(cachePressure(cache, .8).warning, true); });
check('policy invalidation removes matching keys', () => { const cache = createGroundwaterRenderCache({ maxEntries: 8 }); warmGroundwaterCache(cache, [BASE, { ...BASE, worldX: 50 }]); const removed = invalidateGroundwaterPolicy(cache, 'terrain-groundwater-regime-2026-09-15-v1'); assert.equal(removed, 2); assert.equal(cache.size, 0); });
check('manifest is stable', () => { const cache = createGroundwaterRenderCache({ maxEntries: 4 }); cacheGroundwaterFrame(cache, BASE); assert.deepEqual(cacheSignatureManifest(cache), cacheSignatureManifest(cache)); });

console.log(`[groundwater-cache] PASS: ${checks} checks`);
