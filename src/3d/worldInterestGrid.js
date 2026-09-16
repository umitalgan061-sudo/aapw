/**
 * Deterministic spatial interest grid for nearby-world queries.
 *
 * Replaces repeated O(n) radius scans at the orchestration layer without taking ownership of entity
 * transforms. Registrations contain the caller's id and coordinate snapshot; callers remain free to
 * keep authoritative positions elsewhere. The grid supports batched refresh and stable query order.
 * @module worldInterestGrid
 */

export const INTEREST_GRID_DEFAULTS = Object.freeze({ cellSizeMeters: 64, maxEntriesPerCell: 256, maxQueryResults: 512, historySize: 32 });
function n(v, f = 0) { return Number.isFinite(Number(v)) ? Number(v) : f; }
function key(x, z) { return `${Math.trunc(x)}:${Math.trunc(z)}`; }
function cellOf(x, z, size) { return { x: Math.floor(n(x) / Math.max(1, size)), z: Math.floor(n(z) / Math.max(1, size)) }; }
function distSq(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

function normalize(entry) {
  return {
    id: String(entry?.id ?? ''),
    x: n(entry?.x),
    z: n(entry?.z),
    kind: String(entry?.kind ?? 'unknown'),
    priority: n(entry?.priority, 0),
    active: entry?.active !== false,
    metadata: entry?.metadata ?? null,
  };
}

export function createWorldInterestGrid(options = {}) {
  const config = { ...INTEREST_GRID_DEFAULTS, ...options };
  const cells = new Map();
  const entries = new Map();
  const history = [];
  let frame = 0;
  let disposed = false;

  function cellKeyFor(x, z) { const cell = cellOf(x, z, config.cellSizeMeters); return key(cell.x, cell.z); }
  function ensureCell(cellKey) { if (!cells.has(cellKey)) cells.set(cellKey, new Map()); return cells.get(cellKey); }
  function log(type, id) { history.push(Object.freeze({ frame, type, id })); while (history.length > config.historySize) history.shift(); }

  function register(entry) {
    if (disposed) throw new Error('WORLD_INTEREST_GRID_DISPOSED');
    const normalized = normalize(entry);
    if (!normalized.id) throw new TypeError('interest entry id is required');
    unregister(normalized.id);
    const cellKey = cellKeyFor(normalized.x, normalized.z);
    const cell = ensureCell(cellKey);
    if (cell.size >= config.maxEntriesPerCell) return { accepted: false, reason: 'cell-cap', id: normalized.id };
    const record = { ...normalized, cellKey };
    cell.set(record.id, record);
    entries.set(record.id, record);
    log('register', record.id);
    return { accepted: true, id: record.id, cellKey };
  }

  function unregister(id) {
    const record = entries.get(String(id));
    if (!record) return false;
    const cell = cells.get(record.cellKey);
    cell?.delete(record.id);
    if (cell?.size === 0) cells.delete(record.cellKey);
    entries.delete(record.id);
    log('unregister', record.id);
    return true;
  }

  function update(entry) { return register(entry); }

  function queryRadius(x, z, radiusMeters, predicate = null) {
    if (disposed) throw new Error('WORLD_INTEREST_GRID_DISPOSED');
    const radius = Math.max(0, n(radiusMeters));
    const size = Math.max(1, config.cellSizeMeters);
    const center = cellOf(x, z, size);
    const span = Math.ceil(radius / size);
    const result = [];
    const radiusSquared = radius * radius;
    for (let dz = -span; dz <= span; dz += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const cell = cells.get(key(center.x + dx, center.z + dz));
        if (!cell) continue;
        for (const record of cell.values()) {
          if (!record.active || distSq(n(x), n(z), record.x, record.z) > radiusSquared) continue;
          if (typeof predicate === 'function' && !predicate(record)) continue;
          result.push(record);
          if (result.length >= config.maxQueryResults) break;
        }
        if (result.length >= config.maxQueryResults) break;
      }
      if (result.length >= config.maxQueryResults) break;
    }
    result.sort((a, b) => {
      const d = distSq(n(x), n(z), a.x, a.z) - distSq(n(x), n(z), b.x, b.z);
      if (d !== 0) return d;
      return a.id.localeCompare(b.id);
    });
    return Object.freeze(result.map((item) => Object.freeze({ ...item })));
  }

  function queryKinds(x, z, radiusMeters, kinds = []) {
    const set = new Set(kinds.map(String));
    return queryRadius(x, z, radiusMeters, (entry) => set.size === 0 || set.has(entry.kind));
  }

  function refresh(frameEntries = []) {
    frame += 1;
    const accepted = new Set();
    for (const entry of frameEntries) {
      const result = register(entry);
      if (result.accepted) accepted.add(String(entry.id));
    }
    for (const id of [...entries.keys()]) if (!accepted.has(id)) unregister(id);
    return { frame, accepted: accepted.size, total: entries.size };
  }

  return {
    register,
    update,
    unregister,
    queryRadius,
    queryKinds,
    refresh,
    advance(nextFrame = frame + 1) { frame = Math.max(frame, Math.trunc(n(nextFrame, frame + 1))); },
    get(id) { const entry = entries.get(String(id)); return entry ? Object.freeze({ ...entry }) : null; },
    size() { return entries.size; },
    cellCount() { return cells.size; },
    snapshot() {
      return Object.freeze({ frame, entries: entries.size, cells: cells.size, maxEntriesPerCell: config.maxEntriesPerCell, recentEvents: Object.freeze(history.slice(-12)) });
    },
    reset() { cells.clear(); entries.clear(); history.length = 0; frame = 0; },
    dispose() { disposed = true; cells.clear(); entries.clear(); history.length = 0; },
  };
}

export function buildInterestCellCoord(x, z, cellSize = 64) { return cellOf(x, z, cellSize); }
export function validateInterestQuery(results) { return Array.isArray(results) && new Set(results.map((result) => result.id)).size === results.length; }
