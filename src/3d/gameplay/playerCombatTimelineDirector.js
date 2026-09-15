/**
 * Deterministic projection of the shipped player's attack-window and combat-feedback events.
 * The player runtime remains authoritative for state, timing, animation, hitboxes and damage.
 * @module gameplay/playerCombatTimelineDirector
 */

const ATTACK_EVENT = 'aapw:player-attack-window';
const FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const DEFAULT_HISTORY_LIMIT = 24;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeDetail(detail, kind) {
  const raw = detail && typeof detail === 'object' ? detail : {};
  if (kind === 'attack') {
    return Object.freeze({
      serial: Math.max(0, Math.floor(finite(raw.serial))),
      phase: typeof raw.phase === 'string' ? raw.phase : 'unknown',
      attackKind: typeof raw.kind === 'string' ? raw.kind : 'none',
      comboStep: clamp(Math.floor(finite(raw.comboStep, 1)), 0, 3),
      active: raw.active === true,
      stamina: clamp(finite(raw.stamina), 0, 100),
      reachMeters: clamp(finite(raw.reachMeters), 0, 10),
      damageScale: clamp(finite(raw.damageScale, 1), 0, 10),
      position: Object.freeze({
        x: finite(raw.position?.x),
        y: finite(raw.position?.y),
        z: finite(raw.position?.z),
      }),
    });
  }
  return Object.freeze({
    serial: Math.max(0, Math.floor(finite(raw.serial))),
    outcome: typeof raw.outcome === 'string' ? raw.outcome : 'unknown',
    rawAmount: clamp(finite(raw.rawAmount), 0, 100000),
    appliedAmount: clamp(finite(raw.appliedAmount), 0, 100000),
    blockedAmount: clamp(finite(raw.blockedAmount), 0, 100000),
    stamina: clamp(finite(raw.stamina), 0, 100),
    poise: clamp(finite(raw.poise), 0, 100),
    state: typeof raw.state === 'string' ? raw.state : 'unknown',
  });
}

function stableEvent(kind, detail, ordinal) {
  return Object.freeze({ kind, ordinal, detail: normalizeDetail(detail, kind) });
}

export function createPlayerCombatTimelineDirector({ target = globalThis, historyLimit = DEFAULT_HISTORY_LIMIT } = {}) {
  const limit = clamp(Math.floor(finite(historyLimit, DEFAULT_HISTORY_LIMIT)), 4, 64);
  const history = [];
  let nextOrdinal = 1;
  let attached = false;
  let latestAttack = null;
  let latestFeedback = null;

  const onAttack = (event) => {
    latestAttack = stableEvent('attack', event?.detail, nextOrdinal++);
    history.push(latestAttack);
    if (history.length > limit) history.splice(0, history.length - limit);
  };
  const onFeedback = (event) => {
    latestFeedback = stableEvent('feedback', event?.detail, nextOrdinal++);
    history.push(latestFeedback);
    if (history.length > limit) history.splice(0, history.length - limit);
  };

  function attach() {
    if (attached || !target || typeof target.addEventListener !== 'function') return false;
    target.addEventListener(ATTACK_EVENT, onAttack);
    target.addEventListener(FEEDBACK_EVENT, onFeedback);
    attached = true;
    return true;
  }

  function detach() {
    if (!attached || !target || typeof target.removeEventListener !== 'function') return false;
    target.removeEventListener(ATTACK_EVENT, onAttack);
    target.removeEventListener(FEEDBACK_EVENT, onFeedback);
    attached = false;
    return true;
  }

  function reset() {
    history.length = 0;
    latestAttack = null;
    latestFeedback = null;
    nextOrdinal = 1;
  }

  function snapshot() {
    const orderedHistory = history.slice().sort((a, b) => a.ordinal - b.ordinal);
    return Object.freeze({
      attached,
      historyLimit: limit,
      eventCount: orderedHistory.length,
      attackEventCount: orderedHistory.filter((entry) => entry.kind === 'attack').length,
      feedbackEventCount: orderedHistory.filter((entry) => entry.kind === 'feedback').length,
      latestAttack,
      latestFeedback,
      history: Object.freeze(orderedHistory),
    });
  }

  return Object.freeze({ attach, detach, reset, snapshot });
}

export function stableSerializePlayerCombatTimeline(snapshot) {
  return JSON.stringify(snapshot, Object.keys(snapshot).sort());
}
