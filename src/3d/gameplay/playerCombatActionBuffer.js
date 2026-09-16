/**
 * Deterministic, bounded action buffer for the existing player combat director.
 *
 * This module normalizes keyboard, mouse, gamepad and touch intent into a single
 * caller-owned queue. It does not mutate player state, timers, animation mixers,
 * equipment, hitboxes or scene objects.
 *
 * @module gameplay/playerCombatActionBuffer
 */

const MAX_QUEUE = 32;
const MAX_ACTION_ID = 64;
const MAX_SOURCE = 24;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalize = (value, fallback) => String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, MAX_ACTION_ID) || fallback;
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const ACTIONS = new Set(['light', 'heavy', 'guard', 'parry', 'dodge', 'ranged', 'archery', 'lock-on']);
const SOURCES = new Set(['keyboard', 'mouse', 'gamepad', 'touch', 'system']);
const PRIORITY = Object.freeze({ 'lock-on': 5, guard: 4, parry: 4, dodge: 3, heavy: 2, ranged: 2, archery: 2, light: 1 });

function normalizeAction(input = {}) {
  const action = normalize(input.action, 'light');
  const source = normalize(input.source, 'system').slice(0, MAX_SOURCE);
  const acceptedAction = ACTIONS.has(action) ? action : 'light';
  const acceptedSource = SOURCES.has(source) ? source : 'system';
  return {
    action: acceptedAction,
    source: acceptedSource,
    pressedAt: clamp(finiteOr(input.pressedAt, 0), 0, 1e12),
    strength: clamp(finiteOr(input.strength, 1), 0, 1),
    sequence: clamp(Math.floor(finiteOr(input.sequence, 0)), 0, 1e9),
    targetId: normalize(input.targetId, ''),
    priority: PRIORITY[acceptedAction] ?? 0,
  };
}

export function createPlayerCombatActionBuffer({ maxQueue = MAX_QUEUE, now = () => 0 } = {}) {
  const capacity = clamp(Math.floor(finiteOr(maxQueue, MAX_QUEUE)), 1, MAX_QUEUE);
  const clock = typeof now === 'function' ? now : () => 0;
  let disposed = false;
  let serial = 0;
  let lastSequence = -1;
  const queue = [];

  const snapshot = (reason = 'snapshot') => freezeDeep({
    reason,
    disposed,
    serial,
    size: queue.length,
    actions: queue.map((entry) => ({ ...entry })),
  });

  return {
    push(input = {}) {
      if (disposed) return snapshot('disposed');
      const action = normalizeAction({ ...input, pressedAt: input.pressedAt ?? clock() });
      if (action.sequence < lastSequence) return snapshot('rejected-sequence');
      lastSequence = action.sequence;
      serial += 1;
      queue.push(freezeDeep({ ...action, serial }));
      queue.sort((a, b) => b.priority - a.priority || a.pressedAt - b.pressedAt || a.serial - b.serial);
      while (queue.length > capacity) queue.pop();
      return snapshot('accepted');
    },
    drain(limit = capacity) {
      if (disposed) return freezeDeep([]);
      const count = clamp(Math.floor(finiteOr(limit, capacity)), 0, capacity);
      return freezeDeep(queue.splice(0, count));
    },
    clear() {
      queue.length = 0;
      return snapshot('cleared');
    },
    inspect() {
      return snapshot('inspect');
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      return snapshot('disposed');
    },
  };
}

export const validatePlayerCombatActionBufferSnapshot = (value) => Boolean(
  value && typeof value === 'object' && Number.isInteger(value.serial) && value.serial >= 0
  && Number.isInteger(value.size) && value.size >= 0 && Array.isArray(value.actions)
  && value.actions.length === value.size
);
