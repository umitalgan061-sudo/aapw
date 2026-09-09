/**
 * Deterministic action-buffer projection for the existing player combat caller.
 * The caller remains authoritative for input consumption, timers, animation and mutation.
 * @module gameplay/playerCombatActionBuffer
 */

const ACTIONS = new Set(['light', 'heavy', 'dodge', 'block', 'parry', 'ranged', 'interact']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

function normalizeAction(action) {
  const normalized = String(action ?? '').trim().toLowerCase();
  return ACTIONS.has(normalized) ? normalized : null;
}

export function resolvePlayerCombatActionBuffer(input = {}, {
  nowMs = 0,
  bufferWindowMs = 180,
  maxEntries = 3,
  activeAction = null,
  busy = false,
  stunned = false,
  grounded = true,
  staminaRatio = 1,
  allowAirDodge = false,
} = {}) {
  const now = Math.max(0, finite(nowMs, 0));
  const windowMs = clamp(finite(bufferWindowMs, 180), 0, 500);
  const capacity = Math.floor(clamp(finite(maxEntries, 3), 1, 8));
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const rawEntries = Array.isArray(input.entries) ? input.entries : [];
  const entries = [];
  const rejected = [];
  for (const [index, raw] of rawEntries.entries()) {
    const action = normalizeAction(raw?.action ?? raw);
    const timestamp = Math.max(0, finite(raw?.timestampMs ?? raw?.timeMs ?? now, now));
    const ageMs = Math.max(0, now - timestamp);
    if (!action) { rejected.push({ index, reason: 'unsupported-action' }); continue; }
    if (ageMs > windowMs) { rejected.push({ index, action, reason: 'expired' }); continue; }
    if (action === 'dodge' && !grounded && !allowAirDodge) { rejected.push({ index, action, reason: 'airborne' }); continue; }
    if ((action === 'light' || action === 'heavy' || action === 'dodge') && stamina <= 0) { rejected.push({ index, action, reason: 'exhausted' }); continue; }
    entries.push({ action, timestampMs: timestamp, ageMs: Number(ageMs.toFixed(3)), sequence: Number.isFinite(Number(raw?.sequence)) ? Number(raw.sequence) : index });
  }
  entries.sort((a, b) => a.timestampMs - b.timestampMs || a.sequence - b.sequence || a.action.localeCompare(b.action));
  const bounded = entries.slice(-capacity);
  const current = normalizeAction(activeAction);
  const conflict = current && bounded.some((entry) => entry.action === current) ? 'duplicate-active-action' : null;
  const next = bounded.find((entry) => entry.action !== current) ?? null;
  const canConsume = Boolean(next) && !stunned && (!busy || Boolean(current));
  return freeze({
    version: 1,
    nowMs: now,
    bufferWindowMs: windowMs,
    capacity,
    activeAction: current,
    nextAction: next ? next.action : null,
    canConsume,
    consumeReason: stunned ? 'stunned' : !next ? 'empty' : busy && !current ? 'busy' : conflict ? conflict : 'ready',
    entries: freeze(bounded.map((entry) => freeze(entry))),
    rejected: freeze(rejected.map((entry) => freeze(entry))),
    parity: freeze({ keyboardMouse: true, gamepad: true, touch: true, pwa: true }),
  });
}

export function serializePlayerCombatActionBuffer(snapshot) {
  return JSON.stringify(snapshot);
}
