/** Replay helpers for creature locomotion state synthesis. */
import { synthesizeCreatureLocomotionState } from './creatureLocomotionStateSynthesis.js';
import { createCreatureLocomotionTimeline, tickCreatureLocomotionTimeline } from './creatureLocomotionStateTimeline.js';

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 5) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_LOCOMOTION_REPLAY_VERSION = '2026-09-15-v1';

export function createCreatureLocomotionReplay(options = {}) {
  return {
    version: CREATURE_LOCOMOTION_REPLAY_VERSION,
    id: text(options.id, 'creature-replay'),
    inputs: [],
    states: [],
    timestamps: [],
    metadata: { ...options.metadata },
  };
}

export function appendCreatureLocomotionReplaySample(replay, input, state, timestamp) {
  const target = replay || createCreatureLocomotionReplay();
  target.inputs.push(input);
  target.states.push(state);
  target.timestamps.push(round(timestamp));
  return target;
}

export function replayCreatureLocomotionInputs(inputs = [], options = {}) {
  const replay = createCreatureLocomotionReplay(options);
  const timeline = createCreatureLocomotionTimeline();
  for (const input of inputs) {
    const result = tickCreatureLocomotionTimeline(timeline, input);
    appendCreatureLocomotionReplaySample(replay, input, result.state, result.timestamp);
  }
  replay.timeline = timeline;
  return replay;
}

export function synthesizeCreatureLocomotionFrames(inputs = [], options = {}) {
  const states = [];
  let previous = null;
  for (const input of inputs) {
    const state = synthesizeCreatureLocomotionState(input, previous);
    states.push(state);
    previous = state;
  }
  return freeze(states);
}

export function serializeCreatureLocomotionReplay(replay) {
  return JSON.stringify({
    version: replay?.version || CREATURE_LOCOMOTION_REPLAY_VERSION,
    id: replay?.id || 'creature-replay',
    inputs: replay?.inputs || [],
    states: replay?.states || [],
    timestamps: replay?.timestamps || [],
    metadata: replay?.metadata || {},
  });
}

export function deserializeCreatureLocomotionReplay(serialized) {
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized || {};
  const replay = createCreatureLocomotionReplay({ id: parsed.id, metadata: parsed.metadata });
  replay.version = text(parsed.version, replay.version);
  replay.inputs = [...(parsed.inputs || [])];
  replay.states = [...(parsed.states || [])];
  replay.timestamps = [...(parsed.timestamps || [])];
  return replay;
}

export function validateCreatureLocomotionReplay(replay) {
  const errors = [];
  if (!replay || typeof replay !== 'object') return ['replay must be an object'];
  if (!Array.isArray(replay.inputs)) errors.push('inputs must be an array');
  if (!Array.isArray(replay.states)) errors.push('states must be an array');
  if (!Array.isArray(replay.timestamps)) errors.push('timestamps must be an array');
  if (replay.inputs?.length !== replay.states?.length) errors.push('inputs/states length mismatch');
  if (replay.timestamps?.length !== replay.states?.length) errors.push('timestamps/states length mismatch');
  for (let index = 1; index < (replay.timestamps || []).length; index += 1) {
    if (replay.timestamps[index] < replay.timestamps[index - 1]) errors.push(`timestamps not monotonic at ${index}`);
  }
  return errors;
}

export function compareCreatureLocomotionReplay(left, right) {
  const a = left || createCreatureLocomotionReplay();
  const b = right || createCreatureLocomotionReplay();
  const length = Math.max(a.states.length, b.states.length);
  const differences = [];
  for (let index = 0; index < length; index += 1) {
    const leftState = a.states[index];
    const rightState = b.states[index];
    if (JSON.stringify(leftState) !== JSON.stringify(rightState)) {
      differences.push({
        index,
        leftState: leftState?.state || null,
        rightState: rightState?.state || null,
        leftGait: leftState?.gait || null,
        rightGait: rightState?.gait || null,
      });
    }
  }
  return freeze({ equal: differences.length === 0 && a.states.length === b.states.length, differences: freeze(differences) });
}

export function replayMatchesResynthesis(replay) {
  const expected = synthesizeCreatureLocomotionFrames(replay?.inputs || []);
  const actual = replay?.states || [];
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export function calculateCreatureReplayTransitionCount(replay) {
  let count = 0;
  let previous = null;
  for (const state of replay?.states || []) {
    if (previous && previous.state !== state.state) count += 1;
    previous = state;
  }
  return count;
}

export function calculateCreatureReplayGaitChanges(replay) {
  let count = 0;
  let previous = null;
  for (const state of replay?.states || []) {
    if (previous && previous.gait !== state.gait) count += 1;
    previous = state;
  }
  return count;
}

export function extractCreatureReplayEvents(replay) {
  return freeze((replay?.states || []).map((state, index) => ({ index, event: text(state?.event, 'none'), state: text(state?.state, 'idle'), timestamp: replay?.timestamps?.[index] ?? 0 })).filter((sample) => sample.event !== 'none'));
}

export function extractCreatureReplayFlightSegments(replay) {
  const flightStates = new Set(['takeoff', 'flight-climb', 'flight-cruise', 'flight-descend']);
  const segments = [];
  let current = null;
  for (let index = 0; index < (replay?.states || []).length; index += 1) {
    const state = replay.states[index];
    const timestamp = n(replay.timestamps[index]);
    if (flightStates.has(state?.state)) {
      if (!current) current = { startIndex: index, startTimestamp: timestamp, endIndex: index, endTimestamp: timestamp };
      current.endIndex = index;
      current.endTimestamp = timestamp;
    } else if (current) {
      segments.push(freeze({ ...current, durationSeconds: round(current.endTimestamp - current.startTimestamp) }));
      current = null;
    }
  }
  if (current) segments.push(freeze({ ...current, durationSeconds: round(current.endTimestamp - current.startTimestamp) }));
  return freeze(segments);
}

export function calculateCreatureReplayCoverage(replay) {
  const count = replay?.states?.length || 0;
  if (!count) return freeze({ samples: 0, uniqueStates: 0, uniqueGaits: 0, eventSamples: 0 });
  return freeze({
    samples: count,
    uniqueStates: new Set(replay.states.map((state) => state?.state)).size,
    uniqueGaits: new Set(replay.states.map((state) => state?.gait)).size,
    eventSamples: replay.states.filter((state) => state?.event && state.event !== 'none').length,
  });
}

export function createReplayCheckpoint(replay, index) {
  const cursor = Math.max(0, Math.min(replay?.states?.length || 0, Math.trunc(n(index))));
  return freeze({
    version: CREATURE_LOCOMOTION_REPLAY_VERSION,
    id: text(replay?.id, 'creature-replay'),
    index: cursor,
    timestamp: n(replay?.timestamps?.[cursor], 0),
    input: replay?.inputs?.[cursor] || null,
    state: replay?.states?.[cursor] || null,
  });
}

export function replayFromCheckpoint(replay, checkpoint, options = {}) {
  const start = Math.max(0, Math.trunc(n(checkpoint?.index)));
  const inputs = (replay?.inputs || []).slice(start);
  return replayCreatureLocomotionInputs(inputs, { ...options, id: `${text(replay?.id, 'creature-replay')}-resume` });
}

export function normalizeReplayForComparison(replay) {
  return freeze({
    inputs: replay?.inputs || [],
    states: (replay?.states || []).map((state) => ({
      state: state?.state,
      gait: state?.gait,
      event: state?.event,
      source: state?.source,
      confidence: state?.confidence,
    })),
    timestamps: (replay?.timestamps || []).map((timestamp) => round(timestamp, 3)),
  });
}

export function deterministicReplayFingerprint(replay) {
  const normalized = normalizeReplayForComparison(replay);
  const textValue = JSON.stringify(normalized);
  let hash = 2166136261;
  for (let index = 0; index < textValue.length; index += 1) {
    hash ^= textValue.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildCreatureReplayReport(replay) {
  const coverage = calculateCreatureReplayCoverage(replay);
  return freeze({
    version: CREATURE_LOCOMOTION_REPLAY_VERSION,
    valid: validateCreatureLocomotionReplay(replay).length === 0,
    matchesResynthesis: replayMatchesResynthesis(replay),
    fingerprint: deterministicReplayFingerprint(replay),
    coverage,
    transitionCount: calculateCreatureReplayTransitionCount(replay),
    gaitChangeCount: calculateCreatureReplayGaitChanges(replay),
    events: extractCreatureReplayEvents(replay),
    flightSegments: extractCreatureReplayFlightSegments(replay),
  });
}
