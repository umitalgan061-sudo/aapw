/**
 * Timeline and transition-window helpers for traversal presentation.
 *
 * This layer deliberately models presentation timing, not world simulation timing. Every decision is
 * based on caller snapshots and explicit elapsed durations. It can therefore be used by gameplay,
 * replay, offline inspection, and renderer adapters without coupling them to one another.
 */
import {
  PLAYER_TRAVERSAL_PRESENTATION_EVENTS,
  PLAYER_TRAVERSAL_PRESENTATION_PHASES,
  PLAYER_TRAVERSAL_PRESENTATION_STATES,
  buildPlayerTraversalPresentationState,
  getTraversalPhaseWeight,
  isTraversalPresentationState,
} from './playerTraversalPresentationPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_TIMELINE_VERSION = '2026-09-15-v1';

const WINDOWS = Object.freeze({
  approach: Object.freeze({ enter: 0.16, exit: 0.12 }),
  prepare: Object.freeze({ enter: 0.2, exit: 0.16 }),
  vault: Object.freeze({ enter: 0.12, execute: 0.52, exit: 0.18 }),
  climb: Object.freeze({ enter: 0.14, execute: 0.9, exit: 0.25 }),
  drop: Object.freeze({ enter: 0.1, execute: 0.58, exit: 0.2 }),
  land: Object.freeze({ contact: 0.22, recovery: 0.45, exit: 0.16 }),
  blocked: Object.freeze({ hold: 0.35, retry: 0.42 }),
  recover: Object.freeze({ enter: 0.12, hold: 0.28, exit: 0.18 }),
  cancelled: Object.freeze({ hold: 0.08 }),
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) {
  const f = 10 ** digits;
  const r = Math.round(finite(value) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
function freeze(value) { return Object.freeze(value); }

export function getPlayerTraversalPresentationWindows() {
  return freeze(JSON.parse(JSON.stringify(WINDOWS)));
}

export function getTraversalWindow(state, stage = 'enter') {
  return WINDOWS[state]?.[stage] ?? 0;
}

export function resolveTraversalTimelineProgress(state, elapsedSeconds = 0) {
  const elapsed = Math.max(0, finite(elapsedSeconds));
  if (state === 'clear') return 1;
  const window = Object.values(WINDOWS[state] ?? { hold: 1 }).reduce((sum, value) => sum + value, 0);
  if (window <= 0) return 0;
  return clamp01(elapsed / window);
}

export function resolveTraversalPhaseFromProgress(state, progress = 0) {
  const p = clamp01(progress);
  if (state === 'clear') return 'idle';
  if (state === 'approach' || state === 'prepare') return p < 0.6 ? 'anticipation' : 'commit';
  if (['vault', 'climb', 'drop'].includes(state)) {
    if (p < 0.25) return 'commit';
    if (p < 0.86) return 'execution';
    return 'contact';
  }
  if (state === 'land') return p < 0.34 ? 'contact' : 'recovery';
  if (state === 'recover') return p < 0.22 ? 'recovery' : p < 0.9 ? 'recovery' : 'terminal';
  return 'terminal';
}

export function buildTraversalTimelineEntry(previous = null, cue = {}) {
  const state = buildPlayerTraversalPresentationState(previous, cue);
  const elapsed = Math.max(0, finite(cue.elapsedSeconds));
  const progress = resolveTraversalTimelineProgress(state.state, elapsed);
  const phase = resolveTraversalPhaseFromProgress(state.state, progress);
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_TIMELINE_VERSION,
    timestampSeconds: round(finite(cue.clockSeconds, elapsed)),
    state: state.state,
    phase,
    event: state.event,
    progress: round(progress),
    phaseWeight: round(getTraversalPhaseWeight(phase)),
    confidence: state.confidence,
    terminal: state.terminal,
    metrics: freeze({ ...state.metrics }),
  });
}

export function appendTraversalTimeline(timeline = [], entry = {}) {
  const safe = timeline.filter(Boolean).slice();
  safe.push(freeze({ ...entry }));
  return freeze(safe);
}

export function compactTraversalTimeline(timeline = [], { maxEntries = 120 } = {}) {
  const limit = Math.max(1, Math.floor(finite(maxEntries, 120)));
  return freeze(timeline.filter(Boolean).slice(-limit));
}

export function groupTraversalTimelineByState(timeline = []) {
  const grouped = Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_STATES.map((state) => [state, []]));
  for (const entry of timeline) {
    if (isTraversalPresentationState(entry?.state)) grouped[entry.state].push(entry);
  }
  return freeze(Object.fromEntries(Object.entries(grouped).map(([key, value]) => [key, freeze(value)])));
}

export function groupTraversalTimelineByEvent(timeline = []) {
  const grouped = Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_EVENTS.map((event) => [event, []]));
  for (const entry of timeline) {
    const event = text(entry?.event, 'none');
    if (grouped[event]) grouped[event].push(entry);
  }
  return freeze(Object.fromEntries(Object.entries(grouped).map(([key, value]) => [key, freeze(value)])));
}

export function calculateTraversalTimelineDuration(timeline = []) {
  if (timeline.length < 2) return 0;
  const first = finite(timeline[0]?.timestampSeconds);
  const last = finite(timeline[timeline.length - 1]?.timestampSeconds);
  return round(Math.max(0, last - first));
}

export function calculateTraversalStateDurations(timeline = []) {
  const durations = Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_STATES.map((state) => [state, 0]));
  for (let index = 1; index < timeline.length; index += 1) {
    const current = timeline[index];
    const previous = timeline[index - 1];
    const delta = Math.max(0, finite(current?.timestampSeconds) - finite(previous?.timestampSeconds));
    const state = previous?.state;
    if (durations[state] != null) durations[state] += delta;
  }
  return freeze(Object.fromEntries(Object.entries(durations).map(([key, value]) => [key, round(value)])));
}

export function calculateTraversalEventCounts(timeline = []) {
  const counts = Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_EVENTS.map((event) => [event, 0]));
  for (const entry of timeline) {
    const event = text(entry?.event, 'none');
    if (counts[event] != null) counts[event] += 1;
  }
  return freeze(counts);
}

export function findTraversalSegments(timeline = [], state) {
  const segments = [];
  let open = null;
  for (const entry of timeline) {
    const matches = entry?.state === state;
    if (matches && !open) open = { state, start: entry.timestampSeconds, entries: [] };
    if (matches && open) open.entries.push(entry);
    if (!matches && open) {
      open.end = entry.timestampSeconds;
      segments.push(freeze({ ...open, duration: round(Math.max(0, open.end - open.start)), entries: freeze(open.entries) }));
      open = null;
    }
  }
  if (open) {
    const end = timeline.length ? timeline[timeline.length - 1].timestampSeconds : open.start;
    segments.push(freeze({ ...open, end, duration: round(Math.max(0, end - open.start)), entries: freeze(open.entries) }));
  }
  return freeze(segments);
}

export function deriveTraversalTimelineSummary(timeline = []) {
  const stateDurations = calculateTraversalStateDurations(timeline);
  const eventCounts = calculateTraversalEventCounts(timeline);
  const confidenceValues = timeline.map((entry) => clamp01(entry?.confidence));
  const confidenceAverage = confidenceValues.length ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : 0;
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_TIMELINE_VERSION,
    entries: timeline.length,
    durationSeconds: calculateTraversalTimelineDuration(timeline),
    states: stateDurations,
    events: eventCounts,
    confidence: freeze({
      average: round(confidenceAverage),
      minimum: round(confidenceValues.length ? Math.min(...confidenceValues) : 0),
      maximum: round(confidenceValues.length ? Math.max(...confidenceValues) : 0),
    }),
  });
}

export function validateTraversalTimeline(timeline = []) {
  const errors = [];
  let lastTimestamp = -Infinity;
  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index];
    if (!isTraversalPresentationState(entry?.state)) errors.push(`entry ${index}: invalid state`);
    if (!PLAYER_TRAVERSAL_PRESENTATION_PHASES.includes(entry?.phase)) errors.push(`entry ${index}: invalid phase`);
    if (!PLAYER_TRAVERSAL_PRESENTATION_EVENTS.includes(entry?.event)) errors.push(`entry ${index}: invalid event`);
    if (finite(entry?.timestampSeconds) < lastTimestamp) errors.push(`entry ${index}: timestamp regressed`);
    lastTimestamp = finite(entry?.timestampSeconds);
    if (clamp01(entry?.progress) !== entry?.progress) errors.push(`entry ${index}: progress out of range`);
    if (clamp01(entry?.confidence) !== entry?.confidence) errors.push(`entry ${index}: confidence out of range`);
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function detectTraversalTimelineGaps(timeline = [], maxGapSeconds = 0.25) {
  const gaps = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const gap = finite(timeline[index].timestampSeconds) - finite(timeline[index - 1].timestampSeconds);
    if (gap > maxGapSeconds) gaps.push(freeze({ index, gap: round(gap), from: timeline[index - 1], to: timeline[index] }));
  }
  return freeze(gaps);
}

export function resampleTraversalTimeline(timeline = [], sampleIntervalSeconds = 1 / 30) {
  if (!timeline.length) return freeze([]);
  const interval = Math.max(0.001, finite(sampleIntervalSeconds, 1 / 30));
  const start = finite(timeline[0].timestampSeconds);
  const end = finite(timeline[timeline.length - 1].timestampSeconds);
  const result = [];
  let sourceIndex = 0;
  for (let timestamp = start; timestamp <= end + interval / 2; timestamp += interval) {
    while (sourceIndex + 1 < timeline.length && finite(timeline[sourceIndex + 1].timestampSeconds) <= timestamp) sourceIndex += 1;
    const source = timeline[sourceIndex];
    result.push(freeze({ ...source, timestampSeconds: round(timestamp), sampled: true }));
  }
  return freeze(result);
}

export function interpolateTraversalChannel(left = {}, right = {}, alpha = 0.5) {
  const t = clamp01(alpha);
  return freeze({
    traversal: round(finite(left.traversal) + (finite(right.traversal) - finite(left.traversal)) * t),
    anticipation: round(finite(left.anticipation) + (finite(right.anticipation) - finite(left.anticipation)) * t),
    commitment: round(finite(left.commitment) + (finite(right.commitment) - finite(left.commitment)) * t),
    contact: round(finite(left.contact) + (finite(right.contact) - finite(left.contact)) * t),
    impact: round(finite(left.impact) + (finite(right.impact) - finite(left.impact)) * t),
    confidence: round(finite(left.confidence) + (finite(right.confidence) - finite(left.confidence)) * t),
  });
}

export function chooseTraversalTimelineEntryAt(timeline = [], timestampSeconds = 0) {
  if (!timeline.length) return null;
  const timestamp = finite(timestampSeconds);
  let closest = timeline[0];
  let distance = Math.abs(finite(closest.timestampSeconds) - timestamp);
  for (const entry of timeline.slice(1)) {
    const nextDistance = Math.abs(finite(entry.timestampSeconds) - timestamp);
    if (nextDistance < distance) {
      closest = entry;
      distance = nextDistance;
    }
  }
  return closest;
}
