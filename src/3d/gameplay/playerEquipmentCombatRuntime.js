/**
 * Runtime composition adapter for the existing player combat event stream.
 *
 * `player.js` remains authoritative for health, stamina, poise, movement, dodge, defense and
 * attack timing. This adapter only observes those events and derives the equipment-dependent
 * presentation/combat envelope that downstream runtime systems can consume. It is intentionally
 * DOM-free and does not create another state machine.
 *
 * The adapter is safe with an empty equipment provider, which maps to the shipped unarmed/
 * unarmored baseline. A real inventory owner can inject a provider later without changing the
 * event contract or importing editor UI code.
 *
 * @module gameplay/playerEquipmentCombatRuntime
 */

import {
  buildPlayerEquipmentRuntimeSnapshot,
  resolvePlayerAttackTuning,
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerAnimationPlan,
  buildPlayerEquipmentSocketPlan,
  buildPlayerMaterialAssignmentMetadata,
  auditPlayerEquipmentProfile,
} from './playerEquipmentCombatProfile.js';

export const PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT = 'aapw:player-equipment-combat-frame';
export const PLAYER_EQUIPMENT_COMBAT_PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);

const MAX_HISTORY = 32;
const MAX_DT = 0.1;
const MIN_DT = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizePhase(motion, attack) {
  if (motion?.state === 'dodge') return 'dodge';
  if (motion?.state === 'parry' || motion?.state === 'guard' || motion?.state === 'guard-break') return 'defense';
  if (motion?.state === 'hit-stagger') return 'hit-stagger';
  if (attack?.attackKind && attack?.attackPhase && attack.attackPhase !== 'none') return attack.attackPhase;
  if (motion?.state?.startsWith?.('attack-')) return 'windup';
  return 'idle';
}

function normalizeAttackKind(value) {
  return value === 'heavy' ? 'heavy' : value === 'light' ? 'light' : 'none';
}

function readEquipmentProvider(provider) {
  try {
    if (typeof provider === 'function') return provider() || {};
    return provider || {};
  } catch {
    return {};
  }
}

function stableHistoryAppend(history, value) {
  history.push(Object.freeze(value));
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function cloneEquipmentSnapshot(equipment) {
  if (!equipment || typeof equipment !== 'object') return {};
  const output = {};
  for (const key of ['head', 'chest', 'back', 'mainHand', 'offHand', 'helmet', 'weapon', 'shield']) {
    if (equipment[key] != null) output[key] = equipment[key];
  }
  return output;
}

function readRootForMaterial(rootOrGetter) {
  try {
    return typeof rootOrGetter === 'function' ? rootOrGetter() : rootOrGetter;
  } catch {
    return null;
  }
}

function buildFrame({
  playerObject,
  equipment,
  motion,
  attack,
  outcome,
  timestamp,
  revision,
}) {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  const attackKind = normalizeAttackKind(attack?.kind ?? motion?.attackKind);
  const tuning = resolvePlayerAttackTuning(null, profile, attackKind === 'none' ? 'light' : attackKind);
  const phase = normalizePhase(motion, attack);
  const comboStep = clamp(Math.floor(finite(attack?.comboStep ?? motion?.attackComboStep, 0)), 0, 3);
  const animation = resolvePlayerAnimationPlan(profile, {
    movementState: motion?.state || 'idle',
    attackKind,
    comboStep,
    speedMps: finite(motion?.speedMps, 0),
    grounded: Boolean(motion?.isGrounded ?? true),
  });
  const socketPlan = buildPlayerEquipmentSocketPlan(playerObject, profile);
  const material = buildPlayerMaterialAssignmentMetadata({ object: playerObject, profile });
  const audit = auditPlayerEquipmentProfile(profile, { socketPlan });
  return Object.freeze({
    version: 1,
    revision,
    timestamp: finite(timestamp, 0),
    phase,
    attack: Object.freeze({
      kind: attackKind,
      comboStep,
      active: Boolean(attack?.active ?? motion?.attackActive),
      serial: Math.max(0, Math.floor(finite(attack?.serial, 0))),
      reachMeters: tuning.reach,
      damageScale: tuning.damageScale,
      staminaCost: tuning.cost,
      duration: tuning.duration,
      activeStart: tuning.activeStart,
      activeEnd: tuning.activeEnd,
      commitMeters: tuning.commitMeters,
      ranged: tuning.isRanged,
      twoHanded: tuning.twoHanded,
    }),
    defense: Object.freeze({
      guarding: Boolean(motion?.guarding),
      result: String(motion?.defenseResult || outcome?.outcome || 'none'),
      guardDamageMultiplier: tuning.guardDamageMultiplier,
      poiseMultiplier: tuning.poiseMultiplier,
      guardBreakMultiplier: tuning.guardBreakMultiplier,
    }),
    movement: Object.freeze({
      state: String(motion?.state || 'idle'),
      speedMps: finite(motion?.speedMps, 0),
      grounded: Boolean(motion?.isGrounded ?? true),
      staminaRatio: clamp(finite(motion?.staminaRatio, 1), 0, 1),
      poiseRatio: clamp(finite(motion?.poiseRatio, 1), 0, 1),
      movementMultiplier: tuning.movementMultiplier,
      dodgeDistanceMultiplier: tuning.dodgeDistanceMultiplier,
      staminaRegenMultiplier: tuning.staminaRegenMultiplier,
    }),
    animation,
    equipment: Object.freeze({
      mainHandId: profile.sourceIds.mainHand,
      offHandId: profile.sourceIds.offHand,
      chestId: profile.sourceIds.chest,
      headId: profile.sourceIds.head,
      backId: profile.sourceIds.back,
      shieldEquipped: profile.shieldEquipped,
      ranged: profile.ranged,
      twoHanded: profile.twoHanded,
    }),
    sockets: socketPlan,
    material,
    outcome: outcome ? Object.freeze({
      outcome: String(outcome.outcome || 'none'),
      serial: Math.max(0, Math.floor(finite(outcome.serial, 0))),
      appliedAmount: Math.max(0, finite(outcome.appliedAmount, 0)),
      blockedAmount: Math.max(0, finite(outcome.blockedAmount, 0)),
      rawAmount: Math.max(0, finite(outcome.rawAmount, 0)),
    }) : null,
    audit,
  });
}

export function createPlayerEquipmentCombatRuntime({
  player,
  equipmentProvider = () => ({}),
  target = globalThis,
  now = () => 0,
  emitFrames = true,
  onFrame = null,
  onAnimation = null,
  onEquipment = null,
  onAudit = null,
} = {}) {
  if (!player?.object3D) throw new TypeError('createPlayerEquipmentCombatRuntime requires player.object3D');

  let disposed = false;
  let revision = 0;
  let currentMotion = Object.freeze(player.getMotionState?.() || {});
  let currentAttack = Object.freeze({ kind: 'none', attackPhase: 'none', comboStep: 0, active: false, serial: 0 });
  let currentOutcome = null;
  let equipment = cloneEquipmentSnapshot(readEquipmentProvider(equipmentProvider));
  let frame = buildFrame({
    playerObject: player.object3D,
    equipment,
    motion: currentMotion,
    attack: currentAttack,
    outcome: currentOutcome,
    timestamp: now(),
    revision,
  });
  const history = [];
  const listeners = [];

  function subscribe(type, handler) {
    if (typeof target?.addEventListener !== 'function' || typeof handler !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push([type, handler]);
  }

  function publish(nextFrame) {
    stableHistoryAppend(history, nextFrame);
    if (typeof onFrame === 'function') {
      try { onFrame(nextFrame); } catch { /* consumer isolation */ }
    }
    if (typeof onAnimation === 'function') {
      try { onAnimation(nextFrame.animation, nextFrame); } catch { /* consumer isolation */ }
    }
    if (typeof onEquipment === 'function') {
      try { onEquipment(nextFrame.equipment, nextFrame.sockets, nextFrame); } catch { /* consumer isolation */ }
    }
    if (typeof onAudit === 'function') {
      try { onAudit(nextFrame.audit, nextFrame); } catch { /* consumer isolation */ }
    }
    if (emitFrames && typeof target?.dispatchEvent === 'function' && typeof target?.CustomEvent === 'function') {
      target.dispatchEvent(new target.CustomEvent(PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT, { detail: nextFrame }));
    }
  }

  function compose(timestamp = now(), { force = false, publishFrame = false } = {}) {
    if (disposed) return frame;
    const providerSnapshot = cloneEquipmentSnapshot(readEquipmentProvider(equipmentProvider));
    const equipmentChanged = JSON.stringify(providerSnapshot) !== JSON.stringify(equipment);
    if (equipmentChanged) equipment = providerSnapshot;
    if (force || equipmentChanged || publishFrame) revision += 1;
    frame = buildFrame({
      playerObject: player.object3D,
      equipment,
      motion: currentMotion,
      attack: currentAttack,
      outcome: currentOutcome,
      timestamp,
      revision,
    });
    if (force || equipmentChanged || publishFrame) publish(frame);
    return frame;
  }

  function onMotion(event) {
    currentMotion = Object.freeze(event?.detail || {});
    compose(event?.detail?.timestamp ?? now(), { publishFrame: true });
  }

  function onAttackWindow(event) {
    const detail = event?.detail || {};
    currentAttack = Object.freeze({
      kind: normalizeAttackKind(detail.kind),
      attackPhase: String(detail.phase || 'none'),
      comboStep: clamp(Math.floor(finite(detail.comboStep, 0)), 0, 3),
      active: Boolean(detail.active),
      serial: Math.max(0, Math.floor(finite(detail.serial, 0))),
      stamina: finite(detail.stamina, currentMotion?.stamina ?? 0),
      reachMeters: finite(detail.reachMeters, 0),
      damageScale: finite(detail.damageScale, 1),
    });
    compose(now(), { publishFrame: true });
  }

  function onFeedback(event) {
    currentOutcome = event?.detail ? Object.freeze({ ...event.detail }) : null;
    compose(now(), { publishFrame: true });
  }

  subscribe('aapw:player-motion', onMotion);
  subscribe('aapw:player-attack-window', onAttackWindow);
  subscribe('aapw:player-combat-feedback', onFeedback);

  function update(delta = 0, timestamp = now()) {
    if (disposed) return frame;
    const dt = clamp(finite(delta, 0), MIN_DT, MAX_DT);
    if (dt === 0) {
      const freshMotion = player.getMotionState?.();
      if (freshMotion) currentMotion = Object.freeze(freshMotion);
    }
    return compose(timestamp);
  }

  function refreshEquipment(timestamp = now()) {
    if (disposed) return frame;
    equipment = cloneEquipmentSnapshot(readEquipmentProvider(equipmentProvider));
    revision += 1;
    frame = buildFrame({
      playerObject: player.object3D,
      equipment,
      motion: currentMotion,
      attack: currentAttack,
      outcome: currentOutcome,
      timestamp,
      revision,
    });
    publish(frame);
    return frame;
  }

  function read() { return frame; }
  function readHistory() { return Object.freeze([...history]); }

  function materialAudit() {
    const nextProfile = resolvePlayerEquipmentCombatProfile(equipment);
    const socketPlan = buildPlayerEquipmentSocketPlan(player.object3D, nextProfile);
    return buildPlayerMaterialAssignmentMetadata({ object: player.object3D, profile: nextProfile });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [type, handler] of listeners.splice(0)) target.removeEventListener?.(type, handler);
    history.length = 0;
    currentOutcome = null;
  }

  return Object.freeze({ update, refreshEquipment, read, readHistory, materialAudit, dispose });
}

export function composePlayerEquipmentCombatFrame({ playerObject, equipment = {}, motion = {}, attack = {}, outcome = null, timestamp = 0, revision = 0 } = {}) {
  if (!playerObject) throw new TypeError('composePlayerEquipmentCombatFrame requires playerObject');
  return buildFrame({ playerObject, equipment: cloneEquipmentSnapshot(equipment), motion, attack, outcome, timestamp, revision });
}

export function isPlayerEquipmentCombatPhase(value) {
  return PLAYER_EQUIPMENT_COMBAT_PHASES.includes(String(value));
}
