/**
 * Predictive asset residency cache with deterministic recency/priority eviction.
 *
 * The cache tracks metadata only; AssetLoader remains responsible for network and decoding. A caller
 * may reserve an asset for a near-term visual need and release it after use. Eviction is bounded and
 * never deletes currently pinned records. This creates a safe place for future GLB/texture streaming,
 * while keeping the existing loader contract intact.
 * @module assetResidencyCache
 */

export const ASSET_CACHE_DEFAULTS = Object.freeze({
  capacity: 128,
  historySize: 64,
  staleFrames: 900,
  reserveFrames: 120,
  maxBytes: 512 * 1024 * 1024,
});

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function idOf(record) { return String(record?.id ?? record?.url ?? 'asset:unknown'); }
function tierWeight(tier) { return tier === 'hero' ? 4 : tier === 'near' ? 3 : tier === 'mid' ? 2 : 1; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, n(v, lo))); }

function evictionScore(entry, frame) {
  const age = Math.max(0, frame - entry.lastUsedFrame);
  const recency = clamp(1 - age / 1200, 0, 1);
  const reservation = entry.pinned ? 1 : clamp(1 - Math.max(0, entry.reservedUntilFrame - frame) / 120, 0, 1);
  const priority = clamp(entry.priority / 100, 0, 1);
  const sizePenalty = clamp(entry.bytes / (32 * 1024 * 1024), 0, 1);
  return Number((recency * 0.42 + reservation * 0.28 + priority * 0.38 - sizePenalty * 0.08).toFixed(6));
}

function sortEviction(a, b) {
  if (a.score !== b.score) return a.score - b.score;
  if (a.lastUsedFrame !== b.lastUsedFrame) return a.lastUsedFrame - b.lastUsedFrame;
  return a.id.localeCompare(b.id);
}

export function normalizeAssetRecord(record, frame = 0) {
  const id = idOf(record);
  return Object.freeze({
    id,
    url: record?.url ? String(record.url) : null,
    kind: String(record?.kind ?? 'unknown'),
    tier: String(record?.tier ?? 'mid'),
    bytes: Math.max(0, Math.trunc(n(record?.bytes, 0))),
    priority: clamp(record?.priority, 0, 100),
    pinned: Boolean(record?.pinned),
    reservedUntilFrame: Math.max(frame, Math.trunc(n(record?.reservedUntilFrame, frame))),
    lastUsedFrame: Math.max(0, Math.trunc(n(record?.lastUsedFrame, frame))),
    createdFrame: Math.max(0, Math.trunc(n(record?.createdFrame, frame))),
    hits: Math.max(0, Math.trunc(n(record?.hits, 0))),
    misses: Math.max(0, Math.trunc(n(record?.misses, 0))),
    state: String(record?.state ?? 'resident'),
    payload: record?.payload ?? null,
  });
}

export function rankAssetEviction(records, frame = 0) {
  return [...(Array.isArray(records) ? records : [])]
    .map((record) => {
      const normalized = normalizeAssetRecord(record, frame);
      return { ...normalized, score: evictionScore(normalized, frame) };
    })
    .sort(sortEviction);
}

export function selectEvictions(records, { frame = 0, capacity = ASSET_CACHE_DEFAULTS.capacity, maxBytes = ASSET_CACHE_DEFAULTS.maxBytes } = {}) {
  const ranked = rankAssetEviction(records, frame);
  let count = ranked.length;
  let bytes = ranked.reduce((sum, entry) => sum + entry.bytes, 0);
  const evicted = [];
  for (const entry of ranked) {
    if (count <= capacity && bytes <= maxBytes) break;
    if (entry.pinned || entry.reservedUntilFrame > frame) continue;
    evicted.push(entry);
    count -= 1;
    bytes -= entry.bytes;
  }
  return Object.freeze({
    evicted: Object.freeze(evicted),
    residentCount: Math.max(0, count),
    residentBytes: Math.max(0, bytes),
    rankedCount: ranked.length,
  });
}

export function createAssetResidencyCache(options = {}) {
  const config = { ...ASSET_CACHE_DEFAULTS, ...options };
  const entries = new Map();
  const history = [];
  let frame = 0;
  let hits = 0;
  let misses = 0;
  let disposed = false;

  function recordEvent(type, id, extra = {}) {
    history.push(Object.freeze({ frame, type, id, ...extra }));
    while (history.length > config.historySize) history.shift();
  }

  function get(id) {
    if (disposed) throw new Error('ASSET_RESIDENCY_CACHE_DISPOSED');
    const key = String(id);
    const found = entries.get(key);
    if (!found) {
      misses += 1;
      recordEvent('miss', key);
      return null;
    }
    found.lastUsedFrame = frame;
    found.hits += 1;
    hits += 1;
    recordEvent('hit', key);
    return Object.freeze({ ...found });
  }

  function put(record) {
    if (disposed) throw new Error('ASSET_RESIDENCY_CACHE_DISPOSED');
    const normalized = normalizeAssetRecord({ ...record, lastUsedFrame: frame, createdFrame: record.createdFrame ?? frame }, frame);
    entries.set(normalized.id, { ...normalized });
    recordEvent('put', normalized.id, { bytes: normalized.bytes, tier: normalized.tier });
    return normalized;
  }

  function reserve(id, frames = config.reserveFrames) {
    const key = String(id);
    const entry = entries.get(key);
    if (!entry) return false;
    entry.reservedUntilFrame = Math.max(entry.reservedUntilFrame, frame + Math.max(0, Math.trunc(frames)));
    entry.lastUsedFrame = frame;
    recordEvent('reserve', key, { until: entry.reservedUntilFrame });
    return true;
  }

  function pin(id, pinned = true) {
    const entry = entries.get(String(id));
    if (!entry) return false;
    entry.pinned = Boolean(pinned);
    recordEvent(pinned ? 'pin' : 'unpin', entry.id);
    return true;
  }

  function remove(id, reason = 'manual') {
    const key = String(id);
    const entry = entries.get(key);
    if (!entry) return false;
    if (entry.pinned) return false;
    entries.delete(key);
    recordEvent('remove', key, { reason });
    return true;
  }

  function advance(nextFrame = frame + 1) {
    if (disposed) throw new Error('ASSET_RESIDENCY_CACHE_DISPOSED');
    frame = Math.max(frame, Math.trunc(n(nextFrame, frame + 1)));
    const stale = [];
    for (const entry of entries.values()) {
      if (!entry.pinned && entry.reservedUntilFrame <= frame && frame - entry.lastUsedFrame > config.staleFrames) stale.push(entry.id);
    }
    for (const id of stale) remove(id, 'stale');
    return stale.length;
  }

  function evictToBudget() {
    const selected = selectEvictions([...entries.values()], { frame, capacity: config.capacity, maxBytes: config.maxBytes });
    for (const entry of selected.evicted) remove(entry.id, 'budget');
    return selected;
  }

  function snapshot() {
    const list = [...entries.values()];
    const bytes = list.reduce((sum, entry) => sum + entry.bytes, 0);
    return Object.freeze({
      frame,
      count: list.length,
      bytes,
      hits,
      misses,
      hitRate: hits + misses ? Number((hits / (hits + misses)).toFixed(4)) : 1,
      pinnedCount: list.filter((entry) => entry.pinned).length,
      reservedCount: list.filter((entry) => entry.reservedUntilFrame > frame).length,
      capacity: config.capacity,
      maxBytes: config.maxBytes,
      history: Object.freeze(history.slice(-16)),
    });
  }

  return {
    get,
    put,
    reserve,
    pin,
    remove,
    advance,
    evictToBudget,
    has(id) { return entries.has(String(id)); },
    size() { return entries.size; },
    snapshot,
    reset() { entries.clear(); history.length = 0; frame = 0; hits = 0; misses = 0; },
    dispose() { disposed = true; entries.clear(); history.length = 0; },
  };
}

export function assetTierWeight(tier) { return tierWeight(String(tier)); }
export function validateAssetBudget(snapshot) { return Boolean(snapshot && snapshot.count >= 0 && snapshot.bytes >= 0 && snapshot.count <= snapshot.capacity && snapshot.bytes <= snapshot.maxBytes); }
