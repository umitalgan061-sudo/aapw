/**
 * Bounded, renderer-agnostic asset residency cache.
 *
 * Designed for GLTF/texture/audio/compiled material handles represented by caller-owned values.
 * Tracks approximate weight, pinning, recency and pressure, and exposes deterministic eviction plans.
 * It never disposes Three.js resources automatically; the owner executes the returned evictions.
 */

import { clamp, finiteOr, integerOr } from './modernRuntimeContract.js';

const DEFAULT_CAPACITY_MB = 384;
const DEFAULT_MAX_ITEMS = 2048;

function normalizeWeight(value) {
  return clamp(finiteOr(value, 0), 0, 4096);
}

function createRecord(key, value, metadata, now) {
  return {
    key,
    value,
    weightMb: normalizeWeight(metadata.weightMb),
    type: String(metadata.type || 'unknown'),
    pinned: Boolean(metadata.pinned),
    createdAt: now,
    lastAccessAt: now,
    accessCount: 0,
    tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 16).map(String) : [],
  };
}

export function createAssetResidencyCache(options = {}) {
  const capacityMb = clamp(finiteOr(options.capacityMb, DEFAULT_CAPACITY_MB), 16, 8192);
  const maxItems = clamp(integerOr(options.maxItems, DEFAULT_MAX_ITEMS), 16, 20000);
  const entries = new Map();
  let usedMb = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function get(key, now = 0) {
    const record = entries.get(String(key));
    if (!record) { misses += 1; return null; }
    record.lastAccessAt = Math.max(record.lastAccessAt, finiteOr(now, record.lastAccessAt));
    record.accessCount += 1;
    hits += 1;
    return record.value;
  }

  function has(key) { return entries.has(String(key)); }

  function set(key, value, metadata = {}, now = 0) {
    const normalizedKey = String(key);
    const weightMb = normalizeWeight(metadata.weightMb);
    if (weightMb > capacityMb) return Object.freeze({ stored: false, reason: 'oversized' });
    const existing = entries.get(normalizedKey);
    if (existing) usedMb -= existing.weightMb;
    const record = createRecord(normalizedKey, value, metadata, finiteOr(now, 0));
    entries.set(normalizedKey, record);
    usedMb += record.weightMb;
    const evictionPlan = planEvictions();
    if (entries.size > maxItems || usedMb > capacityMb) {
      executeEvictions(evictionPlan);
    }
    if (usedMb > capacityMb || entries.size > maxItems) {
      entries.delete(normalizedKey);
      usedMb -= record.weightMb;
      return Object.freeze({ stored: false, reason: 'capacity' });
    }
    return Object.freeze({ stored: true, key: normalizedKey, usedMb, evicted: evictionPlan.length });
  }

  function updateMetadata(key, patch = {}) {
    const record = entries.get(String(key));
    if (!record) return false;
    if (patch.weightMb !== undefined) {
      usedMb += normalizeWeight(patch.weightMb) - record.weightMb;
      record.weightMb = normalizeWeight(patch.weightMb);
    }
    if (patch.pinned !== undefined) record.pinned = Boolean(patch.pinned);
    if (patch.tags) record.tags = Array.isArray(patch.tags) ? patch.tags.slice(0, 16).map(String) : record.tags;
    return true;
  }

  function pin(key, value = true) { return updateMetadata(key, { pinned: value }); }

  function planEvictions(targetMb = capacityMb * 0.88) {
    const needsMb = Math.max(0, usedMb - Math.max(0, finiteOr(targetMb, capacityMb * 0.88)));
    const candidates = [...entries.values()]
      .filter((record) => !record.pinned)
      .sort((a, b) => (a.lastAccessAt - b.lastAccessAt) || (a.accessCount - b.accessCount) || (b.weightMb - a.weightMb));
    const plan = [];
    let freed = 0;
    let count = entries.size - maxItems;
    for (const record of candidates) {
      if (freed >= needsMb && count <= 0) break;
      plan.push(Object.freeze({ key: record.key, weightMb: record.weightMb, type: record.type, reason: freed < needsMb ? 'memory-pressure' : 'item-limit' }));
      freed += record.weightMb;
      count -= 1;
    }
    return Object.freeze(plan);
  }

  function executeEvictions(plan = []) {
    for (const item of plan) {
      const record = entries.get(item.key);
      if (!record || record.pinned) continue;
      entries.delete(item.key);
      usedMb -= record.weightMb;
      evictions += 1;
    }
    usedMb = Math.max(0, usedMb);
    return plan.length;
  }

  function remove(key) {
    const normalizedKey = String(key);
    const record = entries.get(normalizedKey);
    if (!record) return false;
    entries.delete(normalizedKey);
    usedMb = Math.max(0, usedMb - record.weightMb);
    return true;
  }

  function clear(predicate) {
    let removed = 0;
    for (const record of [...entries.values()]) {
      if (!predicate || predicate(record)) {
        if (record.pinned && predicate) continue;
        entries.delete(record.key);
        usedMb -= record.weightMb;
        removed += 1;
      }
    }
    usedMb = Math.max(0, usedMb);
    return removed;
  }

  function inspect() {
    const byType = {};
    for (const record of entries.values()) {
      byType[record.type] = (byType[record.type] || 0) + record.weightMb;
    }
    return Object.freeze({
      capacityMb,
      usedMb,
      freeMb: Math.max(0, capacityMb - usedMb),
      itemCount: entries.size,
      maxItems,
      hits,
      misses,
      hitRate: hits + misses ? hits / (hits + misses) : 0,
      evictions,
      pinnedItems: [...entries.values()].filter((record) => record.pinned).length,
      byType: Object.freeze(byType),
      pressure: capacityMb ? usedMb / capacityMb : 1,
    });
  }

  function records() {
    return Object.freeze([...entries.values()].map((record) => Object.freeze({
      key: record.key,
      weightMb: record.weightMb,
      type: record.type,
      pinned: record.pinned,
      createdAt: record.createdAt,
      lastAccessAt: record.lastAccessAt,
      accessCount: record.accessCount,
      tags: [...record.tags],
    })));
  }

  return Object.freeze({ get, set, has, remove, clear, pin, updateMetadata, planEvictions, executeEvictions, inspect, records, get size() { return entries.size; }, get usedMb() { return usedMb; } });
}

export function createResidencyBudgetByQuality(tier = 'medium') {
  const budgets = { minimal: 96, low: 160, medium: 320, high: 512, ultra: 768 };
  return clamp(finiteOr(budgets[tier], budgets.medium), 32, 4096);
}

export function classifyResidencyPressure(usedMb, capacityMb) {
  const ratio = Math.max(0, finiteOr(usedMb, 0)) / Math.max(1, finiteOr(capacityMb, 1));
  if (ratio < 0.65) return 'healthy';
  if (ratio < 0.82) return 'warm';
  if (ratio < 0.94) return 'pressure';
  return 'critical';
}
