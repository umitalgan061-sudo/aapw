/**
 * Read-only observer for the existing player combat event stream.
 * It never owns combat state, timers, animation or scene mutation.
 * @module gameplay/playerCombatObserver
 */

const DEFAULT_LIMIT = 32;
const MAX_LIMIT = 128;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeKind = (value) => value === 'heavy' ? 'heavy' : value === 'light' ? 'light' : 'none';
const normalizePhase = (value) => typeof value === 'string' && value.length > 0 ? value.slice(0, 32) : 'unknown';
const normalizeOutcome = (value) => typeof value === 'string' && value.length > 0 ? value.slice(0, 32) : 'unknown';
const clonePosition = (position) => Object.freeze({
  x: finite(position?.x),
  y: finite(position?.y),
  z: finite(position?.z),
});
const stableEvent = (event, serial) => Object.freeze({
  serial,
  channel: event.channel,
  kind: event.kind,
  phase: event.phase,
  outcome: event.outcome,
  active: Boolean(event.active),
  comboStep: Math.max(0, Math.floor(finite(event.comboStep))),
  stamina: clamp(finite(event.stamina, 0), 0, 100),
  poise: clamp(finite(event.poise, 0), 0, 100),
  appliedAmount: Math.max(0, finite(event.appliedAmount)),
  blockedAmount: Math.max(0, finite(event.blockedAmount)),
  timestampMs: Math.max(0, finite(event.timestampMs)),
});

export function createPlayerCombatObserver({ limit = DEFAULT_LIMIT } = {}) {
  const capacity = clamp(Math.floor(finite(limit, DEFAULT_LIMIT)), 1, MAX_LIMIT);
  let serial = 0;
  let attackWindow = null;
  let combatFeedback = null;
  const history = [];

  function remember(event) {
    serial += 1;
    const normalized = stableEvent(event, serial);
    history.push(normalized);
    while (history.length > capacity) history.shift();
    return normalized;
  }

  function ingestAttackWindow(detail = {}) {
    const event = remember({
      channel: 'attack-window',
      kind: normalizeKind(detail.kind),
      phase: normalizePhase(detail.phase),
      outcome: 'none',
      active: detail.active,
      comboStep: detail.comboStep,
      stamina: detail.stamina,
      poise: detail.poise,
      timestampMs: detail.timestampMs,
    });
    attackWindow = event;
    return event;
  }

  function ingestCombatFeedback(detail = {}) {
    const event = remember({
      channel: 'combat-feedback',
      kind: 'none',
      phase: 'feedback',
      outcome: normalizeOutcome(detail.outcome),
      active: false,
      stamina: detail.stamina,
      poise: detail.poise,
      appliedAmount: detail.appliedAmount,
      blockedAmount: detail.blockedAmount,
      timestampMs: detail.timestampMs,
    });
    combatFeedback = event;
    return event;
  }

  function snapshot() {
    const last = history.at(-1) ?? null;
    return Object.freeze({
      eventCount: history.length,
      attackWindow,
      combatFeedback,
      lastEvent: last,
      history: Object.freeze(history.slice()),
    });
  }

  function reset() {
    serial = 0;
    attackWindow = null;
    combatFeedback = null;
    history.length = 0;
  }

  return Object.freeze({ ingestAttackWindow, ingestCombatFeedback, snapshot, reset });
}

export function attachPlayerCombatObserver({ target = globalThis, observer, now = () => Date.now() } = {}) {
  if (!observer || typeof target?.addEventListener !== 'function') return () => {};
  const attackHandler = (event) => observer.ingestAttackWindow({ ...(event?.detail ?? {}), timestampMs: now() });
  const feedbackHandler = (event) => observer.ingestCombatFeedback({ ...(event?.detail ?? {}), timestampMs: now() });
  target.addEventListener('aapw:player-attack-window', attackHandler);
  target.addEventListener('aapw:player-combat-feedback', feedbackHandler);
  return () => {
    target.removeEventListener('aapw:player-attack-window', attackHandler);
    target.removeEventListener('aapw:player-combat-feedback', feedbackHandler);
  };
}
