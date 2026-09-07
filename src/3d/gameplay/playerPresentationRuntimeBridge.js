/**
 * Runtime-facing bridge for the existing player presentation chain.
 * It composes authoritative combat state, movement/equipment data and bounded feedback
 * cues without owning Three.js mixers, input devices, inventory or world placement.
 */

import { resolvePlayerPresentation } from './playerAnimationEquipmentDirector.js';
import { buildCombatFeedbackVfxCue } from './playerCombatFeedbackPresentation.js';

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function sanitizeMovement(movement = {}) {
  return Object.freeze({
    x: clamp(finite(movement.x), -1, 1),
    z: clamp(finite(movement.z), -1, 1),
    grounded: movement.grounded !== false,
    speedMps: clamp(finite(movement.speedMps), 0, 20),
  });
}

function sanitizeCombatState(combatState = {}) {
  return Object.freeze({
    action: typeof combatState.action === 'string' ? combatState.action : undefined,
    comboIndex: clamp(Math.trunc(finite(combatState.comboIndex)), 0, 3),
    lastResolvedHit: combatState.lastResolvedHit && typeof combatState.lastResolvedHit === 'object'
      ? Object.freeze({
          kind: typeof combatState.lastResolvedHit.kind === 'string' ? combatState.lastResolvedHit.kind : 'none',
          staggered: combatState.lastResolvedHit.staggered === true,
        })
      : undefined,
  });
}

export function buildPlayerPresentationFrame({ movement, combatState, equipment, feedback } = {}) {
  const safeMovement = sanitizeMovement(movement);
  const safeCombat = sanitizeCombatState(combatState);
  const animation = resolvePlayerPresentation({
    movement: { x: safeMovement.x, z: safeMovement.z },
    combatState: safeCombat,
    equipment,
  });
  const feedbackCue = feedback ? buildCombatFeedbackVfxCue(feedback) : null;
  return Object.freeze({
    animation,
    feedback: feedbackCue,
    locomotion: Object.freeze({
      grounded: safeMovement.grounded,
      speedMps: safeMovement.speedMps,
      blendWeight: clamp(safeMovement.speedMps / 8.2, 0, 1),
    }),
  });
}

export function createPlayerPresentationRuntimeBridge(initial = {}) {
  let state = Object.freeze({
    movement: sanitizeMovement(initial.movement),
    combatState: sanitizeCombatState(initial.combatState),
    equipment: initial.equipment && typeof initial.equipment === 'object' ? Object.freeze({ ...initial.equipment }) : Object.freeze({}),
    feedback: null,
  });
  const listeners = new Set();
  const emit = () => {
    const frame = buildPlayerPresentationFrame(state);
    for (const listener of listeners) listener(frame);
    return frame;
  };
  return Object.freeze({
    update(patch = {}) {
      state = Object.freeze({
        ...state,
        movement: patch.movement ? sanitizeMovement({ ...state.movement, ...patch.movement }) : state.movement,
        combatState: patch.combatState ? sanitizeCombatState({ ...state.combatState, ...patch.combatState }) : state.combatState,
        equipment: patch.equipment ? Object.freeze({ ...state.equipment, ...patch.equipment }) : state.equipment,
        feedback: patch.feedback === undefined ? state.feedback : patch.feedback,
      });
      return emit();
    },
    snapshot() { return buildPlayerPresentationFrame(state); },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { listeners.clear(); },
  });
}
