/**
 * Deterministic arbitration over already-normalized player combat intents.
 * `player.js` and the existing action router remain authoritative for state mutation.
 * This adapter only selects one safe intent for the current frame.
 * @module gameplay/playerCombatIntentArbiter
 */

const ACTIONS = Object.freeze(['dodge', 'parry', 'block', 'heavy', 'light']);
const PRIORITY = Object.freeze({ dodge: 50, parry: 40, block: 30, heavy: 20, light: 10 });
const PHASES = new Set(['idle', 'recovery', 'defense', 'dodge']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeAction(value) {
  const action = String(value || '').toLowerCase();
  if (action === 'lightattack') return 'light';
  if (action === 'heavyattack') return 'heavy';
  if (action === 'guard') return 'block';
  return ACTIONS.includes(action) ? action : null;
}

function normalizeIntent(intent, index) {
  if (!intent || typeof intent !== 'object') return null;
  const action = normalizeAction(intent.action ?? intent.kind ?? intent.type);
  if (!action) return null;
  return Object.freeze({
    action,
    serial: Math.max(0, Math.floor(finite(intent.serial, index))),
    pressedAt: Math.max(0, finite(intent.pressedAt ?? intent.timestamp, 0)),
    staminaCost: Math.max(0, finite(intent.staminaCost, action === 'heavy' ? 24 : action === 'dodge' ? 18 : 0)),
    requiresIdle: Boolean(intent.requiresIdle ?? (action === 'light' || action === 'heavy')),
  });
}

export function arbitratePlayerCombatIntent({ intents = [], phase = 'idle', stamina = 1, parryWindow = 0, dodgeCooldown = 0, maxChoices = 1 } = {}) {
  const currentPhase = String(phase || 'idle');
  const safeStamina = clamp(finite(stamina, 1), 0, 100);
  const safeParryWindow = Math.max(0, finite(parryWindow, 0));
  const safeDodgeCooldown = Math.max(0, finite(dodgeCooldown, 0));
  const limit = clamp(Math.floor(finite(maxChoices, 1)), 1, 4);
  const candidates = [];
  for (let index = 0; index < Math.min(intents.length, 32); index += 1) {
    const normalized = normalizeIntent(intents[index], index);
    if (!normalized) continue;
    if (normalized.requiresIdle && !PHASES.has(currentPhase)) continue;
    if (normalized.action === 'dodge' && safeDodgeCooldown > 0) continue;
    if (normalized.action === 'parry' && safeParryWindow <= 0) continue;
    if (normalized.staminaCost > safeStamina) continue;
    candidates.push(normalized);
  }
  candidates.sort((left, right) => (
    (PRIORITY[right.action] - PRIORITY[left.action])
      || (left.pressedAt - right.pressedAt)
      || (left.serial - right.serial)
  ));
  const selected = candidates.slice(0, limit);
  return Object.freeze({
    phase: currentPhase,
    stamina: safeStamina,
    selected: Object.freeze(selected),
    dropped: Math.max(0, candidates.length - selected.length),
    reason: selected.length === 0 ? 'no-safe-intent' : 'priority-and-gates',
  });
}

export function validatePlayerCombatIntentDecision(decision) {
  if (!decision || typeof decision !== 'object') return false;
  if (!Array.isArray(decision.selected) || decision.selected.length > 4) return false;
  return decision.selected.every((entry) => ACTIONS.includes(entry.action)
    && Number.isFinite(entry.staminaCost)
    && entry.staminaCost >= 0);
}
