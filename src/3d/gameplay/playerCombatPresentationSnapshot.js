const LOCOMOTION = Object.freeze(['idle', 'walk', 'run', 'dodge', 'attack', 'guard', 'hit']);
const FEEDBACK = Object.freeze(['none', 'swing', 'impact', 'block', 'parry', 'dodge', 'guard-break', 'stagger']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => String(value ?? fallback).trim().slice(0, 96) || fallback;
const bool = (value) => value === true;

function normalizeTarget(target) {
  if (!target || typeof target !== 'object') return Object.freeze({ id: null, distance: null, locked: false });
  const distance = Number.isFinite(Number(target.distance)) ? Math.max(0, Number(target.distance)) : null;
  return Object.freeze({ id: target.id == null ? null : text(target.id, 'target'), distance, locked: bool(target.locked) });
}

function normalizeEquipment(equipment) {
  const source = equipment && typeof equipment === 'object' ? equipment : {};
  const sockets = source.sockets && typeof source.sockets === 'object' ? source.sockets : {};
  return Object.freeze({
    weaponId: source.weaponId == null ? null : text(source.weaponId, 'weapon'),
    armorId: source.armorId == null ? null : text(source.armorId, 'armor'),
    sockets: Object.freeze({
      mainHand: sockets.mainHand == null ? null : text(sockets.mainHand, 'mainHand'),
      offHand: sockets.offHand == null ? null : text(sockets.offHand, 'offHand'),
      back: sockets.back == null ? null : text(sockets.back, 'back'),
    }),
  });
}

function normalizeAnimation(animation) {
  const source = animation && typeof animation === 'object' ? animation : {};
  const locomotion = LOCOMOTION.includes(source.locomotion) ? source.locomotion : 'idle';
  return Object.freeze({
    locomotion,
    locomotionWeight: clamp(source.locomotionWeight, 0, 1),
    attackWeight: clamp(source.attackWeight, 0, 1),
    guardWeight: clamp(source.guardWeight, 0, 1),
    reactionWeight: clamp(source.reactionWeight, 0, 1),
    clip: source.clip == null ? null : text(source.clip, 'clip'),
  });
}

function normalizeFeedback(feedback) {
  const source = feedback && typeof feedback === 'object' ? feedback : {};
  const kind = FEEDBACK.includes(source.kind) ? source.kind : 'none';
  return Object.freeze({
    kind,
    intensity: clamp(source.intensity, 0, 1),
    cueId: source.cueId == null ? null : text(source.cueId, 'cue'),
    critical: bool(source.critical),
  });
}

export function createPlayerCombatPresentationSnapshot(input = {}) {
  const frame = Math.max(0, Math.floor(finite(input.frame, 0)));
  const intent = input.intent && typeof input.intent === 'object' ? input.intent : {};
  const resources = input.resources && typeof input.resources === 'object' ? input.resources : {};
  const outcome = input.outcome && typeof input.outcome === 'object' ? input.outcome : {};
  const snapshot = {
    frame,
    action: text(intent.action, 'none'),
    accepted: bool(intent.accepted),
    comboIndex: Math.max(0, Math.floor(finite(input.comboIndex, 0))),
    stamina: Object.freeze({ current: clamp(resources.stamina, 0, 1000), max: clamp(resources.maxStamina ?? 100, 1, 1000) }),
    poise: Object.freeze({ current: clamp(resources.poise, 0, 1000), max: clamp(resources.maxPoise ?? 100, 1, 1000) }),
    target: normalizeTarget(input.target),
    animation: normalizeAnimation(input.animation),
    equipment: normalizeEquipment(input.equipment),
    feedback: normalizeFeedback({
      kind: input.feedback?.kind ?? (outcome.outcome === 'hit' ? 'impact' : 'none'),
      intensity: input.feedback?.intensity ?? (outcome.damage ? clamp(Number(outcome.damage) / 100, 0, 1) : 0),
      cueId: input.feedback?.cueId,
      critical: input.feedback?.critical,
    }),
    hitConfirmed: outcome.outcome === 'hit',
    outcome: outcome.outcome == null ? null : text(outcome.outcome, 'miss'),
  };
  return Object.freeze(snapshot);
}

export function serializePlayerCombatPresentationSnapshot(snapshot) {
  return JSON.stringify(snapshot ?? createPlayerCombatPresentationSnapshot());
}
