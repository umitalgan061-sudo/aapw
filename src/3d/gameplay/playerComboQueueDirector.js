/**
 * Deterministic combo queue policy over the existing player combat profile.
 * The authoritative player state machine owns timers and mutation; this module
 * only resolves a bounded next-action intent for animation/combat consumers.
 */

const MAX_COMBO = 3;
const ACTIONS = new Set(['light', 'heavy']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeAction = (value) => ACTIONS.has(String(value)) ? String(value) : null;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function stableActionList(value) {
  return Array.isArray(value) ? value.map(normalizeAction).filter(Boolean).slice(0, MAX_COMBO) : [];
}

export function resolvePlayerComboQueue(input = {}) {
  const queue = stableActionList(input.queue);
  const currentAction = normalizeAction(input.currentAction);
  const comboIndex = clamp(Math.trunc(finiteOr(input.comboIndex, 0)), 0, MAX_COMBO - 1);
  const phaseProgress = clamp(finiteOr(input.phaseProgress, 0), 0, 1);
  const queueWindowOpen = input.queueWindowOpen === true || (currentAction && phaseProgress >= 0.58 && phaseProgress <= 0.92);
  const canQueue = input.canQueue !== false && queueWindowOpen && !input.dead && !input.stunned;
  const nextAction = canQueue ? (queue[0] ?? null) : null;
  const accepted = Boolean(nextAction);
  const remainingQueue = accepted ? queue.slice(1) : queue;
  const nextComboIndex = accepted ? Math.min(comboIndex + 1, MAX_COMBO - 1) : comboIndex;
  const resetReason = input.dead ? 'dead' : input.stunned ? 'stunned' : !queueWindowOpen ? 'window-closed' : !canQueue ? 'queue-blocked' : null;
  return freezeDeep({
    currentAction,
    comboIndex,
    phaseProgress,
    queue: Object.freeze(queue),
    queueWindowOpen: Boolean(queueWindowOpen),
    canQueue: Boolean(canQueue),
    accepted,
    nextAction,
    remainingQueue: Object.freeze(remainingQueue),
    nextComboIndex,
    resetReason,
  });
}

export function serializePlayerComboQueue(input = {}) {
  return JSON.stringify(resolvePlayerComboQueue(input));
}
