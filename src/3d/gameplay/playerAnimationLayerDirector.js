/**
 * Deterministic overlay policy for the existing player animation director.
 *
 * This module does not own AnimationMixer, clip loading, combat timing, movement, or scene state.
 * It converts already-resolved semantic state into bounded upper/lower-body layer weights so the
 * existing animation runtime can apply them without creating a second player framework.
 *
 * @module gameplay/playerAnimationLayerDirector
 */

export const PLAYER_ANIMATION_LAYER_DIRECTOR_VERSION = '2026-09-17-v1';

const EPSILON = 0.0001;
const DEFAULTS = Object.freeze({
  locomotion: 1,
  upperBody: 0,
  additive: 0,
  lowerBody: 1,
});

const SEMANTIC_PROFILES = Object.freeze({
  idle: Object.freeze({ upperBody: 0, additive: 0, lowerBody: 1 }),
  locomotion: Object.freeze({ upperBody: 0, additive: 0, lowerBody: 1 }),
  sprint: Object.freeze({ upperBody: 0.05, additive: 0, lowerBody: 1 }),
  guard: Object.freeze({ upperBody: 0.9, additive: 0.15, lowerBody: 0.82 }),
  'light-attack': Object.freeze({ upperBody: 1, additive: 0.35, lowerBody: 0.75 }),
  'heavy-attack': Object.freeze({ upperBody: 1, additive: 0.5, lowerBody: 0.62 }),
  dodge: Object.freeze({ upperBody: 0.2, additive: 0.2, lowerBody: 0.95 }),
  'hit-stagger': Object.freeze({ upperBody: 0.85, additive: 0.45, lowerBody: 0.72 }),
  'ranged-aim': Object.freeze({ upperBody: 0.95, additive: 0.25, lowerBody: 0.9 }),
  'ranged-release': Object.freeze({ upperBody: 1, additive: 0.4, lowerBody: 0.78 }),
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(clamp(value).toFixed(4));
}

function normalizeSemanticState(value) {
  const normalized = String(value ?? 'idle').trim().toLowerCase();
  return SEMANTIC_PROFILES[normalized] ? normalized : 'idle';
}

function normalizeInterruptibility(value) {
  return clamp(finite(value, 1));
}

export function resolvePlayerAnimationLayerWeights({
  semanticState = 'idle',
  locomotionWeight = 1,
  combatWeight = 0,
  additiveWeight = 0,
  interruptibility = 1,
  contactConfidence = 1,
} = {}) {
  const semantic = normalizeSemanticState(semanticState);
  const profile = SEMANTIC_PROFILES[semantic];
  const combat = clamp(finite(combatWeight));
  const locomotion = clamp(finite(locomotionWeight, 1));
  const additive = clamp(finite(additiveWeight));
  const interrupt = normalizeInterruptibility(interruptibility);
  const contact = clamp(finite(contactConfidence, 1));
  const combatGate = combat * (1 - interrupt * 0.35);
  const contactGate = 0.65 + (contact * 0.35);

  const lowerBody = round((profile.lowerBody * locomotion * contactGate) + ((1 - locomotion) * 0.25));
  const upperBody = round(Math.max(profile.upperBody * combatGate, combat * 0.55));
  const additiveLayer = round(Math.max(profile.additive * combatGate, additive) * contactGate);

  return Object.freeze({
    semanticState: semantic,
    locomotion: round(locomotion),
    upperBody,
    lowerBody,
    additive: additiveLayer,
    total: round(Math.max(upperBody, lowerBody, additiveLayer)),
    combatGate: round(combatGate),
    contactGate: round(contactGate),
  });
}

export function resolvePlayerAnimationLayerReceipt({
  sequence = 0,
  semanticState = 'idle',
  locomotionWeight = 1,
  combatWeight = 0,
  additiveWeight = 0,
  interruptibility = 1,
  contactConfidence = 1,
  phase = 'steady',
} = {}) {
  const weights = resolvePlayerAnimationLayerWeights({
    semanticState,
    locomotionWeight,
    combatWeight,
    additiveWeight,
    interruptibility,
    contactConfidence,
  });
  const normalizedSequence = Math.max(0, Math.floor(finite(sequence)));
  const normalizedPhase = String(phase ?? 'steady').trim().toLowerCase() || 'steady';
  return Object.freeze({
    version: PLAYER_ANIMATION_LAYER_DIRECTOR_VERSION,
    sequence: normalizedSequence,
    phase: normalizedPhase,
    ...weights,
  });
}

export function createPlayerAnimationLayerDirector({ maxHistory = 32 } = {}) {
  const historyLimit = Math.max(1, Math.floor(finite(maxHistory, 32)));
  let disposed = false;
  let lastSequence = -1;
  const history = [];

  function assertLive() {
    if (disposed) throw new Error('player animation layer director is disposed');
  }

  return Object.freeze({
    update(input = {}) {
      assertLive();
      const sequence = Math.max(0, Math.floor(finite(input.sequence)));
      if (sequence <= lastSequence) throw new RangeError('animation layer sequence must increase');
      const receipt = resolvePlayerAnimationLayerReceipt({ ...input, sequence });
      lastSequence = sequence;
      history.push(receipt);
      if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
      return receipt;
    },
    snapshot() {
      assertLive();
      return Object.freeze(history.slice());
    },
    reset() {
      assertLive();
      history.length = 0;
      lastSequence = -1;
    },
    dispose() {
      disposed = true;
      history.length = 0;
    },
    isDisposed() {
      return disposed;
    },
  });
}

export function validatePlayerAnimationLayerReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!Number.isInteger(receipt.sequence) || receipt.sequence < 0) return false;
  if (!SEMANTIC_PROFILES[receipt.semanticState]) return false;
  return [receipt.locomotion, receipt.upperBody, receipt.lowerBody, receipt.additive]
    .every((value) => Number.isFinite(value) && value >= -EPSILON && value <= 1 + EPSILON);
}
