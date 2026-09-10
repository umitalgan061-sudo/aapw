const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function normalizeEntry(entry = {}, index = 0) {
  const action = typeof entry.action === 'string' ? entry.action : 'none';
  const source = typeof entry.source === 'string' ? entry.source : 'unknown';
  return {
    action,
    source,
    pressed: entry.pressed === true,
    held: entry.held === true,
    strength: clamp(finite(entry.strength, 0), 0, 1),
    serial: Math.max(0, Math.floor(finite(entry.serial, index))),
  };
}

export function createPlayerCombatIntentQueue(options = {}) {
  const capacity = Math.max(1, Math.floor(finite(options.capacity, 8)));
  const pending = [];
  let sequence = 0;

  const push = (intent = {}) => {
    const normalized = normalizeEntry(intent, sequence);
    if (normalized.action === 'none' || (!normalized.pressed && !normalized.held)) return false;
    pending.push({ ...normalized, sequence });
    sequence += 1;
    if (pending.length > capacity) pending.splice(0, pending.length - capacity);
    return true;
  };

  const drain = (limit = capacity) => {
    const take = Math.max(0, Math.floor(finite(limit, capacity)));
    const entries = pending.splice(0, take).map((entry) => ({ ...entry }));
    return freeze(entries);
  };

  const peek = () => freeze(pending.map((entry) => ({ ...entry })));
  const clear = () => { pending.length = 0; };
  const size = () => pending.length;

  return Object.freeze({ push, drain, peek, clear, size });
}

export function validatePlayerCombatIntentQueue(queue) {
  return Boolean(queue && typeof queue.push === 'function' && typeof queue.drain === 'function'
    && typeof queue.peek === 'function' && typeof queue.clear === 'function'
    && typeof queue.size === 'function');
}
