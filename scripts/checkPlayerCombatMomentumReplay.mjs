import assert from 'node:assert/strict';
import {
  PLAYER_COMBAT_MOMENTUM_REPLAY_LIMITS as L,
  PLAYER_COMBAT_MOMENTUM_REPLAY_VERSION as V,
  auditPlayerCombatMomentumReplayRuntime,
  buildPlayerCombatMomentumReplayDigest,
  comparePlayerCombatMomentumReplays,
  createCombatMomentumReplayHarness,
  createPlayerCombatMomentumReplayTape,
  createPlayerCombatMomentumScenarioCatalog,
  diffPlayerCombatMomentumTapes,
  normalizePlayerCombatMomentumReplayTape,
  replayPlayerCombatMomentumTape,
  validatePlayerCombatMomentumReplayTape,
} from '../src/3d/gameplay/playerCombatMomentumReplay.js';

function pass(name, callback) {
  callback();
  console.log(`PASS ${name}`);
}

pass('version and limits are concrete', () => {
  assert.equal(V, '2026-09-14-v1');
  assert.ok(L.MAX_EVENTS >= 64);
  assert.ok(L.MAX_EVENTS <= 256);
  assert.equal(L.MAX_COMBO_STEP, 3);
});

pass('normalize removes malformed outcomes and preserves chronological order', () => {
  const tape = normalizePlayerCombatMomentumReplayTape([
    null,
    { outcome: 'heavy-hit', timestamp: 4, kind: 'heavy', comboStep: 3, serial: 2 },
    { outcome: 'light-hit', timestamp: 2, kind: 'light', serial: 3 },
    { outcome: 'not-real', timestamp: 5 },
    { outcome: 'parry', timestamp: 6, serial: 4 },
  ]);
  assert.equal(tape.length, 3);
  assert.equal(tape[0].timestamp, 4);
  assert.equal(tape[1].timestamp, 4);
  assert.equal(tape[2].timestamp, 6);
});

pass('validation catches non-array input and oversized raw tape', () => {
  const malformed = validatePlayerCombatMomentumReplayTape({});
  assert.equal(malformed.ok, false);
  const oversized = Array.from({ length: L.MAX_EVENTS + 1 }, (_, index) => ({
    outcome: 'light-hit',
    timestamp: index,
  }));
  const result = validatePlayerCombatMomentumReplayTape(oversized);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('tape-size'));
});

pass('tape creation includes deterministic identity', () => {
  const tape = createPlayerCombatMomentumReplayTape([
    { outcome: 'parry', timestamp: 0.5 },
    { outcome: 'heavy-hit', timestamp: 1.2, kind: 'heavy', comboStep: 3 },
  ]);
  assert.equal(tape.version, V);
  assert.equal(tape.size, 2);
  assert.equal(typeof tape.key, 'string');
  assert.equal(tape.key.length, 8);
});

pass('append respects the bounded tape limit', () => {
  const events = Array.from({ length: L.MAX_EVENTS }, (_, index) => ({
    outcome: 'light-hit',
    timestamp: index,
  }));
  let tape = createPlayerCombatMomentumReplayTape(events);
  const before = tape.size;
  const appended = createPlayerCombatMomentumReplayTape([...tape.events, { outcome: 'parry', timestamp: 999 }]);
  assert.equal(before, L.MAX_EVENTS);
  assert.equal(appended.size, L.MAX_EVENTS);
});

pass('same tape replays identically', () => {
  const events = [
    { outcome: 'parry', timestamp: 0.4, kind: 'light', serial: 1 },
    { outcome: 'light-hit', timestamp: 1.2, kind: 'light', comboStep: 1, serial: 2 },
    { outcome: 'heavy-hit', timestamp: 2, kind: 'heavy', comboStep: 3, serial: 3 },
    { outcome: 'dodge', timestamp: 2.8, serial: 4 },
  ];
  const a = replayPlayerCombatMomentumTape(events);
  const b = replayPlayerCombatMomentumTape(events);
  assert.deepEqual(a.snapshot, b.snapshot);
  assert.equal(a.digest, b.digest);
  assert.equal(a.tapeKey, b.tapeKey);
});

pass('equivalent tape objects compare equal', () => {
  const events = [
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.3, comboStep: 3, kind: 'heavy' },
  ];
  const a = createPlayerCombatMomentumReplayTape(events);
  const b = createPlayerCombatMomentumReplayTape(events);
  const comparison = comparePlayerCombatMomentumReplays(a, b);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.mismatches.length, 0);
});

pass('different event ordering changes the tape key and replay result', () => {
  const aEvents = [
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.3, comboStep: 3, kind: 'heavy' },
  ];
  const bEvents = [
    { outcome: 'heavy-hit', timestamp: 0.4, comboStep: 3, kind: 'heavy' },
    { outcome: 'parry', timestamp: 1.3 },
  ];
  const a = replayPlayerCombatMomentumTape(aEvents);
  const b = replayPlayerCombatMomentumTape(bEvents);
  assert.notEqual(a.tapeKey, b.tapeKey);
  assert.notEqual(a.digest, b.digest);
});

pass('tape diff identifies exact event positions', () => {
  const left = createPlayerCombatMomentumReplayTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'light-hit', timestamp: 1.2 },
  ]);
  const right = createPlayerCombatMomentumReplayTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.2, kind: 'heavy' },
    { outcome: 'dodge', timestamp: 2.1 },
  ]);
  const diff = diffPlayerCombatMomentumTapes(left, right);
  assert.equal(diff.equal, false);
  assert.equal(diff.leftSize, 2);
  assert.equal(diff.rightSize, 3);
  assert.equal(diff.differences[0].index, 1);
});

pass('harness reports deterministic replay', () => {
  const harness = createCombatMomentumReplayHarness({
    tape: [
      { outcome: 'parry', timestamp: 0.5 },
      { outcome: 'heavy-hit', timestamp: 1.25, comboStep: 3, kind: 'heavy' },
      { outcome: 'dodge', timestamp: 2.1 },
    ],
  });
  assert.equal(harness.deterministic, true);
  assert.equal(harness.comparison.equal, true);
  assert.equal(harness.tapeDiff.equal, true);
  assert.equal(typeof harness.digest, 'string');
});

pass('scenario catalog is unique and executable', () => {
  const scenarios = createPlayerCombatMomentumScenarioCatalog();
  assert.ok(scenarios.length >= 4);
  const keys = new Set(scenarios.map(scenario => scenario.tape.key));
  assert.equal(keys.size, scenarios.length);
  for (const scenario of scenarios) {
    const result = replayPlayerCombatMomentumTape(scenario.tape);
    assert.ok(Number.isFinite(result.finalScore));
    assert.ok(['neutral', 'focused', 'surging', 'finisher-ready'].includes(result.rank));
  }
});

pass('runtime audit is deterministic and all scenarios are clean', () => {
  const auditA = auditPlayerCombatMomentumReplayRuntime();
  const auditB = auditPlayerCombatMomentumReplayRuntime();
  assert.deepEqual(auditA, auditB);
  assert.equal(auditA.version, V);
  assert.equal(auditA.allDeterministic, true);
  assert.equal(auditA.uniqueScenarioKeys, auditA.scenarioCount);
});

pass('replay digest changes for meaningful state changes', () => {
  const a = replayPlayerCombatMomentumTape([
    { outcome: 'parry', timestamp: 0.5 },
    { outcome: 'heavy-hit', timestamp: 1.2, comboStep: 1, kind: 'heavy' },
  ]);
  const b = replayPlayerCombatMomentumTape([
    { outcome: 'parry', timestamp: 0.5 },
    { outcome: 'heavy-hit', timestamp: 1.2, comboStep: 3, kind: 'heavy' },
  ]);
  assert.notEqual(buildPlayerCombatMomentumReplayDigest(a), buildPlayerCombatMomentumReplayDigest(b));
});

pass('replay clamps long future timestamps to the declared deterministic envelope', () => {
  const replay = replayPlayerCombatMomentumTape([
    { outcome: 'parry', timestamp: Infinity },
    { outcome: 'heavy-hit', timestamp: Infinity, kind: 'heavy', comboStep: 3 },
  ]);
  assert.ok(Number.isFinite(replay.finalScore));
  assert.ok(replay.eventCount <= L.MAX_EVENTS);
});

pass('replay rejects no useful event without throwing', () => {
  const replay = replayPlayerCombatMomentumTape([
    null,
    { outcome: 'unknown', timestamp: 2 },
    { outcome: 'none', timestamp: 4 },
  ]);
  assert.equal(replay.eventCount, 0);
  assert.equal(replay.finalScore, 0);
  assert.equal(replay.rank, 'neutral');
});

console.log('PLAYER_COMBAT_MOMENTUM_REPLAY_PASS');
