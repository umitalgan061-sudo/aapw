/**
 * Deterministic replay and comparison contract for player combat momentum.
 *
 * This file does not simulate player movement or damage. It records the already-published combat
 * outcome vocabulary and replays it through `playerCombatMomentumDirector` so regression suites,
 * tutorial tooling and future combat feedback layers can prove exact behavior without creating a
 * second player state machine.
 *
 * A tape contains only normalized scalar/event data. No DOM, Three.js, renderer, editor UI,
 * random source, wall-clock dependency or asset loading is allowed here.
 *
 * @module gameplay/playerCombatMomentumReplay
 */

import {
  PLAYER_COMBAT_MOMENTUM_VERSION,
  PLAYER_COMBAT_MOMENTUM_CONFIG,
  buildPlayerCombatMomentumDigest,
  simulatePlayerCombatMomentumSequence,
} from './playerCombatMomentumDirector.js';

export const PLAYER_COMBAT_MOMENTUM_REPLAY_VERSION = '2026-09-14-v1';
export const PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS = Object.freeze({
  MAX_EVENTS: 128,
  MAX_STRING_LENGTH: 64,
  MAX_TIMESTAMP_SECONDS: 86400,
  MAX_COMBO_STEP: 3,
  MAX_SERIAL: 1000000000,
});

const OUTCOMES = new Set([
  'light-hit',
  'heavy-hit',
  'guard',
  'parry',
  'dodge',
  'hit',
  'guard-break',
  'hit-stagger',
]);

const KINDS = new Set(['none', 'light', 'heavy']);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function int(value, fallback = 0) {
  const number = Math.floor(finite(value, fallback));
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_STRING_LENGTH) : fallback;
}

function normalizeTimestamp(value, fallback = 0) {
  const timestamp = finite(value, fallback);
  return clamp(timestamp, 0, PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_TIMESTAMP_SECONDS);
}

function normalizeOutcome(value) {
  const outcome = normalizeText(value, 'none');
  return OUTCOMES.has(outcome) ? outcome : 'none';
}

function normalizeKind(value) {
  const kind = normalizeText(value, 'none');
  return KINDS.has(kind) ? kind : 'none';
}

function normalizeEvent(event, fallbackTimestamp = 0, index = 0) {
  const source = event && typeof event === 'object' ? event : { outcome: event };
  return Object.freeze({
    index: Math.max(0, int(index, 0)),
    timestamp: normalizeTimestamp(source.timestamp, fallbackTimestamp),
    outcome: normalizeOutcome(source.outcome),
    kind: normalizeKind(source.kind),
    comboStep: clamp(int(source.comboStep, 0), 0, PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_COMBO_STEP),
    serial: clamp(int(source.serial, 0), 0, PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_SERIAL),
    source: normalizeText(source.source, 'replay'),
  });
}

function stableEventKey(event) {
  return [
    event.timestamp,
    event.outcome,
    event.kind,
    event.comboStep,
    event.serial,
    event.source,
  ].join('|');
}

function stableTapeKey(events) {
  let hash = 2166136261;
  for (const event of events) {
    const text = stableEventKey(event);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizePlayerCombatMomentumReplayTape(tape = []) {
  const source = Array.isArray(tape) ? tape : [];
  const events = [];
  let previousTimestamp = 0;
  for (let index = 0; index < source.length && events.length < PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_EVENTS; index += 1) {
    const event = normalizeEvent(source[index], previousTimestamp, index);
    if (event.outcome === 'none') continue;
    const timestamp = Math.max(previousTimestamp, event.timestamp);
    const ordered = Object.freeze({ ...event, timestamp });
    events.push(ordered);
    previousTimestamp = timestamp;
  }
  return Object.freeze(events);
}

export function validatePlayerCombatMomentumReplayTape(tape = []) {
  const errors = [];
  const events = normalizePlayerCombatMomentumReplayTape(tape);
  if (!Array.isArray(tape)) errors.push('tape-array');
  if (Array.isArray(tape) && tape.length > PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_EVENTS) errors.push('tape-size');
  let previousTimestamp = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!OUTCOMES.has(event.outcome)) errors.push(`event-${index}-outcome`);
    if (event.timestamp < previousTimestamp) errors.push(`event-${index}-timestamp-order`);
    if (!KINDS.has(event.kind)) errors.push(`event-${index}-kind`);
    if (event.comboStep < 0 || event.comboStep > PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_COMBO_STEP) errors.push(`event-${index}-combo-step`);
    if (event.serial < 0 || event.serial > PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_SERIAL) errors.push(`event-${index}-serial`);
    previousTimestamp = event.timestamp;
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), size: events.length });
}

export function createPlayerCombatMomentumReplayTape(events = []) {
  const normalized = normalizePlayerCombatMomentumReplayTape(events);
  const validation = validatePlayerCombatMomentumReplayTape(normalized);
  if (!validation.ok) throw new TypeError(`Invalid combat momentum replay tape: ${validation.errors.join(',')}`);
  return Object.freeze({
    version: PLAYER_COMBAT_MOMENTUM_REPLAY_VERSION,
    sourceVersion: PLAYER_COMBAT_MOMENTUM_VERSION,
    maxEvents: PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_EVENTS,
    size: normalized.length,
    key: stableTapeKey(normalized),
    events: normalized,
  });
}

function readTapeEvents(tape) {
  if (Array.isArray(tape)) return normalizePlayerCombatMomentumReplayTape(tape);
  if (tape && Array.isArray(tape.events)) return normalizePlayerCombatMomentumReplayTape(tape.events);
  return Object.freeze([]);
}

export function appendPlayerCombatMomentumReplayEvent(tape, event) {
  const events = readTapeEvents(tape);
  if (events.length >= PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_EVENTS) return createPlayerCombatMomentumReplayTape(events);
  return createPlayerCombatMomentumReplayTape([...events, event]);
}

export function replayPlayerCombatMomentumTape(tape, options = {}) {
  const events = readTapeEvents(tape);
  const simulation = simulatePlayerCombatMomentumSequence(events, {
    startTimestamp: finite(options.startTimestamp, 0),
    target: options.target,
    now: options.now,
  });
  const tapeKey = stableTapeKey(events);
  return Object.freeze({
    replayVersion: PLAYER_COMBAT_MOMENTUM_REPLAY_VERSION,
    sourceVersion: PLAYER_COMBAT_MOMENTUM_VERSION,
    tapeKey,
    eventCount: events.length,
    finalScore: simulation.finalScore,
    rank: simulation.rank,
    snapshot: simulation.snapshot,
    publicationHistory: simulation.history,
    digest: simulation.deterministicDigest,
  });
}

function canonicalSnapshot(snapshot) {
  return Object.freeze({
    score: finite(snapshot?.score, 0),
    rank: normalizeText(snapshot?.rank, 'neutral'),
    successStreak: int(snapshot?.successStreak, 0),
    defenseStreak: int(snapshot?.defenseStreak, 0),
    failureStreak: int(snapshot?.failureStreak, 0),
    bestSuccessStreak: int(snapshot?.bestSuccessStreak, 0),
    totalSuccesses: int(snapshot?.totalSuccesses, 0),
    totalDefenses: int(snapshot?.totalDefenses, 0),
    totalFailures: int(snapshot?.totalFailures, 0),
    finisherArmed: Boolean(snapshot?.finisherArmed),
    finisherGeneration: int(snapshot?.finisherGeneration, 0),
  });
}

export function comparePlayerCombatMomentumReplays(left, right) {
  const leftResult = left?.snapshot ? left : replayPlayerCombatMomentumTape(left);
  const rightResult = right?.snapshot ? right : replayPlayerCombatMomentumTape(right);
  const a = canonicalSnapshot(leftResult.snapshot);
  const b = canonicalSnapshot(rightResult.snapshot);
  const keys = Object.keys(a);
  const mismatches = [];
  for (const key of keys) {
    if (a[key] !== b[key]) mismatches.push(Object.freeze({ key, left: a[key], right: b[key] }));
  }
  return Object.freeze({
    equal: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
    leftDigest: leftResult.digest || buildPlayerCombatMomentumDigest(a),
    rightDigest: rightResult.digest || buildPlayerCombatMomentumDigest(b),
    leftTapeKey: leftResult.tapeKey || stableTapeKey(readTapeEvents(left)),
    rightTapeKey: rightResult.tapeKey || stableTapeKey(readTapeEvents(right)),
  });
}

export function diffPlayerCombatMomentumTapes(left, right) {
  const a = readTapeEvents(left);
  const b = readTapeEvents(right);
  const max = Math.max(a.length, b.length);
  const differences = [];
  for (let index = 0; index < max; index += 1) {
    const leftEvent = a[index] || null;
    const rightEvent = b[index] || null;
    if (stableEventKey(leftEvent || {}) !== stableEventKey(rightEvent || {})) {
      differences.push(Object.freeze({ index, left: leftEvent, right: rightEvent }));
    }
  }
  return Object.freeze({
    equal: differences.length === 0,
    leftSize: a.length,
    rightSize: b.length,
    differences: Object.freeze(differences),
  });
}

export function buildPlayerCombatMomentumReplayDigest(replay) {
  const result = replay?.snapshot ? replay : replayPlayerCombatMomentumTape(replay);
  const digestPayload = {
    replayVersion: PLAYER_COMBAT_MOMENTUM_REPLAY_VERSION,
    sourceVersion: PLAYER_COMBAT_MOMENTUM_VERSION,
    tapeKey: result.tapeKey,
    eventCount: result.eventCount,
    finalScore: result.finalScore,
    rank: result.rank,
    momentumDigest: result.digest,
  };
  let hash = 2166136261;
  const text = JSON.stringify(digestPayload);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function createCombatMomentumReplayHarness({ tape = [], options = {} } = {}) {
  const normalizedTape = createPlayerCombatMomentumReplayTape(tape);
  const first = replayPlayerCombatMomentumTape(normalizedTape, options);
  const second = replayPlayerCombatMomentumTape(normalizedTape, options);
  const comparison = comparePlayerCombatMomentumReplays(first, second);
  const tapeDiff = diffPlayerCombatMomentumTapes(normalizedTape, normalizedTape);
  const digest = buildPlayerCombatMomentumReplayDigest(first);
  return Object.freeze({
    tape: normalizedTape,
    first,
    second,
    comparison,
    tapeDiff,
    digest,
    deterministic: comparison.equal && tapeDiff.equal,
  });
}

export function createPlayerCombatMomentumScenarioCatalog() {
  const scenarios = [
    {
      id: 'clean-duel',
      label: 'Clean duel rhythm',
      events: [
        { outcome: 'parry', timestamp: 0.4, kind: 'light', serial: 1 },
        { outcome: 'light-hit', timestamp: 1.15, kind: 'light', comboStep: 1, serial: 2 },
        { outcome: 'heavy-hit', timestamp: 1.95, kind: 'heavy', comboStep: 2, serial: 3 },
        { outcome: 'dodge', timestamp: 2.7, serial: 4 },
        { outcome: 'heavy-hit', timestamp: 3.6, kind: 'heavy', comboStep: 3, serial: 5 },
      ],
    },
    {
      id: 'guard-pressure',
      label: 'Guard under pressure',
      events: [
        { outcome: 'guard', timestamp: 0.7, serial: 1 },
        { outcome: 'guard', timestamp: 1.4, serial: 2 },
        { outcome: 'parry', timestamp: 2.1, serial: 3 },
        { outcome: 'light-hit', timestamp: 2.95, kind: 'light', comboStep: 1, serial: 4 },
      ],
    },
    {
      id: 'recovery',
      label: 'Failure and recovery',
      events: [
        { outcome: 'heavy-hit', timestamp: 0.5, kind: 'heavy', comboStep: 1, serial: 1 },
        { outcome: 'hit-stagger', timestamp: 1.1, serial: 2 },
        { outcome: 'dodge', timestamp: 2.0, serial: 3 },
        { outcome: 'parry', timestamp: 2.8, serial: 4 },
        { outcome: 'heavy-hit', timestamp: 3.7, kind: 'heavy', comboStep: 2, serial: 5 },
      ],
    },
    {
      id: 'mixed-defense',
      label: 'Mixed defense chain',
      events: [
        { outcome: 'dodge', timestamp: 0.45, serial: 1 },
        { outcome: 'guard', timestamp: 1.25, serial: 2 },
        { outcome: 'parry', timestamp: 2.05, serial: 3 },
        { outcome: 'light-hit', timestamp: 2.9, kind: 'light', comboStep: 2, serial: 4 },
        { outcome: 'heavy-hit', timestamp: 3.8, kind: 'heavy', comboStep: 3, serial: 5 },
      ],
    },
  ];
  return Object.freeze(scenarios.map(scenario => Object.freeze({
    ...scenario,
    tape: createPlayerCombatMomentumReplayTape(scenario.events),
  })));
}

export function auditPlayerCombatMomentumReplayRuntime() {
  const scenarios = createPlayerCombatMomentumScenarioCatalog();
  const results = [];
  for (const scenario of scenarios) {
    const harness = createCombatMomentumReplayHarness({ tape: scenario.events });
    results.push(Object.freeze({
      id: scenario.id,
      label: scenario.label,
      eventCount: scenario.tape.size,
      tapeKey: scenario.tape.key,
      deterministic: harness.deterministic,
      digest: harness.digest,
      finalScore: harness.first.finalScore,
      rank: harness.first.rank,
    }));
  }
  const uniqueKeys = new Set(results.map(result => result.tapeKey));
  return Object.freeze({
    version: PLAYER_COMBAT_MOMENTUM_REPLAY_VERSION,
    sourceVersion: PLAYER_COMBAT_MOMENTUM_VERSION,
    maxEvents: PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS.MAX_EVENTS,
    configuredMaxDirectorDt: PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_DT_SECONDS,
    scenarioCount: scenarios.length,
    uniqueScenarioKeys: uniqueKeys.size,
    allDeterministic: results.every(result => result.deterministic),
    results: Object.freeze(results),
  });
}
