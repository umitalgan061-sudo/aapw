import assert from 'node:assert/strict';
import {
  PLAYER_COMBAT_MOMENTUM_CONFIG as C,
  PLAYER_COMBAT_MOMENTUM_EVENT,
  buildPlayerCombatMomentumDigest,
  calculatePlayerCombatMomentumDelta,
  createPlayerCombatMomentumDirector,
  simulatePlayerCombatMomentumSequence,
  validatePlayerCombatMomentumSnapshot,
} from '../src/3d/gameplay/playerCombatMomentumDirector.js';
import {
  buildPlayerCombatMomentumReplayDigest,
  comparePlayerCombatMomentumReplays,
  createPlayerCombatMomentumReplayTape,
  diffPlayerCombatMomentumTapes,
  replayPlayerCombatMomentumTape,
  validatePlayerCombatMomentumReplayTape,
} from '../src/3d/gameplay/playerCombatMomentumReplay.js';

class EventTargetDouble {
  constructor() {
    this.listeners = new Map();
    this.events = [];
    this.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter(candidate => candidate !== listener));
  }
  dispatchEvent(event) {
    this.events.push(event);
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    return true;
  }
  emit(type, detail) {
    this.dispatchEvent(new this.CustomEvent(type, { detail }));
  }
  emittedDetails(type) {
    return this.events.filter(event => event.type === type).map(event => event.detail);
  }
}

function check(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check('score envelope is closed on both sides', () => {
  const low = calculatePlayerCombatMomentumDelta({ outcome: 'heavy-hit', timestamp: 1, previousTimestamp: 0 });
  const high = calculatePlayerCombatMomentumDelta({
    outcome: 'heavy-hit',
    timestamp: C.RHYTHM_IDEAL_SECONDS,
    previousTimestamp: 0,
    detail: { comboStep: C.MAX_STREAK },
    equipmentScale: { damageScale: 1000, movementMultiplier: 1000 },
  });
  assert.ok(Number.isFinite(low.delta));
  assert.ok(Number.isFinite(high.delta));
});

check('empty event target can construct and dispose', () => {
  const target = new EventTargetDouble();
  const director = createPlayerCombatMomentumDirector({ target, emit: true });
  assert.equal(target.emittedDetails(PLAYER_COMBAT_MOMENTUM_EVENT).length, 1);
  director.dispose();
});

check('motion values are normalized rather than trusted', () => {
  const target = new EventTargetDouble();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  target.emit('aapw:player-motion', {
    state: 42,
    speedMps: Infinity,
    staminaRatio: -10,
    poiseRatio: 50,
    isGrounded: false,
  });
  const snapshot = director.read();
  assert.equal(snapshot.motionState, 'idle');
  assert.equal(snapshot.speedMps, 0);
  assert.equal(snapshot.staminaRatio, 0);
  assert.equal(snapshot.poiseRatio, 1);
  assert.equal(snapshot.grounded, false);
  director.dispose();
});

check('equipment values cannot inject infinity into score calculations', () => {
  const target = new EventTargetDouble();
  const director = createPlayerCombatMomentumDirector({
    target,
    equipmentProvider: () => ({ attack: { damageScale: Infinity }, movement: { movementMultiplier: NaN } }),
    emit: false,
  });
  director.applyOutcome('parry', { comboStep: 3 }, 1);
  const snapshot = director.read();
  assert.ok(Number.isFinite(snapshot.score));
  assert.ok(Number.isFinite(snapshot.equipmentScale.damageScale));
  assert.ok(Number.isFinite(snapshot.equipmentScale.movementMultiplier));
  director.dispose();
});

const outcomeCases = [
  ['light-hit', true, false],
  ['heavy-hit', true, false],
  ['guard', true, true],
  ['parry', true, true],
  ['dodge', true, true],
  ['hit', false, false],
  ['guard-break', false, false],
  ['hit-stagger', false, false],
];

for (const [outcome, success, defense] of outcomeCases) {
  check(`outcome semantics ${outcome}`, () => {
    const result = calculatePlayerCombatMomentumDelta({ outcome, timestamp: 2, previousTimestamp: 1 });
    assert.equal(result.success, success);
    assert.equal(result.defense, defense);
    assert.ok(success ? result.delta > 0 : result.delta < 0);
  });
}

const comboCases = [
  { comboStep: 0, expectedMin: 0 },
  { comboStep: 1, expectedMin: 1 },
  { comboStep: 2, expectedMin: 1 },
  { comboStep: 3, expectedMin: 1 },
  { comboStep: 30, expectedMin: 1 },
  { comboStep: -20, expectedMin: 1 },
  { comboStep: Infinity, expectedMin: 1 },
  { comboStep: NaN, expectedMin: 1 },
];

for (const test of comboCases) {
  check(`combo normalization ${String(test.comboStep)}`, () => {
    const result = calculatePlayerCombatMomentumDelta({
      outcome: 'light-hit',
      timestamp: 1,
      previousTimestamp: 0,
      detail: { comboStep: test.comboStep },
    });
    assert.ok(result.delta >= test.expectedMin);
    assert.ok(Number.isFinite(result.delta));
  });
}

const timingCases = [
  [0.12, 0],
  [0.2, 0],
  [0.45, 0.5],
  [0.9, 1],
  [1.2, 0.9],
  [1.8, 0.7],
  [2.5, 0.3],
  [3.25, 0],
];

for (const [interval, floor] of timingCases) {
  check(`rhythm interval ${interval}`, () => {
    const result = calculatePlayerCombatMomentumDelta({
      outcome: 'parry',
      timestamp: interval,
      previousTimestamp: 0,
    });
    assert.ok(result.rhythmQuality >= floor);
    assert.ok(result.rhythmQuality <= 1);
  });
}

check('director reacts to attack finish but not attack start', () => {
  const target = new EventTargetDouble();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  target.emit('aapw:player-attack-window', { phase: 'start', kind: 'heavy', comboStep: 1, serial: 10 });
  assert.equal(director.read().totalActions, 0);
  target.emit('aapw:player-attack-window', { phase: 'finish', kind: 'heavy', comboStep: 1, serial: 10 });
  assert.equal(director.read().totalActions, 1);
  director.dispose();
});

check('unknown attack phase is inert', () => {
  const target = new EventTargetDouble();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  target.emit('aapw:player-attack-window', { phase: 'mystery', kind: 'heavy', comboStep: 3, serial: 1 });
  assert.equal(director.read().totalActions, 0);
  director.dispose();
});

check('equipment frame is observational and cannot overwrite score', () => {
  const target = new EventTargetDouble();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  director.applyOutcome('heavy-hit', {}, 1);
  const before = director.read().score;
  target.emit('aapw:player-equipment-combat-frame', {
    attack: { damageScale: 2 },
    movement: { movementMultiplier: 0.5 },
  });
  assert.equal(director.read().score, before);
  director.dispose();
});

check('repeated neutral updates remain finite', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  for (let index = 0; index < 100; index += 1) director.update(0.1, index / 10);
  const snapshot = director.read();
  assert.ok(Number.isFinite(snapshot.score));
  assert.ok(snapshot.score >= 0);
  assert.ok(snapshot.score <= C.MAX_SCORE);
  director.dispose();
});

check('success then failure produces a visible score drop', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  director.applyOutcome('parry', {}, 1);
  director.applyOutcome('heavy-hit', { comboStep: 3 }, 2);
  const before = director.read().score;
  director.applyOutcome('hit-stagger', {}, 3);
  assert.ok(director.read().score < before);
  assert.equal(director.read().successStreak, 0);
  assert.equal(director.read().failureStreak, 1);
  director.dispose();
});

check('success after failure starts a fresh success streak', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  director.applyOutcome('hit', {}, 1);
  director.applyOutcome('light-hit', {}, 2);
  const snapshot = director.read();
  assert.equal(snapshot.successStreak, 1);
  assert.equal(snapshot.failureStreak, 0);
  director.dispose();
});

check('finisher generation increments only when armed', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  const before = director.read().finisherGeneration;
  for (let index = 0; index < 32 && !director.read().finisherReady; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 0.75);
  }
  assert.equal(director.read().finisherGeneration, before + 1);
  director.dispose();
});

check('finisher does not arm without defense streak', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  for (let index = 0; index < 32; index += 1) {
    director.applyOutcome('heavy-hit', { comboStep: 3 }, index + 1);
  }
  assert.equal(director.read().defenseStreak, 0);
  assert.equal(director.read().finisherReady, false);
  director.dispose();
});

check('finisher does not arm below score threshold', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  director.applyOutcome('parry', {}, 1);
  director.applyOutcome('guard', {}, 2);
  director.applyOutcome('dodge', {}, 3);
  assert.ok(director.read().score < C.FINISHER_SCORE);
  assert.equal(director.read().finisherReady, false);
  director.dispose();
});

check('finisher cooldown blocks immediate re-arm', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  for (let index = 0; index < 32 && !director.read().finisherReady; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 1);
  }
  assert.equal(director.read().finisherReady, true);
  assert.equal(director.consumeFinisher(50), true);
  const generation = director.read().finisherGeneration;
  for (let index = 0; index < 12; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, 51 + index);
  }
  assert.equal(director.read().finisherGeneration, generation);
  director.dispose();
});

check('finisher can re-arm after cooldown and prerequisites', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  for (let index = 0; index < 32 && !director.read().finisherReady; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 1);
  }
  assert.equal(director.read().finisherReady, true);
  director.consumeFinisher(40);
  director.update(C.FINISHER_LOCKOUT_SECONDS, 42);
  for (let index = 0; index < 32 && !director.read().finisherReady; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, 43 + index);
  }
  assert.ok(director.read().finisherGeneration >= 2);
  director.dispose();
});

check('history records readiness transitions without unbounded growth', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  for (let index = 0; index < C.HISTORY_LIMIT * 3; index += 1) {
    director.applyOutcome(index % 4 === 0 ? 'parry' : 'light-hit', { comboStep: index % 4 }, index + 0.5);
  }
  assert.equal(director.readHistory().length, C.HISTORY_LIMIT);
  director.dispose();
});

check('snapshot validator accepts live snapshot', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  const validation = validatePlayerCombatMomentumSnapshot(director.read());
  assert.equal(validation.ok, true);
  director.dispose();
});

check('digest is deterministic after large state history', () => {
  const director = createPlayerCombatMomentumDirector({ target: new EventTargetDouble(), emit: false });
  for (let index = 0; index < 40; index += 1) {
    director.applyOutcome(index % 3 === 0 ? 'parry' : 'light-hit', { comboStep: index % 4 }, index + 1);
  }
  const a = buildPlayerCombatMomentumDigest(director.read(), director.readHistory());
  const b = buildPlayerCombatMomentumDigest({ ...director.read() }, [...director.readHistory()]);
  assert.equal(a, b);
  director.dispose();
});

check('replay tape rejects future-invalid source but normalizes safely', () => {
  const tape = createPlayerCombatMomentumReplayTape([
    { outcome: 'parry', timestamp: -100 },
    { outcome: 'heavy-hit', timestamp: Infinity, kind: 'heavy', comboStep: 99 },
    { outcome: 'light-hit', timestamp: NaN, kind: 'light', serial: -4 },
  ]);
  assert.equal(tape.size, 3);
  assert.equal(tape.events[0].timestamp, 0);
  assert.equal(tape.events[1].timestamp >= tape.events[0].timestamp, true);
  assert.ok(tape.events[1].comboStep <= 3);
  assert.ok(tape.events[2].serial >= 0);
  assert.equal(validatePlayerCombatMomentumReplayTape(tape).ok, true);
});

check('replay result preserves canonical event count', () => {
  const tape = createPlayerCombatMomentumReplayTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'light-hit', timestamp: 1.3, comboStep: 2 },
    { outcome: 'heavy-hit', timestamp: 2.2, comboStep: 3 },
  ]);
  const result = replayPlayerCombatMomentumTape(tape);
  assert.equal(result.eventCount, 3);
  assert.ok(result.tapeKey.length === 8);
  assert.ok(Number.isFinite(result.finalScore));
});

check('replay comparison exposes no mismatch on identical input', () => {
  const tape = createPlayerCombatMomentumReplayTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.1, comboStep: 3 },
  ]);
  const left = replayPlayerCombatMomentumTape(tape);
  const right = replayPlayerCombatMomentumTape(tape);
  const comparison = comparePlayerCombatMomentumReplays(left, right);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.mismatches.length, 0);
});

check('replay comparison exposes mismatch on score-changing input', () => {
  const left = replayPlayerCombatMomentumTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.1, comboStep: 1 },
  ]);
  const right = replayPlayerCombatMomentumTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.1, comboStep: 3 },
  ]);
  const comparison = comparePlayerCombatMomentumReplays(left, right);
  assert.equal(comparison.equal, false);
  assert.ok(comparison.mismatches.length > 0);
});

check('tape diff is empty for duplicate tapes', () => {
  const tape = createPlayerCombatMomentumReplayTape([
    { outcome: 'dodge', timestamp: 0.4 },
    { outcome: 'parry', timestamp: 1.1 },
  ]);
  const diff = diffPlayerCombatMomentumTapes(tape, tape);
  assert.equal(diff.equal, true);
  assert.equal(diff.differences.length, 0);
});

check('replay digest includes source and replay version', () => {
  const replay = replayPlayerCombatMomentumTape([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.1, kind: 'heavy' },
  ]);
  const digest = buildPlayerCombatMomentumReplayDigest(replay);
  assert.equal(typeof digest, 'string');
  assert.ok(digest.includes(':'));
});

check('sequence helper does not mutate input records', () => {
  const input = [
    Object.freeze({ outcome: 'parry', timestamp: 0.5 }),
    Object.freeze({ outcome: 'heavy-hit', timestamp: 1.3, comboStep: 3 }),
  ];
  const before = JSON.stringify(input);
  const result = simulatePlayerCombatMomentumSequence(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.snapshot.totalSuccesses, 2);
});

check('malformed simulation sequence is fail-safe', () => {
  const result = simulatePlayerCombatMomentumSequence(null);
  assert.equal(result.finalScore, 0);
  assert.equal(result.rank, 'neutral');
  assert.ok(typeof result.deterministicDigest === 'string');
});

check('duplicate timestamps remain deterministic', () => {
  const events = [
    { outcome: 'parry', timestamp: 1 },
    { outcome: 'heavy-hit', timestamp: 1, comboStep: 3 },
    { outcome: 'light-hit', timestamp: 1, comboStep: 1 },
  ];
  const a = simulatePlayerCombatMomentumSequence(events);
  const b = simulatePlayerCombatMomentumSequence(events);
  assert.deepEqual(a.snapshot, b.snapshot);
  assert.equal(a.deterministicDigest, b.deterministicDigest);
});

check('reordered equal-time events remain intentionally distinguishable', () => {
  const a = simulatePlayerCombatMomentumSequence([
    { outcome: 'parry', timestamp: 1 },
    { outcome: 'heavy-hit', timestamp: 1, comboStep: 3 },
  ]);
  const b = simulatePlayerCombatMomentumSequence([
    { outcome: 'heavy-hit', timestamp: 1, comboStep: 3 },
    { outcome: 'parry', timestamp: 1 },
  ]);
  assert.notEqual(a.deterministicDigest, b.deterministicDigest);
});

console.log('PLAYER_COMBAT_MOMENTUM_ACCEPTANCE_PASS');
