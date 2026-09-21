/** Deterministic replay helpers for traversal presentation. */
import { buildPlayerTraversalPresentationState, compareTraversalPresentationState } from './playerTraversalPresentationPolicy.js';
import { appendTraversalTimeline, buildTraversalTimelineEntry } from './playerTraversalPresentationTimeline.js';

export const PLAYER_TRAVERSAL_PRESENTATION_REPLAY_VERSION = '2026-09-15-v1';
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }

export function encodeTraversalReplayRecord(cue, presentation, tickIndex = 0) {
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_REPLAY_VERSION,
    tickIndex,
    clockSeconds: round(cue?.clockSeconds ?? cue?.elapsedSeconds),
    cue: freeze({ ...cue }),
    state: presentation?.state ?? 'clear',
    phase: presentation?.phase ?? 'idle',
    event: presentation?.event ?? 'none',
    confidence: presentation?.confidence ?? 0,
  });
}

export function encodeTraversalReplay(records = []) {
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_REPLAY_VERSION,
    records: freeze(records.map((record) => freeze({ ...record }))),
    count: records.length,
  });
}

export function decodeTraversalReplay(input = {}) {
  if (!Array.isArray(input.records)) return freeze([]);
  return freeze(input.records.map((record) => ({ ...record })));
}

export function replayTraversalRecords(records = []) {
  let previous = null;
  let timeline = [];
  const outputs = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const cue = record.cue ?? record;
    const presentation = buildPlayerTraversalPresentationState(previous, cue);
    const timelineEntry = buildTraversalTimelineEntry(previous, cue);
    timeline = appendTraversalTimeline(timeline, timelineEntry);
    outputs.push(encodeTraversalReplayRecord(cue, presentation, index));
    previous = presentation;
  }
  return freeze({ outputs: freeze(outputs), timeline, finalState: previous });
}

export function verifyTraversalReplay(expectedRecords = [], actual = []) {
  const errors = [];
  const count = Math.max(expectedRecords.length, actual.length);
  for (let index = 0; index < count; index += 1) {
    const expected = expectedRecords[index];
    const observed = actual[index];
    if (!expected || !observed) {
      errors.push(`record ${index}: missing`);
      continue;
    }
    for (const key of ['state','phase','event']) if (expected[key] !== observed[key]) errors.push(`record ${index}: ${key} mismatch`);
    if (round(expected.confidence) !== round(observed.confidence)) errors.push(`record ${index}: confidence mismatch`);
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function replayAndVerifyTraversal(records = []) {
  const first = replayTraversalRecords(records);
  const second = replayTraversalRecords(records);
  const encodedFirst = JSON.stringify(first.outputs);
  const encodedSecond = JSON.stringify(second.outputs);
  return freeze({
    deterministic: encodedFirst === encodedSecond,
    sameFinalState: compareTraversalPresentationState(first.finalState, second.finalState),
    first,
    second,
    verification: verifyTraversalReplay(first.outputs, second.outputs),
  });
}

export function sliceTraversalReplay(records = [], start = 0, end = records.length) {
  return freeze(records.slice(Math.max(0, Math.floor(finite(start))), Math.max(0, Math.floor(finite(end)))));
}

export function summarizeTraversalReplay(records = []) {
  const replay = replayTraversalRecords(records);
  const counts = {};
  for (const record of replay.outputs) counts[record.state] = (counts[record.state] ?? 0) + 1;
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_REPLAY_VERSION,
    count: records.length,
    stateCounts: freeze(counts),
    finalState: replay.finalState?.state ?? 'clear',
    finalEvent: replay.finalState?.event ?? 'none',
  });
}

export function makeTraversalReplayFixture(seed, cues = []) {
  return encodeTraversalReplay(cues.map((cue, index) => ({
    ...cue,
    seed,
    tickIndex: index,
  })));
}
