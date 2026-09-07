/**
 * Thin event adapter for the shipped player controller.
 * It observes the existing attack-window and combat-feedback events and feeds the
 * already-owned presentation bridge; it does not own movement, combat, animation or equipment state.
 */

import { createPlayerPresentationRuntimeBridge } from './playerPresentationRuntimeBridge.js';

export const PLAYER_ATTACK_WINDOW_EVENT = 'aapw:player-attack-window';
export const PLAYER_COMBAT_FEEDBACK_EVENT = 'aapw:player-combat-feedback';

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const asObject = (value) => (value && typeof value === 'object' ? value : {});

function readMovement(getMovement) {
  return typeof getMovement === 'function' ? asObject(getMovement()) : {};
}

function readEquipment(getEquipment) {
  return typeof getEquipment === 'function' ? asObject(getEquipment()) : {};
}

function toCombatState(detail, prior = {}) {
  const source = asObject(detail);
  const kind = typeof source.kind === 'string' ? source.kind : undefined;
  const phase = typeof source.phase === 'string' ? source.phase : undefined;
  const action = kind === 'light' || kind === 'heavy' ? kind : (phase === 'start' ? prior.action : undefined);
  return {
    ...prior,
    action,
    comboIndex: Math.max(0, Math.min(3, Math.trunc(finite(source.comboStep ?? prior.comboIndex, 0)))),
    lastResolvedHit: prior.lastResolvedHit,
  };
}

function toFeedback(detail) {
  const source = asObject(detail);
  return {
    outcome: typeof source.outcome === 'string' ? source.outcome : 'unknown',
    appliedAmount: finite(source.appliedAmount),
    blockedAmount: finite(source.blockedAmount),
    stamina: finite(source.stamina),
    poise: finite(source.poise),
    serial: Math.max(0, Math.trunc(finite(source.serial))),
    position: {
      x: finite(source.position?.x),
      y: finite(source.position?.y),
      z: finite(source.position?.z),
    },
  };
}

export function attachPlayerCombatRuntimeAdapter({
  target = globalThis,
  getMovement,
  getEquipment,
  initial = {},
  onFrame,
} = {}) {
  const bridge = createPlayerPresentationRuntimeBridge(initial);
  let combatState = { ...asObject(initial.combatState) };
  const emit = (patch = {}) => {
    const frame = bridge.update({
      movement: readMovement(getMovement),
      equipment: readEquipment(getEquipment),
      ...patch,
    });
    if (typeof onFrame === 'function') onFrame(frame);
    return frame;
  };
  const onAttackWindow = (event) => {
    combatState = toCombatState(event?.detail, combatState);
    emit({ combatState });
  };
  const onCombatFeedback = (event) => {
    const feedback = toFeedback(event?.detail);
    combatState = {
      ...combatState,
      lastResolvedHit: { kind: feedback.outcome, staggered: feedback.outcome === 'hit-stagger' },
    };
    emit({ combatState, feedback });
  };
  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener(PLAYER_ATTACK_WINDOW_EVENT, onAttackWindow);
    target.addEventListener(PLAYER_COMBAT_FEEDBACK_EVENT, onCombatFeedback);
  }
  return Object.freeze({
    snapshot: () => bridge.snapshot(),
    update: (patch) => emit(patch),
    dispose: () => {
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener(PLAYER_ATTACK_WINDOW_EVENT, onAttackWindow);
        target.removeEventListener(PLAYER_COMBAT_FEEDBACK_EVENT, onCombatFeedback);
      }
      bridge.dispose();
    },
  });
}
