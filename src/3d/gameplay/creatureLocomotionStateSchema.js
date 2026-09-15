/** JSON-safe schema helpers for creature locomotion presentation snapshots. */
import { CREATURE_LOCOMOTION_EVENTS, CREATURE_LOCOMOTION_SOURCES, CREATURE_LOCOMOTION_STATES, enumerateCreatureLocomotionGaits } from './creatureLocomotionStateSynthesis.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, n(value, min))); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 5) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_STATE_SCHEMA_VERSION = '2026-09-15-v1';

const CHANNELS = Object.freeze(['locomotion', 'alert', 'airborne', 'contact', 'impact', 'slip', 'turn', 'social']);

export function createCreatureLocomotionStateSchemaDefaults() {
  return freeze({
    version: CREATURE_LOCOMOTION_STATE_SCHEMA_VERSION,
    speciesId: 'unknown',
    state: 'idle',
    source: 'fallback',
    priority: 10,
    event: 'none',
    confidence: 1,
    gait: 'walk',
    gaitBlend: freeze({ walk: 1 }),
    cadence: freeze({ cyclesPerSecond: 1, speedScale: 0 }),
    pace: freeze({ speedRatio: 0, acceleration: 0, braking: 0, moving: false }),
    contact: freeze({ plant: 1, air: 0, impact: 0, slip: 0 }),
    presentation: freeze(Object.fromEntries(CHANNELS.map((channel) => [channel, channel === 'contact' ? 1 : 0]))),
    rootMotion: freeze({ movementOwnedElsewhere: true, animationRootMotionAllowed: true, speedMps: 0, targetSpeedMps: 0 }),
    direction: freeze({ changed: false }),
    flight: freeze({ enabled: false, phase: 'grounded', altitudeMeters: 0, targetAltitudeMeters: 0, distanceMeters: 0 }),
    social: freeze({ alerted: false, sameSpecies: false, radiusMeters: 0 }),
    timing: freeze({ deltaSeconds: 1 / 60, gaitClockSeconds: 0 }),
  });
}

export function normalizeCreatureLocomotionStateSchema(state = {}) {
  const defaults = createCreatureLocomotionStateSchemaDefaults();
  const gait = enumerateCreatureLocomotionGaits().includes(text(state.gait, defaults.gait)) ? text(state.gait, defaults.gait) : defaults.gait;
  const stateName = CREATURE_LOCOMOTION_STATES.includes(text(state.state, defaults.state)) ? text(state.state, defaults.state) : defaults.state;
  const event = CREATURE_LOCOMOTION_EVENTS.includes(text(state.event, defaults.event)) ? text(state.event, defaults.event) : defaults.event;
  const source = CREATURE_LOCOMOTION_SOURCES.includes(text(state.source, defaults.source)) ? text(state.source, defaults.source) : defaults.source;
  const blend = state.gaitBlend && typeof state.gaitBlend === 'object' ? state.gaitBlend : defaults.gaitBlend;
  const channels = state.presentation && typeof state.presentation === 'object' ? state.presentation : defaults.presentation;
  return freeze({
    ...defaults,
    ...state,
    state: stateName,
    event,
    source,
    priority: Math.max(0, n(state.priority, defaults.priority)),
    confidence: clamp(state.confidence, 0, 1),
    gait,
    gaitBlend: freeze({ ...blend }),
    presentation: freeze(Object.fromEntries(CHANNELS.map((channel) => [channel, clamp(channels[channel], 0, 1)]))),
    timing: freeze({
      deltaSeconds: clamp(state.timing?.deltaSeconds, 0.001, 0.25),
      gaitClockSeconds: Math.max(0, n(state.timing?.gaitClockSeconds)),
    }),
  });
}

export function toCreatureLocomotionStateJson(state) {
  const normalized = normalizeCreatureLocomotionStateSchema(state);
  return JSON.stringify(normalized);
}

export function fromCreatureLocomotionStateJson(serialized) {
  const value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized || {};
  return normalizeCreatureLocomotionStateSchema(value);
}

export function getCreatureLocomotionStateJsonBytes(state) {
  const json = toCreatureLocomotionStateJson(state);
  return new TextEncoder().encode(json).byteLength;
}

export function stripCreatureLocomotionRuntimeOnlyFields(state) {
  const normalized = normalizeCreatureLocomotionStateSchema(state);
  const copy = JSON.parse(JSON.stringify(normalized));
  delete copy.version;
  delete copy.timing;
  return freeze(copy);
}

export function pickCreatureLocomotionConsumerFields(state) {
  const normalized = normalizeCreatureLocomotionStateSchema(state);
  return freeze({
    state: normalized.state,
    gait: normalized.gait,
    gaitBlend: normalized.gaitBlend,
    cadence: normalized.cadence,
    presentation: normalized.presentation,
    event: normalized.event,
    confidence: normalized.confidence,
  });
}

export function validateCreatureLocomotionStateSchema(state) {
  const errors = [];
  const normalized = normalizeCreatureLocomotionStateSchema(state);
  if (!CREATURE_LOCOMOTION_STATES.includes(normalized.state)) errors.push('state');
  if (!CREATURE_LOCOMOTION_EVENTS.includes(normalized.event)) errors.push('event');
  if (!CREATURE_LOCOMOTION_SOURCES.includes(normalized.source)) errors.push('source');
  if (!(normalized.confidence >= 0 && normalized.confidence <= 1)) errors.push('confidence');
  if (Object.values(normalized.presentation).some((value) => value < 0 || value > 1)) errors.push('presentation');
  return freeze(errors);
}

export function compareCreatureLocomotionStateSchema(left, right) {
  const a = pickCreatureLocomotionConsumerFields(left);
  const b = pickCreatureLocomotionConsumerFields(right);
  return freeze({ equal: JSON.stringify(a) === JSON.stringify(b), stateEqual: a.state === b.state, gaitEqual: a.gait === b.gait, eventEqual: a.event === b.event });
}

export function roundTripCreatureLocomotionStateSchema(state) {
  return fromCreatureLocomotionStateJson(toCreatureLocomotionStateJson(state));
}

export function createCreatureLocomotionStatePatch(before, after) {
  const a = normalizeCreatureLocomotionStateSchema(before);
  const b = normalizeCreatureLocomotionStateSchema(after);
  const patch = {};
  for (const key of ['state', 'source', 'priority', 'event', 'confidence', 'gait', 'cadence', 'pace', 'contact', 'presentation', 'rootMotion', 'direction', 'flight', 'social']) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) patch[key] = b[key];
  }
  return freeze(patch);
}

export function applyCreatureLocomotionStatePatch(state, patch) {
  return normalizeCreatureLocomotionStateSchema({ ...state, ...(patch || {}) });
}

export function estimateCreatureLocomotionStatePayloadCost(state) {
  const normalized = normalizeCreatureLocomotionStateSchema(state);
  return round(getCreatureLocomotionStateJsonBytes(normalized) / 1024, 3);
}
