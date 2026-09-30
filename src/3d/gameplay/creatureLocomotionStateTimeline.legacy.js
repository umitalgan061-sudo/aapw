/** Deterministic temporal helper for creature locomotion presentation states. */
import {
  CREATURE_LOCOMOTION_EVENTS,
  CREATURE_LOCOMOTION_STATES,
  synthesizeCreatureLocomotionState,
  normalizeCreatureLocomotionInput,
} from './creatureLocomotionStateSynthesis.js';

const MAX_HISTORY = 96;
const DEFAULT_WINDOW_SECONDS = 0.18;
const STATE_DWELL_SECONDS = Object.freeze({
  idle: 0.08,
  wander: 0.12,
  approach: 0.10,
  flee: 0.08,
  'herd-flee': 0.08,
  'flock-flee': 0.08,
  takeoff: 0.06,
  'flight-climb': 0.08,
  'flight-cruise': 0.16,
  'flight-descend': 0.12,
  'landing-soft': 0.10,
  'landing-hard': 0.16,
  'reacquire-ground': 0.10,
  turn: 0.06,
  brake: 0.08,
  recover: 0.14,
  blocked: 0.10,
  'contact-unstable': 0.12,
  'slip-recover': 0.14,
});

const EVENT_WINDOWS = Object.freeze({
  'takeoff-enter': 0.24,
  'airborne-enter': 0.28,
  'airborne-exit': 0.24,
  'landing-soft': 0.20,
  'landing-hard': 0.32,
  'ground-reacquired': 0.20,
  'herd-alert': 0.16,
  'flock-alert': 0.16,
  'flee-enter': 0.12,
  'flee-exit': 0.18,
  'gait-change': 0.12,
  'pace-change': 0.10,
  'confidence-drop': 0.24,
  'confidence-recover': 0.20,
});

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, n(value, min))); }
function clamp01(value) { return clamp(value, 0, 1); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) {
  const factor = 10 ** digits;
  const result = Math.round(n(value) * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}
function freeze(value) { return Object.freeze(value); }

export function createCreatureLocomotionTimeline(options = {}) {
  const maxHistory = Math.max(4, Math.min(MAX_HISTORY, Math.trunc(n(options.maxHistory, MAX_HISTORY))));
  return {
    version: '2026-09-15-v1',
    elapsedSeconds: Math.max(0, n(options.elapsedSeconds)),
    maxHistory,
    previous: null,
    history: [],
    transition: null,
    sequence: 0,
  };
}

export function appendCreatureLocomotionTimeline(timeline, state, timestamp = 0) {
  const target = timeline || createCreatureLocomotionTimeline();
  const sample = freeze({
    sequence: target.sequence,
    timestamp: round(Math.max(0, n(timestamp, target.elapsedSeconds))),
    state: text(state?.state, 'idle'),
    gait: text(state?.gait, 'walk'),
    event: text(state?.event, 'none'),
    confidence: round(clamp01(state?.confidence)),
    source: text(state?.source, 'fallback'),
  });
  target.history.push(sample);
  if (target.history.length > target.maxHistory) target.history.splice(0, target.history.length - target.maxHistory);
  target.previous = state || null;
  target.sequence += 1;
  target.elapsedSeconds = sample.timestamp;
  return target;
}

export function getCreatureLocomotionTimelineHistory(timeline) {
  return freeze([...(timeline?.history || [])]);
}

export function getCreatureLocomotionTimelineLatest(timeline) {
  return timeline?.history?.length ? timeline.history[timeline.history.length - 1] : null;
}

export function resolveCreatureTransitionWindow(previous, next, deltaSeconds = 1 / 60) {
  const fromState = text(previous?.state, 'idle');
  const toState = text(next?.state, fromState);
  const event = text(next?.event, 'none');
  const base = EVENT_WINDOWS[event] ?? STATE_DWELL_SECONDS[toState] ?? DEFAULT_WINDOW_SECONDS;
  const delta = clamp(n(deltaSeconds, 1 / 60), 0.001, 0.25);
  const changed = fromState !== toState || text(previous?.gait) !== text(next?.gait);
  const urgency = ['landing-hard', 'flee-enter', 'takeoff-enter', 'herd-alert', 'flock-alert'].includes(event) ? 1.25 : 1;
  const duration = round(base * urgency);
  return freeze({
    changed,
    fromState,
    toState,
    event,
    durationSeconds: duration,
    progressStep: round(Math.min(1, delta / Math.max(duration, delta))),
    interruptible: !['landing-hard', 'takeoff-enter'].includes(event),
  });
}

export function advanceCreatureLocomotionTransition(transition, deltaSeconds) {
  if (!transition) return null;
  const step = clamp(n(deltaSeconds, 1 / 60), 0.001, 0.25);
  const progress = clamp01(n(transition.progress) + step / Math.max(n(transition.durationSeconds, DEFAULT_WINDOW_SECONDS), step));
  return freeze({
    ...transition,
    progress: round(progress),
    active: progress < 1,
    remainingSeconds: round(Math.max(0, n(transition.durationSeconds) * (1 - progress))),
  });
}

export function beginCreatureLocomotionTransition(timeline, nextState, timestamp) {
  const previous = timeline?.previous;
  const window = resolveCreatureTransitionWindow(previous, nextState, n(nextState?.timing?.deltaSeconds, 1 / 60));
  const transition = freeze({ ...window, startedAt: round(n(timestamp, timeline?.elapsedSeconds)), progress: window.changed ? 0 : 1 });
  if (timeline) timeline.transition = transition;
  return transition;
}

export function tickCreatureLocomotionTimeline(timeline, input = {}, timestamp = null) {
  const target = timeline || createCreatureLocomotionTimeline();
  const normalized = normalizeCreatureLocomotionInput(input);
  const now = timestamp === null ? target.elapsedSeconds + normalized.deltaSeconds : Math.max(0, n(timestamp));
  const state = synthesizeCreatureLocomotionState({ ...normalized, previousState: target.previous?.state, previousGait: target.previous?.gait }, target.previous);
  const transition = beginCreatureLocomotionTransition(target, state, now);
  target.transition = advanceCreatureLocomotionTransition(transition, normalized.deltaSeconds);
  appendCreatureLocomotionTimeline(target, state, now);
  return freeze({ state, transition: target.transition, sequence: target.sequence - 1, timestamp: now });
}

export function sampleCreatureLocomotionTimeline(timeline, elapsedSeconds) {
  const history = timeline?.history || [];
  if (!history.length) return null;
  const time = n(elapsedSeconds);
  let candidate = history[0];
  for (const sample of history) {
    if (sample.timestamp > time) break;
    candidate = sample;
  }
  return candidate;
}

export function countCreatureLocomotionEvents(timeline, eventName = null) {
  const history = timeline?.history || [];
  if (eventName === null) return history.filter((item) => item.event !== 'none').length;
  return history.filter((item) => item.event === eventName).length;
}

export function listCreatureLocomotionStateSegments(timeline) {
  const history = timeline?.history || [];
  if (!history.length) return freeze([]);
  const segments = [];
  let current = null;
  for (let index = 0; index < history.length; index += 1) {
    const sample = history[index];
    if (!current || current.state !== sample.state || current.gait !== sample.gait) {
      if (current) current.endTimestamp = sample.timestamp;
      current = {
        state: sample.state,
        gait: sample.gait,
        startTimestamp: sample.timestamp,
        endTimestamp: sample.timestamp,
        durationSeconds: 0,
        sampleCount: 0,
      };
      segments.push(current);
    }
    current.sampleCount += 1;
    current.endTimestamp = sample.timestamp;
    current.durationSeconds = round(current.endTimestamp - current.startTimestamp);
  }
  return freeze(segments.map((segment) => freeze({ ...segment })));
}

export function summarizeCreatureLocomotionTimeline(timeline) {
  const history = timeline?.history || [];
  const counts = {};
  const gaitCounts = {};
  const eventCounts = {};
  let confidenceTotal = 0;
  for (const sample of history) {
    counts[sample.state] = (counts[sample.state] || 0) + 1;
    gaitCounts[sample.gait] = (gaitCounts[sample.gait] || 0) + 1;
    eventCounts[sample.event] = (eventCounts[sample.event] || 0) + 1;
    confidenceTotal += sample.confidence;
  }
  return freeze({
    sampleCount: history.length,
    elapsedSeconds: round(timeline?.elapsedSeconds),
    stateCounts: freeze({ ...counts }),
    gaitCounts: freeze({ ...gaitCounts }),
    eventCounts: freeze({ ...eventCounts }),
    averageConfidence: round(history.length ? confidenceTotal / history.length : 0),
  });
}

export function validateCreatureLocomotionTimeline(timeline) {
  const errors = [];
  if (!timeline || typeof timeline !== 'object') return ['timeline must be an object'];
  if (!Array.isArray(timeline.history)) errors.push('history must be an array');
  if (timeline.history && timeline.history.length > timeline.maxHistory) errors.push('history exceeds maxHistory');
  for (const sample of timeline.history || []) {
    if (!CREATURE_LOCOMOTION_STATES.includes(sample.state)) errors.push(`unknown state: ${sample.state}`);
    if (!CREATURE_LOCOMOTION_EVENTS.includes(sample.event)) errors.push(`unknown event: ${sample.event}`);
    if (!(sample.confidence >= 0 && sample.confidence <= 1)) errors.push(`invalid confidence: ${sample.confidence}`);
  }
  return errors;
}

export function trimCreatureLocomotionTimeline(timeline, beforeTimestamp) {
  const target = timeline || createCreatureLocomotionTimeline();
  const cutoff = n(beforeTimestamp);
  target.history = target.history.filter((sample) => sample.timestamp >= cutoff);
  if (target.previous && target.history.length === 0) target.previous = null;
  return target;
}

export function mergeCreatureLocomotionTimelines(left, right) {
  const combined = [...(left?.history || []), ...(right?.history || [])]
    .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
  const target = createCreatureLocomotionTimeline({ maxHistory: Math.max(left?.maxHistory || MAX_HISTORY, right?.maxHistory || MAX_HISTORY) });
  for (const sample of combined) appendCreatureLocomotionTimeline(target, sample, sample.timestamp);
  return target;
}

export function projectCreatureLocomotionTimelineWindow(timeline, startSeconds, endSeconds) {
  const start = n(startSeconds);
  const end = Math.max(start, n(endSeconds));
  return freeze((timeline?.history || []).filter((sample) => sample.timestamp >= start && sample.timestamp <= end));
}

export function calculateCreatureStateDutyCycle(timeline, stateName) {
  const segments = listCreatureLocomotionStateSegments(timeline);
  const target = text(stateName, 'idle');
  const total = Math.max(0, n(timeline?.elapsedSeconds));
  if (total <= 0) return 0;
  const covered = segments.filter((segment) => segment.state === target).reduce((sum, segment) => sum + segment.durationSeconds, 0);
  return round(clamp01(covered / total));
}

export function detectCreatureLocomotionThrash(timeline, minimumChanges = 4, windowSeconds = 1) {
  const history = timeline?.history || [];
  if (history.length < minimumChanges) return false;
  const end = history[history.length - 1].timestamp;
  const start = end - Math.max(0, n(windowSeconds));
  let changes = 0;
  let previous = null;
  for (const sample of history) {
    if (sample.timestamp < start) continue;
    if (previous && previous.state !== sample.state) changes += 1;
    previous = sample;
  }
  return changes >= minimumChanges;
}

export function stabilizeCreatureLocomotionState(previous, next, options = {}) {
  const hold = Math.max(0, n(options.minimumHoldSeconds, STATE_DWELL_SECONDS[next?.state] ?? DEFAULT_WINDOW_SECONDS));
  const elapsed = Math.max(0, n(options.elapsedSinceChange));
  if (!previous || previous.state === next?.state) return next;
  if (elapsed >= hold || ['landing-hard', 'takeoff'].includes(next?.state)) return next;
  return freeze({ ...previous, event: 'none', confidence: Math.min(previous.confidence, next.confidence) });
}

export function evaluateCreatureLocomotionTransition(previous, next) {
  const window = resolveCreatureTransitionWindow(previous, next, next?.timing?.deltaSeconds);
  const stateKnown = CREATURE_LOCOMOTION_STATES.includes(next?.state);
  const gaitKnown = typeof next?.gait === 'string';
  return freeze({
    ...window,
    valid: stateKnown && gaitKnown,
    stateChanged: previous?.state !== next?.state,
    gaitChanged: previous?.gait !== next?.gait,
    eventKnown: CREATURE_LOCOMOTION_EVENTS.includes(next?.event),
  });
}

export function replayCreatureLocomotionTimeline(inputs = [], options = {}) {
  const timeline = createCreatureLocomotionTimeline(options);
  for (const input of inputs) tickCreatureLocomotionTimeline(timeline, input);
  return timeline;
}

export function serializeCreatureLocomotionTimeline(timeline) {
  return JSON.stringify({
    version: timeline?.version || '2026-09-15-v1',
    elapsedSeconds: timeline?.elapsedSeconds || 0,
    maxHistory: timeline?.maxHistory || MAX_HISTORY,
    sequence: timeline?.sequence || 0,
    history: timeline?.history || [],
  });
}

export function deserializeCreatureLocomotionTimeline(serialized) {
  const value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  const timeline = createCreatureLocomotionTimeline({ maxHistory: value?.maxHistory });
  timeline.version = text(value?.version, timeline.version);
  timeline.elapsedSeconds = Math.max(0, n(value?.elapsedSeconds));
  timeline.sequence = Math.max(0, Math.trunc(n(value?.sequence)));
  for (const sample of value?.history || []) appendCreatureLocomotionTimeline(timeline, sample, sample.timestamp);
  return timeline;
}

export function normalizeCreatureLocomotionTimelineSamples(timeline) {
  const target = timeline || createCreatureLocomotionTimeline();
  let previousTime = -Infinity;
  target.history = target.history
    .map((sample, index) => {
      const timestamp = Math.max(previousTime, n(sample.timestamp));
      previousTime = timestamp;
      return freeze({ ...sample, sequence: index, timestamp: round(timestamp) });
    });
  target.sequence = target.history.length;
  target.elapsedSeconds = target.history.length ? target.history[target.history.length - 1].timestamp : 0;
  target.previous = target.history.length ? target.history[target.history.length - 1] : null;
  return target;
}

export function findCreatureLocomotionEventSamples(timeline, eventName) {
  const wanted = text(eventName, 'none');
  return freeze((timeline?.history || []).filter((sample) => sample.event === wanted));
}

export function findCreatureLocomotionStateSamples(timeline, stateName) {
  const wanted = text(stateName, 'idle');
  return freeze((timeline?.history || []).filter((sample) => sample.state === wanted));
}

export function calculateCreatureLocomotionChangeRate(timeline, windowSeconds = 5) {
  const history = timeline?.history || [];
  if (history.length < 2) return 0;
  const end = history[history.length - 1].timestamp;
  const start = end - Math.max(0.1, n(windowSeconds, 5));
  const window = history.filter((sample) => sample.timestamp >= start);
  if (window.length < 2) return 0;
  let changes = 0;
  for (let index = 1; index < window.length; index += 1) if (window[index].state !== window[index - 1].state) changes += 1;
  const duration = Math.max(0.1, window[window.length - 1].timestamp - window[0].timestamp);
  return round(changes / duration, 3);
}

export const CREATURE_STATE_DWELL_SECONDS = STATE_DWELL_SECONDS;
export const CREATURE_EVENT_TRANSITION_WINDOWS = EVENT_WINDOWS;
