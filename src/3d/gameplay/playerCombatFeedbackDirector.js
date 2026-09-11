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
  const limit = clamp(Math.floor(finite(maxEvents, MAX_EVENTS)), 1, MAX_EVENTS);
  let disposed = false;
  const onFeedback = (event) => {
    if (disposed) return;
    events.push(normalizeCombatFeedback(event?.detail));
    while (events.length > limit) events.shift();
  };
  const onAttack = (event) => {
    if (disposed) return;
    const detail = event?.detail ?? {};
    if (detail.phase !== 'active-start' && detail.phase !== 'active-end') return;
    events.push(freeze({
      serial: Math.max(0, Math.floor(finite(detail.serial))),
      outcome: detail.phase === 'active-start' ? 'attack-active' : 'attack-inactive',
      style: 'weapon',
      kind: text(detail.kind, 'unknown'),
      comboStep: Math.max(0, Math.floor(finite(detail.comboStep))),
      reachMeters: Number(clamp(finite(detail.reachMeters), 0, 10).toFixed(3)),
      damageScale: Number(clamp(finite(detail.damageScale, 1), 0, 10).toFixed(3)),
      cue: freeze({ vfx: false, sfx: detail.phase === 'active-start', intensity: detail.phase === 'active-start' ? 0.35 : 0 })
    }));
    while (events.length > limit) events.shift();
  };
  target?.addEventListener?.(FEEDBACK_EVENT, onFeedback);
  target?.addEventListener?.(ATTACK_EVENT, onAttack);
  return freeze({
    read() { return freeze(events.slice()); },
    latest() { return events.at(-1) ?? null; },
    clear() { events.length = 0; },
    dispose() { if (disposed) return; disposed = true; target?.removeEventListener?.(FEEDBACK_EVENT, onFeedback); target?.removeEventListener?.(ATTACK_EVENT, onAttack); events.length = 0; }
  });
}

export function validatePlayerCombatFeedbackDirector(snapshot) {
  return Boolean(snapshot && Object.isFrozen(snapshot) && Array.isArray(snapshot) && snapshot.every((entry) => Object.isFrozen(entry)));
}
