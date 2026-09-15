/**
 * Consumer bridge from synthesized creature locomotion state to generic presentation channels.
 * No renderer dependency and no direct bone mutation; creatureGait remains the sole bone consumer.
 */
import { projectCreatureGaitRequest, resolveCreatureAudioCue, resolveCreatureVfxCue, summarizeCreatureLocomotionState } from './creatureLocomotionStateSynthesis.js';

const DEFAULT_CHANNELS = Object.freeze(['locomotion', 'alert', 'airborne', 'contact', 'impact', 'slip', 'turn', 'social']);
const EVENT_POLICY = Object.freeze({
  none: { priority: 0, retrigger: false },
  'wander-enter': { priority: 10, retrigger: false },
  'wander-exit': { priority: 10, retrigger: false },
  'approach-enter': { priority: 30, retrigger: true },
  'flee-enter': { priority: 70, retrigger: true },
  'herd-alert': { priority: 76, retrigger: true },
  'flock-alert': { priority: 76, retrigger: true },
  'takeoff-enter': { priority: 100, retrigger: true },
  'landing-soft': { priority: 70, retrigger: true },
  'landing-hard': { priority: 96, retrigger: true },
  'ground-reacquired': { priority: 40, retrigger: false },
  blocked: { priority: 60, retrigger: true },
  'contact-unstable': { priority: 55, retrigger: true },
  'slip-recover': { priority: 55, retrigger: true },
  'gait-change': { priority: 25, retrigger: false },
  'pace-change': { priority: 20, retrigger: false },
  'confidence-drop': { priority: 50, retrigger: true },
  'confidence-recover': { priority: 20, retrigger: false },
});

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp01(value) { return Math.max(0, Math.min(1, n(value))); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_PRESENTATION_BRIDGE_VERSION = '2026-09-15-v1';

export function createCreatureLocomotionPresentationBridge(options = {}) {
  return {
    version: CREATURE_LOCOMOTION_PRESENTATION_BRIDGE_VERSION,
    id: text(options.id, 'creature-presentation'),
    enabledChannels: new Set(options.channels || DEFAULT_CHANNELS),
    lastEvent: 'none',
    lastTimestamp: 0,
    eventSequence: 0,
    emitted: [],
  };
}

export function normalizeCreaturePresentationChannels(state, channels = DEFAULT_CHANNELS) {
  const available = state?.presentation && typeof state.presentation === 'object' ? state.presentation : {};
  return freeze(Object.fromEntries(channels.map((channel) => [channel, round(clamp01(available[channel]))])));
}

export function resolveCreaturePresentationEventPolicy(eventName) {
  return freeze(EVENT_POLICY[text(eventName, 'none')] || EVENT_POLICY.none);
}

export function shouldEmitCreaturePresentationEvent(bridge, state, timestamp = 0) {
  const target = bridge || createCreatureLocomotionPresentationBridge();
  const event = text(state?.event, 'none');
  const policy = resolveCreaturePresentationEventPolicy(event);
  const now = Math.max(0, n(timestamp));
  if (event === 'none' || !policy.retrigger && event === target.lastEvent) return false;
  if (!policy.retrigger && now - target.lastTimestamp < 0.08) return false;
  return true;
}

export function buildCreaturePresentationEvent(state, timestamp = 0, sequence = 0) {
  const event = text(state?.event, 'none');
  const policy = resolveCreaturePresentationEventPolicy(event);
  return freeze({
    sequence,
    timestamp: round(timestamp),
    event,
    priority: policy.priority,
    cue: resolveCreatureAudioCue(state),
    vfxCue: resolveCreatureVfxCue(state),
    state: text(state?.state, 'idle'),
    gait: text(state?.gait, 'walk'),
  });
}

export function consumeCreatureLocomotionState(bridge, state, timestamp = 0) {
  const target = bridge || createCreatureLocomotionPresentationBridge();
  const channels = normalizeCreaturePresentationChannels(state, [...target.enabledChannels]);
  const gait = projectCreatureGaitRequest(state);
  const emit = shouldEmitCreaturePresentationEvent(target, state, timestamp);
  const event = emit ? buildCreaturePresentationEvent(state, timestamp, target.eventSequence) : null;
  if (emit) {
    target.eventSequence += 1;
    target.lastEvent = text(state?.event, 'none');
    target.lastTimestamp = n(timestamp);
    target.emitted.push(event);
    if (target.emitted.length > 64) target.emitted.splice(0, target.emitted.length - 64);
  }
  return freeze({
    bridgeId: target.id,
    version: target.version,
    summary: summarizeCreatureLocomotionState(state),
    channels,
    gait,
    audioCue: resolveCreatureAudioCue(state),
    vfxCue: resolveCreatureVfxCue(state),
    emittedEvent: event,
  });
}

export function consumeCreatureLocomotionSequence(bridge, states = [], timestamps = []) {
  const target = bridge || createCreatureLocomotionPresentationBridge();
  const outputs = [];
  for (let index = 0; index < states.length; index += 1) outputs.push(consumeCreatureLocomotionState(target, states[index], timestamps[index] ?? index / 60));
  return freeze(outputs);
}

export function getCreaturePresentationEmittedEvents(bridge) {
  return freeze([...(bridge?.emitted || [])]);
}

export function clearCreaturePresentationEvents(bridge) {
  if (bridge) {
    bridge.emitted = [];
    bridge.lastEvent = 'none';
    bridge.lastTimestamp = 0;
  }
  return bridge;
}

export function setCreaturePresentationChannelEnabled(bridge, channel, enabled = true) {
  const target = bridge || createCreatureLocomotionPresentationBridge();
  const name = text(channel);
  if (!DEFAULT_CHANNELS.includes(name)) return target;
  if (enabled) target.enabledChannels.add(name); else target.enabledChannels.delete(name);
  return target;
}

export function getCreaturePresentationChannels(bridge) {
  return freeze([...((bridge?.enabledChannels || new Set()).values())]);
}

export function createCreatureAnimationAdapterPayload(state, metadata = {}) {
  const gait = projectCreatureGaitRequest(state);
  return freeze({
    schema: 'creature-animation-adapter',
    version: CREATURE_LOCOMOTION_PRESENTATION_BRIDGE_VERSION,
    speciesId: text(state?.speciesId, text(metadata.speciesId, 'unknown')),
    state: text(state?.state, 'idle'),
    gait,
    channels: normalizeCreaturePresentationChannels(state),
    transition: freeze({ event: text(state?.event, 'none'), confidence: round(clamp01(state?.confidence)) }),
    ownership: freeze({ rig: 'creatureGait', movement: 'creatureBrain-or-caller', renderer: 'consumer' }),
  });
}

export function createCreatureAudioAdapterPayload(state) {
  return freeze({
    schema: 'creature-audio-adapter',
    state: text(state?.state, 'idle'),
    event: text(state?.event, 'none'),
    cue: resolveCreatureAudioCue(state),
    intensity: round(clamp01(state?.presentation?.alert || state?.presentation?.locomotion)),
  });
}

export function createCreatureVfxAdapterPayload(state) {
  return freeze({
    schema: 'creature-vfx-adapter',
    state: text(state?.state, 'idle'),
    event: text(state?.event, 'none'),
    cue: resolveCreatureVfxCue(state),
    intensity: round(clamp01(Math.max(state?.presentation?.impact || 0, state?.presentation?.alert || 0))),
  });
}

export function validateCreaturePresentationPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['payload-object'];
  if (!text(payload.schema)) errors.push('schema');
  if (!text(payload.state)) errors.push('state');
  if (!payload.gait) errors.push('gait');
  if (payload.channels && Object.values(payload.channels).some((value) => value < 0 || value > 1)) errors.push('channel-bounds');
  return errors;
}

export function serializeCreaturePresentationBridge(bridge) {
  return JSON.stringify({
    version: bridge?.version || CREATURE_LOCOMOTION_PRESENTATION_BRIDGE_VERSION,
    id: bridge?.id || 'creature-presentation',
    channels: [...(bridge?.enabledChannels || [])],
    lastEvent: bridge?.lastEvent || 'none',
    lastTimestamp: bridge?.lastTimestamp || 0,
    eventSequence: bridge?.eventSequence || 0,
    emitted: bridge?.emitted || [],
  });
}

export function hydrateCreaturePresentationBridge(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized || {};
  const bridge = createCreatureLocomotionPresentationBridge({ id: parsed.id, channels: parsed.channels });
  bridge.version = text(parsed.version, bridge.version);
  bridge.lastEvent = text(parsed.lastEvent, 'none');
  bridge.lastTimestamp = Math.max(0, n(parsed.lastTimestamp));
  bridge.eventSequence = Math.max(0, Math.trunc(n(parsed.eventSequence)));
  bridge.emitted = [...(parsed.emitted || [])];
  return bridge;
}

export function compareCreaturePresentationPayloads(left, right) {
  const normalize = (payload) => JSON.stringify({
    schema: payload?.schema,
    state: payload?.state,
    gait: payload?.gait,
    channels: payload?.channels,
    event: payload?.transition?.event || payload?.event,
  });
  return freeze({ equal: normalize(left) === normalize(right), left: normalize(left), right: normalize(right) });
}
