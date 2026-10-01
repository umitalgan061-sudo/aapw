/**
 * Read-only feedback projection over the shipped player combat event surface.
 * The existing player.js remains authoritative for state, damage, animation and scene mutation.
 * @module gameplay/playerCombatFeedbackDirector
 */

const MAX_EVENTS = 24;
const MAX_TEXT = 80;
const FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const ATTACK_EVENT = 'aapw:player-attack-window';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value, fallback = '') => String(value ?? fallback).slice(0, MAX_TEXT);

const OUTCOME_STYLE = Object.freeze({
  hit: 'impact', blocked: 'guard', parried: 'parry', dodged: 'evasion', 'guard-break': 'break', 'hit-stagger': 'stagger', miss: 'miss'
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function normalizeCombatFeedback(detail = {}) {
  const outcome = text(detail.outcome, 'unknown');
  const appliedAmount = clamp(finite(detail.appliedAmount), 0, 9999);
  const blockedAmount = clamp(finite(detail.blockedAmount), 0, 9999);
  const poise = clamp(finite(detail.poise, 100), 0, 100);
  const stamina = clamp(finite(detail.stamina, 100), 0, 100);
  return freeze({
    eventType: 'feedback',
    serial: Math.max(0, Math.floor(finite(detail.serial))),
    outcome,
    style: OUTCOME_STYLE[outcome] ?? 'neutral',
    appliedAmount: Number(appliedAmount.toFixed(4)),
    blockedAmount: Number(blockedAmount.toFixed(4)),
    poise: Number(poise.toFixed(2)),
    stamina: Number(stamina.toFixed(2)),
    state: text(detail.state, 'unknown'),
    position: freeze({ x: finite(detail.position?.x), y: finite(detail.position?.y), z: finite(detail.position?.z) }),
    cue: freeze({
      vfx: outcome === 'hit' || outcome === 'guard-break' || outcome === 'parried',
      sfx: outcome !== 'miss' && outcome !== 'unknown',
      intensity: Number(clamp(Math.max(appliedAmount, blockedAmount) / 40, 0, 1).toFixed(3))
    })
  });
}

export function createPlayerCombatFeedbackDirector({ target = globalThis, maxEvents = MAX_EVENTS } = {}) {
  const events = [];
  const seen = new Set();
  const limit = clamp(Math.floor(finite(maxEvents, MAX_EVENTS)), 1, MAX_EVENTS);
  let disposed = false;
  const push = (entry, key) => {
    if (seen.has(key)) return;
    seen.add(key);
    events.push(entry);
    while (events.length > limit) {
      const removed = events.shift();
      if (removed) seen.delete(removed.__dedupeKey);
    }
  };
  const onFeedback = (event) => {
    if (disposed) return;
    const detail = event?.detail ?? {};
    const entry = normalizeCombatFeedback(detail);
    const key = `feedback:${entry.serial}:${entry.outcome}:${entry.state}:${entry.position.x}:${entry.position.y}:${entry.position.z}`;
    push(freeze({ ...entry, __dedupeKey: key }), key);
  };
  const onAttack = (event) => {
    if (disposed) return;
    const detail = event?.detail ?? {};
    if (detail.phase !== 'active-start' && detail.phase !== 'active-end') return;
    const serial = Math.max(0, Math.floor(finite(detail.serial)));
    const phase = text(detail.phase, 'unknown');
    const kind = text(detail.kind, 'unknown');
    const entry = {
      eventType: 'attack-window',
      serial,
      outcome: phase === 'active-start' ? 'attack-active' : 'attack-inactive',
      style: 'weapon',
      kind,
      comboStep: Math.max(0, Math.floor(finite(detail.comboStep))),
      reachMeters: Number(clamp(finite(detail.reachMeters), 0, 10).toFixed(3)),
      damageScale: Number(clamp(finite(detail.damageScale, 1), 0, 10).toFixed(3)),
      cue: freeze({ vfx: false, sfx: phase === 'active-start', intensity: phase === 'active-start' ? 0.35 : 0 })
    };
    const key = `attack:${serial}:${phase}:${kind}:${entry.comboStep}:${entry.reachMeters}:${entry.damageScale}`;
    push(freeze({ ...entry, __dedupeKey: key }), key);
  };
  target?.addEventListener?.(FEEDBACK_EVENT, onFeedback);
  target?.addEventListener?.(ATTACK_EVENT, onAttack);
  return freeze({
    read() { return freeze(events.map(({ __dedupeKey, ...entry }) => entry)); },
    latest() {
      const entry = events.at(-1);
      if (!entry) return null;
      const { __dedupeKey, ...publicEntry } = entry;
      return freeze(publicEntry);
    },
    clear() { events.length = 0; seen.clear(); },
    dispose() { if (disposed) return; disposed = true; target?.removeEventListener?.(FEEDBACK_EVENT, onFeedback); target?.removeEventListener?.(ATTACK_EVENT, onAttack); events.length = 0; seen.clear(); }
  });
}

export function validatePlayerCombatFeedbackDirector(snapshot) {
  return Boolean(snapshot && Object.isFrozen(snapshot) && Array.isArray(snapshot) && snapshot.every((entry) => Object.isFrozen(entry) && typeof entry.eventType === 'string'));
}
