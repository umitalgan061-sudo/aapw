/**
 * Kızıl Ufuk: presentation-only combat momentum adapter.
 *
 * The shipped player/controller remains the authority for movement, health, stamina,
 * poise, damage, hitboxes, equipment and animation state. This module only observes
 * existing player events and emits a bounded, deterministic envelope for HUD/VFX/SFX
 * and additive animation consumers.
 *
 * @module gameplay/playerCombatMomentumDirector
 */

export const PLAYER_COMBAT_MOMENTUM_VERSION = '2026-09-14-v2';
export const PLAYER_COMBAT_MOMENTUM_EVENT = 'aapw:player-combat-momentum';

export const PLAYER_COMBAT_MOMENTUM_CONFIG = Object.freeze({
  maxScore: 100,
  maxStreak: 12,
  maxDeltaSeconds: 0.1,
  successDecayPerSecond: 3.5,
  failureDecayPerSecond: 9,
  idleDecayPerSecond: 2.25,
  finisherScore: 78,
  finisherSuccessStreak: 3,
  finisherDefenseStreak: 1,
  finisherWindowSeconds: 0.55,
  finisherCooldownSeconds: 1.2,
  historyLimit: 32,
});

const SUCCESS_OUTCOMES = new Set(['light-hit', 'heavy-hit', 'guard', 'parry', 'dodge']);
const DEFENSE_OUTCOMES = new Set(['guard', 'parry', 'dodge']);
const FAILURE_OUTCOMES = new Set(['hit', 'guard-break', 'hit-stagger']);
const EVENT_TYPES = Object.freeze({
  motion: 'aapw:player-motion',
  attack: 'aapw:player-attack-window',
  feedback: 'aapw:player-combat-feedback',
  equipment: 'aapw:player-equipment-combat-frame',
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const round = (value, digits = 4) => Number(finite(value).toFixed(digits));
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : fallback;
const asDetail = (value) => value && typeof value === 'object' ? value : {};

function normalizeOutcome(value) {
  const outcome = text(value, 'none');
  return SUCCESS_OUTCOMES.has(outcome) || FAILURE_OUTCOMES.has(outcome) ? outcome : 'none';
}

function rankFor(score) {
  if (score >= PLAYER_COMBAT_MOMENTUM_CONFIG.finisherScore) return 'finisher-ready';
  if (score >= 55) return 'surging';
  if (score >= 25) return 'focused';
  return 'neutral';
}

function eventDetail(event) {
  return asDetail(event?.detail ?? event);
}

function eventType(event, fallback = 'unknown') {
  return text(event?.type, fallback);
}

function safeDispatch(target, type, detail) {
  if (!target || typeof target.dispatchEvent !== 'function') return;
  if (typeof globalThis.CustomEvent === 'function') {
    target.dispatchEvent(new CustomEvent(type, { detail }));
    return;
  }
  target.dispatchEvent({ type, detail });
}

function createState() {
  return {
    score: 0,
    rank: 'neutral',
    successStreak: 0,
    defenseStreak: 0,
    failureStreak: 0,
    totalActions: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    rhythmQuality: 0,
    finisherReady: false,
    finisherWindowRemaining: 0,
    finisherCooldownRemaining: 0,
    motionState: 'idle',
    grounded: true,
    speedMps: 0,
    staminaRatio: 1,
    poiseRatio: 1,
    equipment: Object.freeze({ damageScale: 1, movementMultiplier: 1 }),
  };
}

function freezeState(state) {
  const next = { ...state };
  next.score = round(clamp(next.score, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxScore));
  next.successStreak = Math.trunc(clamp(next.successStreak, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxStreak));
  next.defenseStreak = Math.trunc(clamp(next.defenseStreak, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxStreak));
  next.failureStreak = Math.trunc(clamp(next.failureStreak, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxStreak));
  next.rhythmQuality = round(clamp(next.rhythmQuality, 0, 1));
  next.finisherWindowRemaining = round(Math.max(0, next.finisherWindowRemaining));
  next.finisherCooldownRemaining = round(Math.max(0, next.finisherCooldownRemaining));
  next.motionState = text(next.motionState, 'idle');
  next.speedMps = round(Math.max(0, next.speedMps));
  next.staminaRatio = round(clamp(next.staminaRatio, 0, 1));
  next.poiseRatio = round(clamp(next.poiseRatio, 0, 1));
  next.rank = rankFor(next.score);
  next.finisherReady = Boolean(next.finisherReady && next.finisherWindowRemaining > 0);
  next.equipment = Object.freeze({
    damageScale: round(clamp(next.equipment?.damageScale, 0.1, 3.5), 3),
    movementMultiplier: round(clamp(next.equipment?.movementMultiplier, 0.25, 1.75), 3),
  });
  return Object.freeze(next);
}

export function calculatePlayerCombatRhythmQuality(intervalSeconds) {
  const interval = finite(intervalSeconds, NaN);
  if (!Number.isFinite(interval) || interval < 0.12 || interval > 3.25) return 0;
  return round(clamp(1 - Math.abs(interval - 0.9) / 2.5, 0, 1));
}

export function createPlayerCombatMomentumDirector({
  target = globalThis,
  emit = true,
  onChange = null,
  equipmentProvider = null,
} = {}) {
  const state = createState();
  const history = [];
  let sequence = 0;
  let lastActionTimestamp = null;

  const read = () => freezeState({ ...state });
  const publish = (reason, source = 'director') => {
    const snapshot = read();
    const packet = Object.freeze({
      version: PLAYER_COMBAT_MOMENTUM_VERSION,
      sequence: sequence += 1,
      reason: text(reason, 'update'),
      source: text(source, 'director'),
      state: snapshot,
    });
    history.push(packet);
    while (history.length > PLAYER_COMBAT_MOMENTUM_CONFIG.historyLimit) history.shift();
    if (emit) safeDispatch(target, PLAYER_COMBAT_MOMENTUM_EVENT, packet);
    if (typeof onChange === 'function') onChange(packet);
    return packet;
  };

  const setEquipment = (frame = {}) => {
    const source = equipmentProvider ? equipmentProvider() : frame;
    const attack = asDetail(source).attack || {};
    const movement = asDetail(source).movement || {};
    state.equipment = Object.freeze({
      damageScale: clamp(attack.damageScale, 0.1, 3.5),
      movementMultiplier: clamp(movement.movementMultiplier, 0.25, 1.75),
    });
  };

  const applyOutcome = (rawOutcome, detail = {}, timestamp = 0) => {
    const outcome = normalizeOutcome(rawOutcome);
    const previousTimestamp = lastActionTimestamp;
    const currentTimestamp = Math.max(0, finite(timestamp));
    const rhythm = previousTimestamp == null ? 0 : calculatePlayerCombatRhythmQuality(currentTimestamp - previousTimestamp);
    lastActionTimestamp = currentTimestamp;
    const comboStep = clamp(Math.trunc(finite(detail.comboStep)), 0, 3);
    const scale = state.equipment.damageScale * 0.15 + state.equipment.movementMultiplier * 0.1 + 0.75;
    let delta = 0;
    if (SUCCESS_OUTCOMES.has(outcome)) {
      const base = outcome === 'light-hit' ? 7 : outcome === 'heavy-hit' ? 11 : outcome === 'parry' ? 16 : outcome === 'dodge' ? 9 : 5;
      delta = (base + comboStep * 2.5 + rhythm * 4) * scale;
      state.successStreak = Math.min(PLAYER_COMBAT_MOMENTUM_CONFIG.maxStreak, state.successStreak + 1);
      state.failureStreak = 0;
      state.totalSuccesses += 1;
      state.defenseStreak = DEFENSE_OUTCOMES.has(outcome) ? Math.min(PLAYER_COMBAT_MOMENTUM_CONFIG.maxStreak, state.defenseStreak + 1) : 0;
    } else if (FAILURE_OUTCOMES.has(outcome)) {
      delta = outcome === 'hit-stagger' ? -11 : outcome === 'guard-break' ? -10 : -8;
      state.failureStreak = Math.min(PLAYER_COMBAT_MOMENTUM_CONFIG.maxStreak, state.failureStreak + 1);
      state.successStreak = 0;
      state.defenseStreak = 0;
      state.totalFailures += 1;
    }
    state.score = clamp(state.score + delta, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxScore);
    state.totalActions += 1;
    state.rhythmQuality = rhythm;
    state.finisherReady = state.score >= PLAYER_COMBAT_MOMENTUM_CONFIG.finisherScore
      && state.successStreak >= PLAYER_COMBAT_MOMENTUM_CONFIG.finisherSuccessStreak
      && state.defenseStreak >= PLAYER_COMBAT_MOMENTUM_CONFIG.finisherDefenseStreak
      && state.finisherCooldownRemaining <= 0;
    if (state.finisherReady && state.finisherWindowRemaining <= 0) state.finisherWindowRemaining = PLAYER_COMBAT_MOMENTUM_CONFIG.finisherWindowSeconds;
    return publish(`outcome:${outcome}`, 'combat-feedback');
  };

  const update = (deltaSeconds = 0, timestamp = 0) => {
    const dt = clamp(deltaSeconds, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxDeltaSeconds);
    const decay = state.failureStreak > 0
      ? PLAYER_COMBAT_MOMENTUM_CONFIG.failureDecayPerSecond
      : state.successStreak > 0
        ? PLAYER_COMBAT_MOMENTUM_CONFIG.successDecayPerSecond
        : PLAYER_COMBAT_MOMENTUM_CONFIG.idleDecayPerSecond;
    state.score = clamp(state.score - decay * dt, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.maxScore);
    state.finisherWindowRemaining = Math.max(0, state.finisherWindowRemaining - dt);
    state.finisherCooldownRemaining = Math.max(0, state.finisherCooldownRemaining - dt);
    if (state.finisherWindowRemaining <= 0) state.finisherReady = false;
    if (state.score < PLAYER_COMBAT_MOMENTUM_CONFIG.finisherScore) state.finisherReady = false;
    return publish('tick', `update@${round(timestamp, 3)}`);
  };

  const observe = (event) => {
    const type = eventType(event);
    const detail = eventDetail(event);
    if (type === EVENT_TYPES.motion) {
      state.motionState = text(detail.state ?? detail.motionState, state.motionState);
      state.grounded = detail.grounded !== false;
      state.speedMps = Math.max(0, finite(detail.speedMps ?? detail.speed));
      state.staminaRatio = clamp(detail.staminaRatio ?? state.staminaRatio, 0, 1);
      state.poiseRatio = clamp(detail.poiseRatio ?? state.poiseRatio, 0, 1);
      return publish('motion', 'player-motion');
    }
    if (type === EVENT_TYPES.equipment) {
      setEquipment(detail);
      return publish('equipment', 'player-equipment');
    }
    if (type === EVENT_TYPES.feedback) {
      return applyOutcome(detail.outcome, detail, detail.timestamp ?? 0);
    }
    if (type === EVENT_TYPES.attack) {
      if (detail.phase === 'active-start' && detail.confirmed) return applyOutcome(detail.outcome ?? `${detail.attackKind || 'light'}-hit`, detail, detail.timestamp ?? 0);
      return publish('attack-window', 'player-attack-window');
    }
    return null;
  };

  const attach = () => {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    const handlers = Object.values(EVENT_TYPES).map((type) => {
      const handler = (event) => observe(event);
      target.addEventListener(type, handler);
      return [type, handler];
    });
    return () => handlers.forEach(([type, handler]) => target.removeEventListener(type, handler));
  };

  return Object.freeze({
    read,
    history: () => Object.freeze(history.slice()),
    observe,
    attach,
    update,
    applyOutcome,
    setEquipment,
  });
}
