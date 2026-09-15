/**
 * High-level orchestration contract for creature locomotion presentation.
 * Composes contact policy, state synthesis, transition policy and consumer selectors without owning
 * movement, physics, skeletons, rendering or asset lifetime.
 */
import { buildCreatureContactLocomotionInput, projectCreatureContactPolicy } from './creatureLocomotionContactPolicy.js';
import { synthesizeCreatureLocomotionState, validateCreatureLocomotionState } from './creatureLocomotionStateSynthesis.js';
import { buildCreatureTransitionPolicy, resolveCreatureTransitionLayerWeights } from './creatureLocomotionTransitionPolicy.js';
import { selectCreatureConsumerSnapshot } from './creatureLocomotionStateSelectors.js';
import { normalizeCreatureLocomotionStateSchema } from './creatureLocomotionStateSchema.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, n(value, min))); }
function clamp01(value) { return clamp(value, 0, 1); }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_CONTRACT_VERSION = '2026-09-15-v1';

export function createCreatureLocomotionContract(options = {}) {
  return {
    version: CREATURE_LOCOMOTION_CONTRACT_VERSION,
    id: text(options.id, 'creature-contract'),
    previousState: null,
    sampleIndex: 0,
    lastTimestamp: 0,
  };
}

export function buildCreatureLocomotionContractInput(baseInput = {}, probe = {}) {
  const contact = buildCreatureContactLocomotionInput(baseInput, probe);
  return freeze({ ...contact, contactPolicy: projectCreatureContactPolicy(probe) });
}

export function synthesizeCreatureLocomotionContract(contract, baseInput = {}, probe = {}) {
  const target = contract || createCreatureLocomotionContract();
  const input = buildCreatureLocomotionContractInput(baseInput, probe);
  const state = synthesizeCreatureLocomotionState({ ...input, previousState: target.previousState?.state, previousGait: target.previousState?.gait }, target.previousState);
  const normalized = normalizeCreatureLocomotionStateSchema(state);
  target.previousState = normalized;
  target.sampleIndex += 1;
  target.lastTimestamp += n(input.deltaSeconds, 1 / 60);
  return freeze({
    version: target.version,
    id: target.id,
    sampleIndex: target.sampleIndex,
    timestamp: round(target.lastTimestamp, 5),
    state: normalized,
    selectors: selectCreatureConsumerSnapshot(normalized),
    validationErrors: freeze(validateCreatureLocomotionState(normalized)),
    contactPolicy: input.contactPolicy,
  });
}

export function resolveCreatureLocomotionContractTransition(previous, next, elapsedSeconds = 0) {
  const policy = buildCreatureTransitionPolicy(previous?.state, next?.state, {
    speedRatio: next?.cadence?.speedScale,
    urgency: next?.presentation?.alert,
  });
  return freeze({ policy, weights: resolveCreatureTransitionLayerWeights(policy, elapsedSeconds) });
}

export function buildCreatureLocomotionAnimationIntent(contractResult, metadata = {}) {
  const state = contractResult?.state || {};
  return freeze({
    schema: 'creature-locomotion-animation-intent',
    version: CREATURE_LOCOMOTION_CONTRACT_VERSION,
    speciesId: text(state.speciesId, text(metadata.speciesId, 'unknown')),
    state: text(state.state, 'idle'),
    gait: text(state.gait, 'walk'),
    gaitBlend: freeze({ ...(state.gaitBlend || {}) }),
    cadence: freeze({ ...(state.cadence || {}) }),
    contact: freeze({ ...(state.contact || {}) }),
    transitionEvent: text(state.event, 'none'),
    confidence: round(clamp01(state.confidence)),
    ownership: freeze({ movement: 'caller', rig: 'creatureGait', renderer: 'consumer' }),
  });
}

export function buildCreatureLocomotionAudioIntent(contractResult) {
  const state = contractResult?.state || {};
  const alert = clamp01(state.presentation?.alert);
  return freeze({
    schema: 'creature-locomotion-audio-intent',
    state: text(state.state, 'idle'),
    event: text(state.event, 'none'),
    intensity: round(Math.max(alert, clamp01(state.presentation?.locomotion))),
    airborne: clamp01(state.presentation?.airborne) > 0,
    social: clamp01(state.presentation?.social) > 0,
  });
}

export function buildCreatureLocomotionVfxIntent(contractResult) {
  const state = contractResult?.state || {};
  return freeze({
    schema: 'creature-locomotion-vfx-intent',
    state: text(state.state, 'idle'),
    event: text(state.event, 'none'),
    impact: round(clamp01(state.presentation?.impact)),
    slip: round(clamp01(state.presentation?.slip)),
    contact: round(clamp01(state.presentation?.contact)),
    airborne: round(clamp01(state.presentation?.airborne)),
  });
}

export function validateCreatureLocomotionContract(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return ['contract-result'];
  if (!result.state || typeof result.state !== 'object') errors.push('state');
  if (!Array.isArray(result.validationErrors)) errors.push('validationErrors');
  if (!result.selectors || typeof result.selectors !== 'object') errors.push('selectors');
  if (!result.contactPolicy || typeof result.contactPolicy !== 'object') errors.push('contactPolicy');
  return freeze(errors);
}

export function compareCreatureLocomotionContractResults(left, right) {
  return freeze({
    sameState: JSON.stringify(left?.state) === JSON.stringify(right?.state),
    sameSelectors: JSON.stringify(left?.selectors) === JSON.stringify(right?.selectors),
    sameValidation: JSON.stringify(left?.validationErrors) === JSON.stringify(right?.validationErrors),
    timestampDelta: round(n(right?.timestamp) - n(left?.timestamp)),
  });
}

export function cloneCreatureLocomotionContract(contract) {
  const source = contract || createCreatureLocomotionContract();
  const target = createCreatureLocomotionContract({ id: source.id });
  target.version = source.version;
  target.previousState = source.previousState ? normalizeCreatureLocomotionStateSchema(source.previousState) : null;
  target.sampleIndex = Math.max(0, Math.trunc(n(source.sampleIndex)));
  target.lastTimestamp = Math.max(0, n(source.lastTimestamp));
  return target;
}

export function serializeCreatureLocomotionContract(contract) {
  return JSON.stringify({
    version: contract?.version || CREATURE_LOCOMOTION_CONTRACT_VERSION,
    id: contract?.id || 'creature-contract',
    previousState: contract?.previousState || null,
    sampleIndex: contract?.sampleIndex || 0,
    lastTimestamp: contract?.lastTimestamp || 0,
  });
}

export function hydrateCreatureLocomotionContract(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized || {};
  const target = createCreatureLocomotionContract({ id: parsed.id });
  target.version = text(parsed.version, target.version);
  target.previousState = parsed.previousState ? normalizeCreatureLocomotionStateSchema(parsed.previousState) : null;
  target.sampleIndex = Math.max(0, Math.trunc(n(parsed.sampleIndex)));
  target.lastTimestamp = Math.max(0, n(parsed.lastTimestamp));
  return target;
}

export function buildCreatureLocomotionContractEnvelope(result, metadata = {}) {
  return freeze({
    schema: 'creature-locomotion-contract',
    version: CREATURE_LOCOMOTION_CONTRACT_VERSION,
    producer: text(metadata.producer, 'creatureLocomotionStateContract'),
    frame: n(result?.sampleIndex),
    timestamp: round(result?.timestamp, 5),
    animation: buildCreatureLocomotionAnimationIntent(result, metadata),
    audio: buildCreatureLocomotionAudioIntent(result),
    vfx: buildCreatureLocomotionVfxIntent(result),
    selectors: result?.selectors || null,
  });
}

export function runCreatureLocomotionContractSequence(frames = [], options = {}) {
  const contract = createCreatureLocomotionContract(options);
  const outputs = [];
  for (const frame of frames) {
    outputs.push(synthesizeCreatureLocomotionContract(contract, frame.input || frame, frame.probe || {}));
  }
  return freeze(outputs);
}

export function calculateCreatureLocomotionContractValidity(outputs = []) {
  if (!outputs.length) return 1;
  const valid = outputs.filter((output) => validateCreatureLocomotionContract(output).length === 0 && output.validationErrors.length === 0).length;
  return round(valid / outputs.length);
}

export function buildCreatureLocomotionContractHealth(outputs = []) {
  const validity = calculateCreatureLocomotionContractValidity(outputs);
  const last = outputs[outputs.length - 1];
  return freeze({
    validity,
    label: validity >= 0.99 ? 'healthy' : validity >= 0.9 ? 'degraded' : 'attention',
    lastState: text(last?.state?.state, 'idle'),
    lastGait: text(last?.state?.gait, 'walk'),
    lastConfidence: round(clamp01(last?.state?.confidence)),
  });
}
