/**
 * Deterministic input buffer over the existing player combat action contract.
 *
 * This module does not own input devices, player state, animation or combat truth.
 * Callers enqueue already-normalized actions from playerCombatActionRouter and drain
 * the bounded window when the authoritative player state is ready to consume them.
 *
 * @module gameplay/playerCombatInputBuffer
 */

const ACTIONS = new Set(['light', 'heavy', 'block', 'parry', 'dodge']);
const DEFAULTS = Object.freeze({ maxEntries: 8, windowMs: 420 });

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.floor(finite(value, fallback));
  return Math.max(min, Math.min(max, parsed));
}

function normalizeAction(action) {
  if (action === 'lightAttack') return 'light';
  if (action === 'heavyAttack') return 'heavy';
  if (action === 'guard') return 'block';
  return typeof action === 'string' ? action.trim().toLowerCase() : '';
}

function normalizeSource(source) {
  return typeof source === 'string' && source.trim() ? source.trim().slice(0, 32) : 'unknown';
}

export function createPlayerCombatInputBuffer({
  now = () => Date.now(),
  maxEntries = DEFAULTS.maxEntries,
  windowMs = DEFAULTS.windowMs,
} = {}) {
  const limit = clampInt(maxEntries, 1, 32, DEFAULTS.maxEntries);
  const ttl = Math.max(1, finite(windowMs, DEFAULTS.windowMs));
  const entries = [];
  let sequence = 0;
  let disposed = false;

  function enqueue(action, source = 'unknown', timestamp = now(), metadata = null) {
    if (disposed) return false;
    const kind = normalizeAction(action);
    if (!ACTIONS.has(kind)) return false;
    const time = finite(timestamp, now());
    const entry = Object.freeze({
      kind,
      source: normalizeSource(source),
      sequence: ++sequence,
      timestamp: time,
      metadata: metadata && typeof metadata === 'object' ? Object.freeze({ ...metadata }) : null,
    });
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return true;
  }

  function prune(currentTime = now()) {
    const time = finite(currentTime, now());
    const cutoff = time - ttl;
    while (entries.length && entries[0].timestamp < cutoff) entries.shift();
    return entries.length;
  }

  function drain({ currentTime = now(), max = limit, accept = null } = {}) {
    if (disposed) return Object.freeze([]);
    prune(currentTime);
    const take = clampInt(max, 0, limit, limit);
    const accepted = typeof accept === 'function' ? accept : () => true;
    const drained = [];
    while (entries.length && drained.length < take) {
      const entry = entries.shift();
      if (accepted(entry)) drained.push(entry);
    }
    return Object.freeze(drained);
  }

  function peek({ currentTime = now(), max = limit } = {}) {
    if (disposed) return Object.freeze([]);
    prune(currentTime);
    return Object.freeze(entries.slice(0, clampInt(max, 0, limit, limit)));
  }

  function reset() {
    entries.length = 0;
    sequence = 0;
  }

  function dispose() {
    disposed = true;
    reset();
  }

  return Object.freeze({ enqueue, prune, drain, peek, reset, dispose });
}

export { ACTIONS as PLAYER_COMBAT_BUFFER_ACTIONS };
