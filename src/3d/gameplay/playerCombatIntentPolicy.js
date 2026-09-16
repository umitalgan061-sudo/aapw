/**
 * Deterministic action normalization and priority policy for the existing player combat router.
 * This module owns no state mutation, timers, input listeners, animation mixers or scene objects.
 * @module gameplay/playerCombatIntentPolicy
 */

const ACTION_ALIASES = Object.freeze({
  lightAttack: 'light',
  heavyAttack: 'heavy',
  guardStart: 'guard',
  parryStart: 'parry',
  dodgeRoll: 'dodge',
  rangedAttack: 'ranged',
  bowShot: 'archery',
  lockOnToggle: 'lock-on',
});

const ACTION_PRIORITY = Object.freeze({
  'lock-on': 100,
  parry: 90,
  guard: 80,
  dodge: 70,
  heavy: 60,
  ranged: 50,
  archery: 50,
  light: 40,
});

const ALLOWED_ACTIONS = new Set(Object.keys(ACTION_PRIORITY));
const MAX_SOURCE_LENGTH = 32;

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeCombatAction(action) {
  const raw = typeof action === 'string' ? action.trim() : '';
  const normalized = ACTION_ALIASES[raw] ?? raw;
  return ALLOWED_ACTIONS.has(normalized) ? normalized : null;
}

export function normalizeCombatSource(source) {
  const raw = typeof source === 'string' && source.trim() ? source.trim() : 'unknown';
  return raw.slice(0, MAX_SOURCE_LENGTH);
}

export function createCombatIntent(action, source = 'unknown', timestamp = 0, sequence = 0) {
  const kind = normalizeCombatAction(action);
  if (!kind) return null;
  return Object.freeze({
    kind,
    source: normalizeCombatSource(source),
    timestamp: finiteOr(timestamp, 0),
    sequence: Math.max(0, Math.floor(finiteOr(sequence, 0))),
    priority: ACTION_PRIORITY[kind],
  });
}

export function compareCombatIntent(left, right) {
  if (!left || !right) return 0;
  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  const sequenceDelta = (left.sequence ?? 0) - (right.sequence ?? 0);
  if (sequenceDelta !== 0) return sequenceDelta;
  return (left.timestamp ?? 0) - (right.timestamp ?? 0);
}

export function sortCombatIntents(intents) {
  return Object.freeze(
    [...(Array.isArray(intents) ? intents : [])]
      .filter(Boolean)
      .sort(compareCombatIntent),
  );
}

export function validateCombatIntent(intent) {
  return Boolean(
    intent &&
    ALLOWED_ACTIONS.has(intent.kind) &&
    Number.isFinite(intent.timestamp) &&
    Number.isFinite(intent.sequence) &&
    Number.isFinite(intent.priority) &&
    intent.priority === ACTION_PRIORITY[intent.kind] &&
    typeof intent.source === 'string' &&
    intent.source.length <= MAX_SOURCE_LENGTH,
  );
}

export const COMBAT_INTENT_ACTIONS = Object.freeze([...ALLOWED_ACTIONS]);
export const COMBAT_INTENT_PRIORITIES = ACTION_PRIORITY;
