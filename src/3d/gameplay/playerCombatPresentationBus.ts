/** Production TypeScript owner for the player combat presentation bus. */
// @ts-nocheck

const ATTACK_WINDOW_EVENT = 'aapw:player-attack-window';
const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const MAX_HISTORY = 24;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, places = 4) => Number(finite(value, 0).toFixed(places));
const freeze = (value) => Object.freeze(value);

function normalizeVector(value) {
  return freeze({
    x: round(value?.x, 4),
    y: round(value?.y, 4),
    z: round(value?.z, 4),
  });
}

function normalizeAttack(detail = {}) {
  const phase = ['start', 'active-start', 'active-end', 'recovery', 'interrupted', 'complete'].includes(detail.phase) ? detail.phase : 'unknown';
  return freeze({
    serial: Math.max(0, Math.floor(finite(detail.serial, 0))),
    kind: detail.kind === 'heavy' ? 'heavy' : detail.kind === 'light' ? 'light' : 'none',
    comboStep: clamp(Math.floor(finite(detail.comboStep, 0)), 0, 3),
    phase,
    active: Boolean(detail.active),
    stamina: round(clamp(detail.stamina, 0, 100), 2),
    reachMeters: round(clamp(detail.reachMeters, 0, 8), 3),
    damageScale: round(clamp(detail.damageScale, 0, 8), 3),
    commitRemainingMeters: round(clamp(detail.commitRemainingMeters, 0, 8), 3),
    position: normalizeVector(detail.position),
    facing: freeze({ x: round(detail.facing?.x, 4), z: round(detail.facing?.z, 4) }),
  });
}

function normalizeFeedback(detail = {}) {
  const outcome = ['hit', 'blocked', 'parried', 'dodged', 'miss', 'staggered', 'guard-break'].includes(detail.outcome) ? detail.outcome : 'none';
  return freeze({
    serial: Math.max(0, Math.floor(finite(detail.serial, 0))),
    outcome,
    rawAmount: round(clamp(detail.rawAmount, 0, 10000), 4),
    appliedAmount: round(clamp(detail.appliedAmount, 0, 10000), 4),
    blockedAmount: round(clamp(detail.blockedAmount, 0, 10000), 4),
    stamina: round(clamp(detail.stamina, 0, 100), 2),
    poise: round(clamp(detail.poise, 0, 100), 2),
    state: typeof detail.state === 'string' ? detail.state.slice(0, 32) : 'unknown',
    position: normalizeVector(detail.position),
  });
}

function hashKey(snapshot) {
  const text = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `combat-presentation-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createPlayerCombatPresentationBus({ target = globalThis, maxHistory = MAX_HISTORY } = {}) {
  const historyLimit = clamp(Math.floor(finite(maxHistory, MAX_HISTORY)), 1, 64);
  const attacks = [];
  const feedback = [];
  let attached = false;

  const onAttack = (event) => {
    attacks.push(normalizeAttack(event?.detail));
    while (attacks.length > historyLimit) attacks.shift();
  };
  const onFeedback = (event) => {
    feedback.push(normalizeFeedback(event?.detail));
    while (feedback.length > historyLimit) feedback.shift();
  };

  function attach() {
    if (attached || !target || typeof target.addEventListener !== 'function') return false;
    target.addEventListener(ATTACK_WINDOW_EVENT, onAttack);
    target.addEventListener(COMBAT_FEEDBACK_EVENT, onFeedback);
    attached = true;
    return true;
  }

  function detach() {
    if (!attached || !target || typeof target.removeEventListener !== 'function') return false;
    target.removeEventListener(ATTACK_WINDOW_EVENT, onAttack);
    target.removeEventListener(COMBAT_FEEDBACK_EVENT, onFeedback);
    attached = false;
    return true;
  }

  function snapshot() {
    const latestAttack = attacks.at(-1) ?? null;
    const latestFeedback = feedback.at(-1) ?? null;
    const attackHistory = freeze([...attacks]);
    const feedbackHistory = freeze([...feedback]);
    const value = {
      attached,
      latestAttack,
      latestFeedback,
      attackHistory,
      feedbackHistory,
      key: hashKey({ attached, attackHistory, feedbackHistory }),
    };
    return freeze(value);
  }

  function clear() {
    attacks.length = 0;
    feedback.length = 0;
    return snapshot();
  }

  return freeze({ attach, detach, snapshot, clear });
}

export function isPlayerCombatPresentationSnapshot(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.attached === 'boolean'
    && Array.isArray(value.attackHistory)
    && Array.isArray(value.feedbackHistory)
    && typeof value.key === 'string'
    && (value.latestAttack === null || typeof value.latestAttack === 'object')
    && (value.latestFeedback === null || typeof value.latestFeedback === 'object');
}

export { ATTACK_WINDOW_EVENT, COMBAT_FEEDBACK_EVENT };
