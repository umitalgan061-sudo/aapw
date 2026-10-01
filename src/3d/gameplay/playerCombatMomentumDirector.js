/**
 * Deterministic combat-rhythm and finisher-readiness director.
 *
 * `player.js` remains the sole authority for movement, health, stamina, poise, dodge, defense,
 * attack timing and actual damage. This module only observes the shipped player event streams and
 * derives a bounded presentation/gameplay envelope for systems that want rewarding combat rhythm.
 * It intentionally owns no Three.js scene objects, collider, camera, inventory or animation mixer.
 *
 * The director consumes three existing streams:
 *   - `aapw:player-motion`
 *   - `aapw:player-attack-window`
 *   - `aapw:player-combat-feedback`
 * and, when present, the existing equipment frame stream. It can therefore be mounted beside the
 * existing directors without introducing a second player/combat framework.
 *
 * Momentum is not damage and never mutates player health. It is a deterministic score driven by
 * successful actions, clean timing, defense outcomes and controlled pressure. The score is useful
 * for finisher UI, future hit-stop/VFX intensity, animation additive layers, accessibility cues,
 * or combat tutorial feedback. All thresholds are explicit and inspectable.
 *
 * @module gameplay/playerCombatMomentumDirector
 */

export const PLAYER_COMBAT_MOMENTUM_VERSION = '2026-09-14-v1';
export const PLAYER_COMBAT_MOMENTUM_EVENT = 'aapw:player-combat-momentum';

export const PLAYER_COMBAT_MOMENTUM_RANKS = Object.freeze([
  'neutral',
  'focused',
  'surging',
  'finisher-ready',
]);

export const PLAYER_COMBAT_MOMENTUM_OUTCOMES = Object.freeze([
  'light-hit',
  'heavy-hit',
  'guard',
  'parry',
  'dodge',
  'hit',
  'guard-break',
  'hit-stagger',
]);

export const PLAYER_COMBAT_MOMENTUM_CONFIG = Object.freeze({
  MAX_SCORE: 100,
  FOCUSED_SCORE: 25,
  SURGING_SCORE: 55,
  FINISHER_SCORE: 78,
  FINISHER_MIN_SUCCESS_STREAK: 3,
  FINISHER_MIN_DEFENSE_STREAK: 1,
  SUCCESS_DECAY_PER_SECOND: 3.5,
  FAILURE_DECAY_PER_SECOND: 9,
  IDLE_DECAY_PER_SECOND: 2.25,
  RHYTHM_WINDOW_SECONDS: 2.5,
  RHYTHM_IDEAL_SECONDS: 0.9,
  RHYTHM_MIN_SECONDS: 0.12,
  RHYTHM_MAX_SECONDS: 3.25,
  RHYTHM_WEIGHT: 0.22,
  MAX_STREAK: 12,
  HISTORY_LIMIT: 32,
  MAX_DT_SECONDS: 0.1,
  FINISHER_LOCKOUT_SECONDS: 1.2,
  FINISHER_ARM_SECONDS: 0.55,
  COMBO_STEP_BONUS: 2.5,
  LIGHT_HIT_BONUS: 7,
  HEAVY_HIT_BONUS: 11,
  GUARD_BONUS: 5,
  PARRY_BONUS: 16,
  DODGE_BONUS: 9,
  CLEAN_PARRY_RHYTHM_BONUS: 7,
  FAILURE_PENALTY: 8,
  GUARD_BREAK_PENALTY: 10,
  HIT_STAGGER_PENALTY: 11,
  EQUIPMENT_DAMAGE_SCALE_WEIGHT: 0.15,
  EQUIPMENT_SPEED_WEIGHT: 0.1,
});

const MOTION_EVENT = 'aapw:player-motion';
const ATTACK_WINDOW_EVENT = 'aapw:player-attack-window';
const COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const EQUIPMENT_FRAME_EVENT = 'aapw:player-equipment-combat-frame';

const OFFENSIVE_OUTCOMES = new Set(['light-hit', 'heavy-hit']);
const SUCCESS_OUTCOMES = new Set(['light-hit', 'heavy-hit', 'guard', 'parry', 'dodge']);
const DEFENSE_OUTCOMES = new Set(['guard', 'parry', 'dodge']);
const FAILURE_OUTCOMES = new Set(['hit', 'guard-break', 'hit-stagger']);
const ATTACK_PHASES = new Set(['start', 'active-start', 'active-end', 'finish', 'interrupted']);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback = 0) {
  const number = finite(value, fallback);
  return number > 0 ? number : 0;
}

function integer(value, fallback = 0) {
  const number = Math.floor(finite(value, fallback));
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function clampUnit(value, fallback = 0) {
  return clamp(value, 0, 1);
}

function round(value, digits = 4) {
  const scale = 10 ** Math.max(0, Math.floor(digits));
  return Math.round(finite(value, 0) * scale) / scale;
}

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 64) : fallback;
}

function normalizeOutcome(value) {
  const outcome = normalizeString(value, 'none');
  return PLAYER_COMBAT_MOMENTUM_OUTCOMES.includes(outcome) ? outcome : 'none';
}

function normalizeRank(score) {
  const value = clamp(score, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE);
  if (value >= PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_SCORE) return 'finisher-ready';
  if (value >= PLAYER_COMBAT_MOMENTUM_CONFIG.SURGING_SCORE) return 'surging';
  if (value >= PLAYER_COMBAT_MOMENTUM_CONFIG.FOCUSED_SCORE) return 'focused';
  return 'neutral';
}

function scoreRatio(score) {
  return round(clampUnit(score / PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE), 4);
}

function normalizeEquipmentScale(frame) {
  const attack = frame?.attack || {};
  const movement = frame?.movement || {};
  const damage = clamp(finite(attack.damageScale, 1), 0.1, 3.5);
  const speed = clamp(finite(movement.movementMultiplier, 1), 0.25, 1.75);
  return Object.freeze({
    damageScale: round(damage, 4),
    movementMultiplier: round(speed, 4),
    damageInfluence: round(1 + (damage - 1) * PLAYER_COMBAT_MOMENTUM_CONFIG.EQUIPMENT_DAMAGE_SCALE_WEIGHT, 4),
    speedInfluence: round(1 + (speed - 1) * PLAYER_COMBAT_MOMENTUM_CONFIG.EQUIPMENT_SPEED_WEIGHT, 4),
  });
}

function normalizeTimestamp(timestamp, fallback = 0) {
  const value = finite(timestamp, fallback);
  return value >= 0 ? value : fallback;
}

function normalizeEventDetail(detail) {
  return detail && typeof detail === 'object' ? detail : {};
}

function normalizePhase(value) {
  const phase = normalizeString(value, 'none');
  return ATTACK_PHASES.has(phase) ? phase : 'none';
}

function normalizeAttackKind(value) {
  return value === 'heavy' ? 'heavy' : value === 'light' ? 'light' : 'none';
}

function cloneFreeze(value) {
  if (!value || typeof value !== 'object') return Object.freeze({});
  return Object.freeze({ ...value });
}

function calculateRhythmQuality(intervalSeconds) {
  const interval = finite(intervalSeconds, NaN);
  if (!Number.isFinite(interval)) return 0;
  if (interval < PLAYER_COMBAT_MOMENTUM_CONFIG.RHYTHM_MIN_SECONDS) return 0;
  if (interval > PLAYER_COMBAT_MOMENTUM_CONFIG.RHYTHM_MAX_SECONDS) return 0;
  const distance = Math.abs(interval - PLAYER_COMBAT_MOMENTUM_CONFIG.RHYTHM_IDEAL_SECONDS);
  const quality = 1 - distance / PLAYER_COMBAT_MOMENTUM_CONFIG.RHYTHM_WINDOW_SECONDS;
  return clampUnit(quality);
}

function calculateSuccessBonus(outcome, detail, equipmentScale, rhythmQuality) {
  const comboStep = clamp(integer(detail?.comboStep, 0), 0, 3);
  const comboBonus = comboStep > 0 ? comboStep * PLAYER_COMBAT_MOMENTUM_CONFIG.COMBO_STEP_BONUS : 0;
  let base = 0;
  if (outcome === 'light-hit') base = PLAYER_COMBAT_MOMENTUM_CONFIG.LIGHT_HIT_BONUS;
  else if (outcome === 'heavy-hit') base = PLAYER_COMBAT_MOMENTUM_CONFIG.HEAVY_HIT_BONUS;
  else if (outcome === 'guard') base = PLAYER_COMBAT_MOMENTUM_CONFIG.GUARD_BONUS;
  else if (outcome === 'parry') base = PLAYER_COMBAT_MOMENTUM_CONFIG.PARRY_BONUS;
  else if (outcome === 'dodge') base = PLAYER_COMBAT_MOMENTUM_CONFIG.DODGE_BONUS;
  const rhythmBonus = rhythmQuality * PLAYER_COMBAT_MOMENTUM_CONFIG.RHYTHM_WEIGHT * 20;
  const cleanParryBonus = outcome === 'parry'
    ? rhythmQuality * PLAYER_COMBAT_MOMENTUM_CONFIG.CLEAN_PARRY_RHYTHM_BONUS
    : 0;
  const equipmentInfluence = equipmentScale.damageInfluence * equipmentScale.speedInfluence;
  const total = (base + comboBonus + rhythmBonus + cleanParryBonus) * clamp(equipmentInfluence, 0.75, 1.35);
  return round(total, 4);
}

function calculateFailurePenalty(outcome) {
  if (outcome === 'guard-break') return PLAYER_COMBAT_MOMENTUM_CONFIG.GUARD_BREAK_PENALTY;
  if (outcome === 'hit-stagger') return PLAYER_COMBAT_MOMENTUM_CONFIG.HIT_STAGGER_PENALTY;
  if (outcome === 'hit') return PLAYER_COMBAT_MOMENTUM_CONFIG.FAILURE_PENALTY;
  return 0;
}

function outcomeIsSuccess(outcome) {
  return SUCCESS_OUTCOMES.has(normalizeOutcome(outcome));
}

function outcomeIsDefense(outcome) {
  return DEFENSE_OUTCOMES.has(normalizeOutcome(outcome));
}

function outcomeIsFailure(outcome) {
  return FAILURE_OUTCOMES.has(normalizeOutcome(outcome));
}

function makeEvidenceEntry({
  sequence,
  timestamp,
  type,
  outcome = 'none',
  scoreDelta = 0,
  rhythmQuality = 0,
  comboStep = 0,
  rank = 'neutral',
  source = 'unknown',
}) {
  return Object.freeze({
    sequence: integer(sequence, 0),
    timestamp: round(normalizeTimestamp(timestamp, 0), 4),
    type: normalizeString(type, 'unknown'),
    outcome: normalizeOutcome(outcome),
    scoreDelta: round(scoreDelta, 4),
    rhythmQuality: round(clampUnit(rhythmQuality), 4),
    comboStep: clamp(integer(comboStep, 0), 0, 3),
    rank: PLAYER_COMBAT_MOMENTUM_RANKS.includes(rank) ? rank : 'neutral',
    source: normalizeString(source, 'unknown'),
  });
}

function buildInitialState() {
  return {
    score: 0,
    rank: 'neutral',
    successStreak: 0,
    defenseStreak: 0,
    failureStreak: 0,
    bestSuccessStreak: 0,
    totalSuccesses: 0,
    totalDefenses: 0,
    totalFailures: 0,
    totalActions: 0,
    rhythmQuality: 0,
    lastSuccessTimestamp: null,
    lastOutcomeTimestamp: null,
    lastOutcome: 'none',
    lastActionKind: 'none',
    lastAttackSerial: 0,
    finisherArmed: false,
    finisherCooldownRemaining: 0,
    finisherWindowRemaining: 0,
    finisherGeneration: 0,
    motionState: 'idle',
    grounded: true,
    speedMps: 0,
    staminaRatio: 1,
    poiseRatio: 1,
    equipmentScale: Object.freeze({
      damageScale: 1,
      movementMultiplier: 1,
      damageInfluence: 1,
      speedInfluence: 1,
    }),
  };
}

function freezeState(state) {
  const next = { ...state };
  next.rank = normalizeRank(next.score);
  next.score = round(clamp(next.score, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE), 4);
  next.successStreak = clamp(integer(next.successStreak, 0), 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK);
  next.defenseStreak = clamp(integer(next.defenseStreak, 0), 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK);
  next.failureStreak = clamp(integer(next.failureStreak, 0), 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK);
  next.bestSuccessStreak = clamp(integer(next.bestSuccessStreak, 0), 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK);
  next.totalSuccesses = Math.max(0, integer(next.totalSuccesses, 0));
  next.totalDefenses = Math.max(0, integer(next.totalDefenses, 0));
  next.totalFailures = Math.max(0, integer(next.totalFailures, 0));
  next.totalActions = Math.max(0, integer(next.totalActions, 0));
  next.rhythmQuality = round(clampUnit(next.rhythmQuality), 4);
  next.finisherCooldownRemaining = round(Math.max(0, finite(next.finisherCooldownRemaining, 0)), 4);
  next.finisherWindowRemaining = round(Math.max(0, finite(next.finisherWindowRemaining, 0)), 4);
  next.staminaRatio = round(clampUnit(next.staminaRatio), 4);
  next.poiseRatio = round(clampUnit(next.poiseRatio), 4);
  next.speedMps = round(Math.max(0, finite(next.speedMps, 0)), 4);
  next.equipmentScale = normalizeEquipmentScale({
    attack: { damageScale: next.equipmentScale?.damageScale },
    movement: { movementMultiplier: next.equipmentScale?.movementMultiplier },
  });
  return Object.freeze(next);
}

export function resolvePlayerCombatMomentumRank(score) {
  return normalizeRank(score);
}

export function calculatePlayerCombatRhythmQuality(intervalSeconds) {
  return round(calculateRhythmQuality(intervalSeconds), 4);
}

export function calculatePlayerCombatMomentumDelta({
  outcome,
  detail = {},
  previousTimestamp = null,
  timestamp = 0,
  equipmentScale = {},
} = {}) {
  const normalizedOutcome = normalizeOutcome(outcome);
  const safeScale = normalizeEquipmentScale({
    attack: { damageScale: equipmentScale.damageScale },
    movement: { movementMultiplier: equipmentScale.movementMultiplier },
  });
  const previous = previousTimestamp == null ? NaN : finite(previousTimestamp, NaN);
  const current = normalizeTimestamp(timestamp, 0);
  const interval = Number.isFinite(previous) && current >= previous ? current - previous : NaN;
  const rhythmQuality = calculateRhythmQuality(interval);
  if (outcomeIsSuccess(normalizedOutcome)) {
    return Object.freeze({
      delta: calculateSuccessBonus(normalizedOutcome, detail, safeScale, rhythmQuality),
      rhythmQuality: round(rhythmQuality, 4),
      success: true,
      defense: outcomeIsDefense(normalizedOutcome),
      failure: false,
    });
  }
  if (outcomeIsFailure(normalizedOutcome)) {
    return Object.freeze({
      delta: -calculateFailurePenalty(normalizedOutcome),
      rhythmQuality: 0,
      success: false,
      defense: false,
      failure: true,
    });
  }
  return Object.freeze({ delta: 0, rhythmQuality: 0, success: false, defense: false, failure: false });
}

export function createPlayerCombatMomentumDirector({
  target = globalThis,
  now = () => 0,
  emit = true,
  onChange = null,
  equipmentProvider = null,
} = {}) {
  if (!target || typeof target !== 'object') throw new TypeError('target must be an event target');

  let state = freezeState(buildInitialState());
  let disposed = false;
  let sequence = 0;
  let lastPublishedSignature = '';
  let currentAttack = Object.freeze({
    serial: 0,
    kind: 'none',
    phase: 'none',
    active: false,
    comboStep: 0,
    reachMeters: 0,
    damageScale: 1,
  });
  let latestEquipment = null;
  const history = [];
  const listeners = [];

  function currentTime(fallback = 0) {
    try {
      return normalizeTimestamp(now(), fallback);
    } catch {
      return fallback;
    }
  }

  function readEquipmentProvider() {
    try {
      if (typeof equipmentProvider === 'function') return equipmentProvider() || null;
      return equipmentProvider && typeof equipmentProvider === 'object' ? equipmentProvider : null;
    } catch {
      return null;
    }
  }

  function readEquipmentScale() {
    const live = latestEquipment || readEquipmentProvider();
    return normalizeEquipmentScale(live || {});
  }

  function appendHistory(entry) {
    history.push(makeEvidenceEntry(entry));
    if (history.length > PLAYER_COMBAT_MOMENTUM_CONFIG.HISTORY_LIMIT) {
      history.splice(0, history.length - PLAYER_COMBAT_MOMENTUM_CONFIG.HISTORY_LIMIT);
    }
  }

  function publish({ reason = 'state-change', timestamp = currentTime(), force = false } = {}) {
    if (disposed) return state;
    const signature = JSON.stringify({
      score: state.score,
      rank: state.rank,
      successStreak: state.successStreak,
      defenseStreak: state.defenseStreak,
      failureStreak: state.failureStreak,
      finisherArmed: state.finisherArmed,
      finisherWindowRemaining: state.finisherWindowRemaining,
      reason,
    });
    if (!force && signature === lastPublishedSignature) return state;
    lastPublishedSignature = signature;
    const detail = Object.freeze({
      version: PLAYER_COMBAT_MOMENTUM_VERSION,
      ...state,
      scoreRatio: scoreRatio(state.score),
      finisherReady: state.finisherArmed,
      reason: normalizeString(reason, 'state-change'),
      sequence,
      timestamp: round(timestamp, 4),
      historySize: history.length,
    });
    if (typeof onChange === 'function') {
      try { onChange(detail); } catch { /* consumer isolation */ }
    }
    if (emit && typeof target.dispatchEvent === 'function' && typeof target.CustomEvent === 'function') {
      target.dispatchEvent(new target.CustomEvent(PLAYER_COMBAT_MOMENTUM_EVENT, { detail }));
    }
    return state;
  }

  function setState(nextState, reason, timestamp, force = false) {
    state = freezeState({ ...state, ...nextState });
    publish({ reason, timestamp, force });
    return state;
  }

  function disarmFinisher(reason = 'finisher-disarmed', timestamp = currentTime()) {
    return setState({
      finisherArmed: false,
      finisherWindowRemaining: 0,
      finisherCooldownRemaining: PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_LOCKOUT_SECONDS,
    }, reason, timestamp, true);
  }

  function maybeArmFinisher(reason, timestamp) {
    if (state.finisherArmed || state.finisherCooldownRemaining > 0) return false;
    const ready = state.score >= PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_SCORE
      && state.successStreak >= PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_MIN_SUCCESS_STREAK
      && state.defenseStreak >= PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_MIN_DEFENSE_STREAK;
    if (!ready) return false;
    sequence += 1;
    state = freezeState({
      ...state,
      finisherArmed: true,
      finisherWindowRemaining: PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_ARM_SECONDS,
      finisherGeneration: state.finisherGeneration + 1,
    });
    appendHistory({
      sequence,
      timestamp,
      type: 'finisher-armed',
      scoreDelta: 0,
      rhythmQuality: state.rhythmQuality,
      comboStep: currentAttack.comboStep,
      rank: 'finisher-ready',
      source: reason,
    });
    publish({ reason: 'finisher-armed', timestamp, force: true });
    return true;
  }

  function applyOutcome(outcome, detail = {}, timestamp = currentTime()) {
    if (disposed) return state;
    const normalizedOutcome = normalizeOutcome(outcome);
    if (normalizedOutcome === 'none') return state;
    const equipmentScale = readEquipmentScale();
    const delta = calculatePlayerCombatMomentumDelta({
      outcome: normalizedOutcome,
      detail,
      previousTimestamp: state.lastOutcomeTimestamp,
      timestamp,
      equipmentScale,
    });
    const success = delta.success;
    const defense = delta.defense;
    const failure = delta.failure;
    const successStreak = success ? state.successStreak + 1 : 0;
    const defenseStreak = defense ? state.defenseStreak + 1 : (success ? state.defenseStreak : 0);
    const failureStreak = failure ? state.failureStreak + 1 : 0;
    const score = clamp(state.score + delta.delta, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE);
    sequence += 1;
    const next = {
      ...state,
      score,
      successStreak,
      defenseStreak,
      failureStreak,
      bestSuccessStreak: Math.max(state.bestSuccessStreak, successStreak),
      totalSuccesses: state.totalSuccesses + (success ? 1 : 0),
      totalDefenses: state.totalDefenses + (defense ? 1 : 0),
      totalFailures: state.totalFailures + (failure ? 1 : 0),
      totalActions: state.totalActions + 1,
      rhythmQuality: delta.rhythmQuality,
      lastSuccessTimestamp: success ? timestamp : state.lastSuccessTimestamp,
      lastOutcomeTimestamp: timestamp,
      lastOutcome: normalizedOutcome,
      lastActionKind: normalizeAttackKind(detail?.kind ?? currentAttack.kind),
      lastAttackSerial: Math.max(state.lastAttackSerial, integer(detail?.serial, currentAttack.serial)),
      equipmentScale,
      finisherArmed: failure ? false : state.finisherArmed,
      finisherWindowRemaining: failure ? 0 : state.finisherWindowRemaining,
    };
    state = freezeState(next);
    appendHistory({
      sequence,
      timestamp,
      type: 'combat-feedback',
      outcome: normalizedOutcome,
      scoreDelta: delta.delta,
      rhythmQuality: delta.rhythmQuality,
      comboStep: detail?.comboStep,
      rank: state.rank,
      source: detail?.source || 'player-combat-feedback',
    });
    publish({ reason: `outcome:${normalizedOutcome}`, timestamp, force: true });
    if (failure && state.finisherCooldownRemaining <= 0) {
      disarmFinisher('finisher-cancelled-by-failure', timestamp);
    } else {
      maybeArmFinisher('combat-feedback', timestamp);
    }
    return state;
  }

  function decay(deltaSeconds, timestamp = currentTime()) {
    if (disposed) return state;
    const dt = clamp(deltaSeconds, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_DT_SECONDS);
    if (dt <= 0) return state;
    let nextScore = state.score;
    let decayRate = PLAYER_COMBAT_MOMENTUM_CONFIG.IDLE_DECAY_PER_SECOND;
    if (state.failureStreak > 0) decayRate = PLAYER_COMBAT_MOMENTUM_CONFIG.FAILURE_DECAY_PER_SECOND;
    else if (state.successStreak > 0) decayRate = PLAYER_COMBAT_MOMENTUM_CONFIG.SUCCESS_DECAY_PER_SECOND;
    nextScore = clamp(nextScore - decayRate * dt, 0, PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE);
    const nextCooldown = Math.max(0, state.finisherCooldownRemaining - dt);
    const nextWindow = state.finisherArmed
      ? Math.max(0, state.finisherWindowRemaining - dt)
      : state.finisherWindowRemaining;
    const expired = state.finisherArmed && nextWindow <= 0;
    state = freezeState({
      ...state,
      score: nextScore,
      finisherCooldownRemaining: nextCooldown,
      finisherWindowRemaining: nextWindow,
      finisherArmed: expired ? false : state.finisherArmed,
    });
    if (expired) sequence += 1;
    publish({ reason: expired ? 'finisher-expired' : 'decay', timestamp, force: expired });
    return state;
  }

  function onMotion(event) {
    const detail = normalizeEventDetail(event?.detail);
    const timestamp = normalizeTimestamp(detail.timestamp, currentTime());
    state = freezeState({
      ...state,
      motionState: normalizeString(detail.state, 'idle'),
      grounded: Boolean(detail.isGrounded ?? true),
      speedMps: positive(detail.speedMps, 0),
      staminaRatio: clampUnit(detail.staminaRatio ?? (positive(detail.maxStamina, 100) > 0 ? finite(detail.stamina, 100) / positive(detail.maxStamina, 100) : 1)),
      poiseRatio: clampUnit(detail.poiseRatio ?? (positive(detail.maxPoise, 100) > 0 ? finite(detail.poise, 100) / positive(detail.maxPoise, 100) : 1)),
    });
    if (state.motionState === 'idle' && state.successStreak === 0) {
      decay(0.016, timestamp);
    }
  }

  function onAttackWindow(event) {
    const detail = normalizeEventDetail(event?.detail);
    const phase = normalizePhase(detail.phase);
    currentAttack = Object.freeze({
      serial: Math.max(0, integer(detail.serial, 0)),
      kind: normalizeAttackKind(detail.kind),
      phase,
      active: Boolean(detail.active),
      comboStep: clamp(integer(detail.comboStep, 0), 0, 3),
      reachMeters: positive(detail.reachMeters, 0),
      damageScale: clamp(finite(detail.damageScale, 1), 0.1, 3.5),
    });
    if (phase === 'finish') {
      const outcome = currentAttack.kind === 'heavy' ? 'heavy-hit' : currentAttack.kind === 'light' ? 'light-hit' : 'none';
      if (outcome !== 'none') applyOutcome(outcome, detail, currentTime());
    }
  }

  function onFeedback(event) {
    const detail = normalizeEventDetail(event?.detail);
    const timestamp = normalizeTimestamp(detail.timestamp, currentTime());
    applyOutcome(detail.outcome, detail, timestamp);
  }

  function onEquipmentFrame(event) {
    const detail = normalizeEventDetail(event?.detail);
    latestEquipment = cloneFreeze(detail);
    const equipmentScale = readEquipmentScale();
    state = freezeState({ ...state, equipmentScale });
  }

  function subscribe(type, handler) {
    if (typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push([type, handler]);
  }

  subscribe(MOTION_EVENT, onMotion);
  subscribe(ATTACK_WINDOW_EVENT, onAttackWindow);
  subscribe(COMBAT_FEEDBACK_EVENT, onFeedback);
  subscribe(EQUIPMENT_FRAME_EVENT, onEquipmentFrame);

  function update(deltaSeconds = 0, timestamp = currentTime()) {
    if (disposed) return state;
    return decay(deltaSeconds, normalizeTimestamp(timestamp, currentTime()));
  }

  function consumeFinisher(timestamp = currentTime()) {
    if (disposed || !state.finisherArmed || state.finisherWindowRemaining <= 0) return false;
    sequence += 1;
    state = freezeState({
      ...state,
      finisherArmed: false,
      finisherWindowRemaining: 0,
      finisherCooldownRemaining: PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_LOCKOUT_SECONDS,
      score: Math.max(0, state.score - 18),
      successStreak: 0,
      defenseStreak: 0,
    });
    appendHistory({
      sequence,
      timestamp,
      type: 'finisher-consumed',
      scoreDelta: -18,
      rhythmQuality: state.rhythmQuality,
      comboStep: currentAttack.comboStep,
      rank: state.rank,
      source: 'consumer',
    });
    publish({ reason: 'finisher-consumed', timestamp, force: true });
    return true;
  }

  function read() {
    return Object.freeze({
      version: PLAYER_COMBAT_MOMENTUM_VERSION,
      ...state,
      scoreRatio: scoreRatio(state.score),
      finisherReady: state.finisherArmed,
      attack: currentAttack,
      sequence,
      historySize: history.length,
    });
  }

  function readHistory() {
    return Object.freeze(history.slice());
  }

  function reset(timestamp = currentTime()) {
    if (disposed) return read();
    sequence += 1;
    state = freezeState(buildInitialState());
    currentAttack = Object.freeze({ serial: 0, kind: 'none', phase: 'none', active: false, comboStep: 0, reachMeters: 0, damageScale: 1 });
    latestEquipment = null;
    history.length = 0;
    publish({ reason: 'reset', timestamp, force: true });
    return read();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [type, handler] of listeners.splice(0)) target.removeEventListener?.(type, handler);
    history.length = 0;
  }

  publish({ reason: 'initialized', timestamp: currentTime(), force: true });

  return Object.freeze({
    update,
    read,
    readHistory,
    applyOutcome,
    consumeFinisher,
    reset,
    dispose,
  });
}

export function simulatePlayerCombatMomentumSequence(sequence = [], options = {}) {
  const events = Array.isArray(sequence) ? sequence : [];
  let director = null;
  const emitted = [];
  const target = options.target || {
    listeners: new Map(),
    addEventListener(type, handler) {
      const values = this.listeners.get(type) || [];
      values.push(handler);
      this.listeners.set(type, values);
    },
    removeEventListener(type, handler) {
      const values = this.listeners.get(type) || [];
      this.listeners.set(type, values.filter((value) => value !== handler));
    },
    dispatchEvent(event) {
      for (const handler of this.listeners.get(event.type) || []) handler(event);
      return true;
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
  };
  const now = options.now || (() => emitted.length * 0.5);
  director = createPlayerCombatMomentumDirector({ target, now, emit: false, onChange: value => emitted.push(value) });
  const start = finite(options.startTimestamp, 0);
  let previous = start;
  for (const entry of events) {
    const item = entry && typeof entry === 'object' ? entry : { outcome: entry };
    const timestamp = normalizeTimestamp(item.timestamp, previous);
    const outcome = normalizeOutcome(item.outcome);
    director.applyOutcome(outcome, item, timestamp);
    previous = timestamp;
  }
  const snapshot = director.read();
  director.dispose();
  return Object.freeze({
    snapshot,
    history: Object.freeze(emitted.slice()),
    finalScore: snapshot.score,
    rank: snapshot.rank,
    deterministicDigest: buildPlayerCombatMomentumDigest(snapshot, emitted),
  });
}

export function buildPlayerCombatMomentumDigest(snapshot = {}, published = []) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const events = Array.isArray(published) ? published : [];
  const canonical = {
    version: PLAYER_COMBAT_MOMENTUM_VERSION,
    score: round(safe.score, 4),
    rank: normalizeRank(safe.score),
    successStreak: integer(safe.successStreak, 0),
    defenseStreak: integer(safe.defenseStreak, 0),
    failureStreak: integer(safe.failureStreak, 0),
    bestSuccessStreak: integer(safe.bestSuccessStreak, 0),
    totalSuccesses: integer(safe.totalSuccesses, 0),
    totalDefenses: integer(safe.totalDefenses, 0),
    totalFailures: integer(safe.totalFailures, 0),
    finisherArmed: Boolean(safe.finisherArmed),
    finisherGeneration: integer(safe.finisherGeneration, 0),
    publishedCount: events.length,
  };
  const text = JSON.stringify(canonical);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function validatePlayerCombatMomentumSnapshot(snapshot = {}) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') errors.push('snapshot-object');
  if (!Number.isFinite(Number(snapshot?.score))) errors.push('score-finite');
  if (!PLAYER_COMBAT_MOMENTUM_RANKS.includes(snapshot?.rank)) errors.push('rank-known');
  if (Number(snapshot?.score) < 0 || Number(snapshot?.score) > PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE) errors.push('score-range');
  if (Number(snapshot?.successStreak) < 0 || Number(snapshot?.successStreak) > PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK) errors.push('success-streak-range');
  if (Number(snapshot?.defenseStreak) < 0 || Number(snapshot?.defenseStreak) > PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK) errors.push('defense-streak-range');
  if (Number(snapshot?.failureStreak) < 0 || Number(snapshot?.failureStreak) > PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_STREAK) errors.push('failure-streak-range');
  if (!snapshot?.equipmentScale || typeof snapshot.equipmentScale !== 'object') errors.push('equipment-scale-object');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
