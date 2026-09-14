import assert from 'node:assert/strict';
import {
  PLAYER_COMBAT_MOMENTUM_CONFIG as C,
  PLAYER_COMBAT_MOMENTUM_EVENT,
  PLAYER_COMBAT_MOMENTUM_RANKS,
  calculatePlayerCombatMomentumDelta,
  calculatePlayerCombatRhythmQuality,
  buildPlayerCombatMomentumDigest,
  createPlayerCombatMomentumDirector,
  resolvePlayerCombatMomentumRank,
  simulatePlayerCombatMomentumSequence,
  validatePlayerCombatMomentumSnapshot,
} from '../src/3d/gameplay/playerCombatMomentumDirector.js';

class TestTarget {
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

  addEventListener(type, handler) {
    const bucket = this.listeners.get(type) || [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type, handler) {
    const bucket = this.listeners.get(type) || [];
    this.listeners.set(type, bucket.filter(candidate => candidate !== handler));
  }

  dispatchEvent(event) {
    this.events.push(event);
    for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
    return true;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new this.CustomEvent(type, { detail }));
  }

  count(type) {
    return this.events.filter(event => event.type === type).length;
  }

  last(type) {
    const filtered = this.events.filter(event => event.type === type);
    return filtered[filtered.length - 1] || null;
  }
}

function run(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('rank thresholds are explicit and monotonic', () => {
  assert.equal(resolvePlayerCombatMomentumRank(0), 'neutral');
  assert.equal(resolvePlayerCombatMomentumRank(C.FOCUSED_SCORE), 'focused');
  assert.equal(resolvePlayerCombatMomentumRank(C.SURGING_SCORE), 'surging');
  assert.equal(resolvePlayerCombatMomentumRank(C.FINISHER_SCORE), 'finisher-ready');
  for (let index = 0; index < C.MAX_SCORE; index += 1) {
    assert.ok(PLAYER_COMBAT_MOMENTUM_RANKS.includes(resolvePlayerCombatMomentumRank(index)));
  }
});

run('rhythm quality rejects malformed and out-of-band intervals', () => {
  assert.equal(calculatePlayerCombatRhythmQuality(Number.NaN), 0);
  assert.equal(calculatePlayerCombatRhythmQuality(-1), 0);
  assert.equal(calculatePlayerCombatRhythmQuality(C.RHYTHM_MIN_SECONDS / 2), 0);
  assert.equal(calculatePlayerCombatRhythmQuality(C.RHYTHM_MAX_SECONDS + 1), 0);
  assert.equal(calculatePlayerCombatRhythmQuality(C.RHYTHM_IDEAL_SECONDS), 1);
});

run('successful outcomes generate positive deltas', () => {
  for (const outcome of ['light-hit', 'heavy-hit', 'guard', 'parry', 'dodge']) {
    const result = calculatePlayerCombatMomentumDelta({
      outcome,
      timestamp: 1,
      previousTimestamp: 0,
      detail: { comboStep: 1, kind: outcome === 'heavy-hit' ? 'heavy' : 'light' },
    });
    assert.ok(result.delta > 0, `${outcome} delta should be positive`);
    assert.equal(result.success, true);
  }
});

run('failure outcomes generate negative deltas', () => {
  for (const outcome of ['hit', 'guard-break', 'hit-stagger']) {
    const result = calculatePlayerCombatMomentumDelta({
      outcome,
      timestamp: 1,
      previousTimestamp: 0,
    });
    assert.ok(result.delta < 0, `${outcome} delta should be negative`);
    assert.equal(result.failure, true);
  }
});

run('equipment envelope is deterministic and bounded', () => {
  const base = calculatePlayerCombatMomentumDelta({
    outcome: 'heavy-hit',
    timestamp: 1,
    previousTimestamp: 0,
    equipmentScale: { damageScale: 1, movementMultiplier: 1 },
  });
  const boosted = calculatePlayerCombatMomentumDelta({
    outcome: 'heavy-hit',
    timestamp: 1,
    previousTimestamp: 0,
    equipmentScale: { damageScale: 2.5, movementMultiplier: 1.4 },
  });
  const malformed = calculatePlayerCombatMomentumDelta({
    outcome: 'heavy-hit',
    timestamp: 1,
    previousTimestamp: 0,
    equipmentScale: { damageScale: Infinity, movementMultiplier: -500 },
  });
  assert.ok(boosted.delta >= base.delta);
  assert.ok(Number.isFinite(malformed.delta));
});

run('director starts neutral and publishes an initialization evidence event', () => {
  let clock = 0;
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, now: () => clock });
  const snapshot = director.read();
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.rank, 'neutral');
  assert.equal(snapshot.finisherReady, false);
  assert.equal(target.count(PLAYER_COMBAT_MOMENTUM_EVENT), 1);
  assert.equal(target.last(PLAYER_COMBAT_MOMENTUM_EVENT)?.detail.reason, 'initialized');
  director.dispose();
});

run('motion stream updates presentation context without creating momentum', () => {
  let clock = 0;
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, now: () => clock });
  target.emit('aapw:player-motion', {
    timestamp: 2,
    state: 'sprint',
    isGrounded: true,
    speedMps: 7.2,
    staminaRatio: 0.74,
    poiseRatio: 0.81,
  });
  const snapshot = director.read();
  assert.equal(snapshot.motionState, 'sprint');
  assert.equal(snapshot.speedMps, 7.2);
  assert.equal(snapshot.grounded, true);
  assert.equal(snapshot.staminaRatio, 0.74);
  assert.equal(snapshot.poiseRatio, 0.81);
  assert.equal(snapshot.totalActions, 0);
  director.dispose();
});

run('equipment frame changes influence without changing score', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, now: () => 10 });
  target.emit('aapw:player-equipment-combat-frame', {
    attack: { damageScale: 1.65 },
    movement: { movementMultiplier: 0.8 },
  });
  const snapshot = director.read();
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.equipmentScale.damageScale, 1.65);
  assert.equal(snapshot.equipmentScale.movementMultiplier, 0.8);
  director.dispose();
});

run('parry plus successful attacks raises streaks and score', () => {
  const target = new TestTarget();
  let clock = 0;
  const director = createPlayerCombatMomentumDirector({ target, now: () => clock, emit: false });
  director.applyOutcome('parry', { source: 'test', kind: 'light' }, 0.5);
  clock = 1.1;
  director.applyOutcome('light-hit', { comboStep: 1, kind: 'light' }, clock);
  clock = 2;
  director.applyOutcome('heavy-hit', { comboStep: 2, kind: 'heavy' }, clock);
  clock = 2.8;
  director.applyOutcome('light-hit', { comboStep: 3, kind: 'light' }, clock);
  const snapshot = director.read();
  assert.ok(snapshot.score > 0);
  assert.equal(snapshot.totalSuccesses, 4);
  assert.equal(snapshot.bestSuccessStreak, 4);
  assert.equal(snapshot.totalDefenses, 1);
  assert.equal(snapshot.defenseStreak, 1);
  assert.ok(snapshot.rank !== 'neutral');
  director.dispose();
});

run('same timestamp does not create a fake rhythm bonus', () => {
  const delta = calculatePlayerCombatMomentumDelta({
    outcome: 'light-hit',
    timestamp: 5,
    previousTimestamp: 5,
    detail: { comboStep: 3 },
  });
  assert.equal(delta.rhythmQuality, 0);
  assert.ok(delta.delta > 0);
});

run('finisher readiness needs both score and combat prerequisites', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, now: () => 0, emit: false });
  for (let index = 0; index < 8; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 1);
  }
  const snapshot = director.read();
  assert.ok(snapshot.score >= C.FINISHER_SCORE || snapshot.finisherReady === false);
  if (snapshot.score >= C.FINISHER_SCORE) {
    assert.equal(snapshot.finisherReady, true);
    assert.equal(snapshot.rank, 'finisher-ready');
  }
  director.dispose();
});

run('failure cancels finisher readiness and resets success streak', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, now: () => 0, emit: false });
  const state = director;
  for (let index = 0; index < 20 && !state.read().finisherReady; index += 1) {
    state.applyOutcome(index % 4 === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 1);
  }
  const before = state.read();
  state.applyOutcome('hit-stagger', {}, 30);
  const after = state.read();
  assert.equal(after.finisherReady, false);
  assert.equal(after.successStreak, 0);
  assert.ok(after.totalFailures >= before.totalFailures);
  assert.ok(after.finisherCooldownRemaining >= 0);
  state.dispose();
});

run('update decays score with explicit bounded delta', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, now: () => 0, emit: false });
  director.applyOutcome('heavy-hit', {}, 1);
  const before = director.read().score;
  director.update(0.1, 1.1);
  const after = director.read().score;
  assert.ok(after < before);
  assert.ok(after >= 0);
  director.update(9, 2);
  assert.ok(director.read().score >= 0);
  director.dispose();
});

run('consumeFinisher is idempotent when not armed', () => {
  const director = createPlayerCombatMomentumDirector({ target: new TestTarget(), emit: false });
  assert.equal(director.consumeFinisher(1), false);
  assert.equal(director.consumeFinisher(1), false);
  director.dispose();
});

run('consumeFinisher closes the window and applies lockout', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  for (let index = 0; index < 30 && !director.read().finisherReady; index += 1) {
    const outcome = index % 5 === 0 ? 'parry' : index % 3 === 0 ? 'light-hit' : 'heavy-hit';
    director.applyOutcome(outcome, { comboStep: 3 }, index * 0.8 + 0.5);
  }
  if (!director.read().finisherReady) {
    throw new Error(`test setup did not arm finisher; score=${director.read().score}`);
  }
  const consumed = director.consumeFinisher(25);
  assert.equal(consumed, true);
  const snapshot = director.read();
  assert.equal(snapshot.finisherReady, false);
  assert.equal(snapshot.finisherWindowRemaining, 0);
  assert.equal(snapshot.finisherCooldownRemaining, C.FINISHER_LOCKOUT_SECONDS);
  assert.equal(snapshot.successStreak, 0);
  assert.equal(snapshot.defenseStreak, 0);
  director.dispose();
});

run('reset clears history, combat envelope and score', () => {
  const director = createPlayerCombatMomentumDirector({ target: new TestTarget(), emit: false });
  director.applyOutcome('parry', {}, 1);
  director.applyOutcome('heavy-hit', {}, 2);
  assert.ok(director.readHistory().length > 0);
  const reset = director.reset(3);
  assert.equal(reset.score, 0);
  assert.equal(reset.successStreak, 0);
  assert.equal(reset.totalSuccesses, 0);
  assert.equal(reset.finisherReady, false);
  assert.equal(director.readHistory().length, 0);
  director.dispose();
});

run('dispose stops event-driven state changes', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  director.dispose();
  target.emit('aapw:player-combat-feedback', { outcome: 'heavy-hit', timestamp: 1 });
  assert.equal(director.read().score, 0);
});

run('history is bounded and immutable', () => {
  const director = createPlayerCombatMomentumDirector({ target: new TestTarget(), emit: false });
  for (let index = 0; index < C.HISTORY_LIMIT + 10; index += 1) {
    director.applyOutcome(index % 2 ? 'light-hit' : 'parry', { comboStep: 1 }, index + 1);
  }
  const history = director.readHistory();
  assert.equal(history.length, C.HISTORY_LIMIT);
  assert.throws(() => history.push({}), TypeError);
  director.dispose();
});

run('outcome event stream maps directly onto the existing contract', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  target.emit('aapw:player-combat-feedback', {
    serial: 4,
    outcome: 'parry',
    rawAmount: 12,
    appliedAmount: 0,
    blockedAmount: 12,
    timestamp: 1,
  });
  const snapshot = director.read();
  assert.equal(snapshot.lastOutcome, 'parry');
  assert.equal(snapshot.totalDefenses, 1);
  assert.equal(snapshot.lastAttackSerial, 4);
  director.dispose();
});

run('attack window finish produces one successful offensive sample', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  target.emit('aapw:player-attack-window', {
    serial: 7,
    kind: 'heavy',
    phase: 'start',
    comboStep: 1,
    active: false,
  });
  target.emit('aapw:player-attack-window', {
    serial: 7,
    kind: 'heavy',
    phase: 'finish',
    comboStep: 1,
    active: false,
    damageScale: 1.4,
  });
  const snapshot = director.read();
  assert.equal(snapshot.totalSuccesses, 1);
  assert.equal(snapshot.lastOutcome, 'heavy-hit');
  assert.equal(snapshot.lastActionKind, 'heavy');
  assert.equal(snapshot.lastAttackSerial, 7);
  director.dispose();
});

run('non-terminal attack phases do not generate a hit sample', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  for (const phase of ['start', 'active-start', 'active-end', 'recovery', 'interrupted']) {
    target.emit('aapw:player-attack-window', {
      serial: 2,
      kind: 'light',
      phase,
      comboStep: 1,
    });
  }
  assert.equal(director.read().totalSuccesses, 0);
  director.dispose();
});

run('malformed feedback is ignored without throwing', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  target.emit('aapw:player-combat-feedback', null);
  target.emit('aapw:player-combat-feedback', { outcome: 'unknown', timestamp: Infinity });
  assert.equal(director.read().totalActions, 0);
  director.dispose();
});

run('snapshot validator is fail-closed', () => {
  const director = createPlayerCombatMomentumDirector({ target: new TestTarget(), emit: false });
  const snapshot = director.read();
  const valid = validatePlayerCombatMomentumSnapshot(snapshot);
  assert.equal(valid.ok, true);
  const invalid = validatePlayerCombatMomentumSnapshot({ score: 101, rank: 'unknown' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length >= 2);
  director.dispose();
});

run('digest is stable under equivalent snapshots', () => {
  const snapshot = {
    score: 55.123456,
    rank: 'surging',
    successStreak: 4,
    defenseStreak: 1,
    failureStreak: 0,
    bestSuccessStreak: 4,
    totalSuccesses: 4,
    totalDefenses: 1,
    totalFailures: 0,
    finisherArmed: false,
    finisherGeneration: 0,
  };
  const a = buildPlayerCombatMomentumDigest(snapshot, [1, 2, 3]);
  const b = buildPlayerCombatMomentumDigest({ ...snapshot }, [1, 2, 3]);
  assert.equal(a, b);
});

run('simulation helper is deterministic for a fixed sequence', () => {
  const events = [
    { outcome: 'parry', timestamp: 0.4, comboStep: 1 },
    { outcome: 'light-hit', timestamp: 1.2, comboStep: 1, kind: 'light' },
    { outcome: 'heavy-hit', timestamp: 2.0, comboStep: 2, kind: 'heavy' },
    { outcome: 'dodge', timestamp: 2.8 },
    { outcome: 'light-hit', timestamp: 3.6, comboStep: 3, kind: 'light' },
  ];
  const a = simulatePlayerCombatMomentumSequence(events);
  const b = simulatePlayerCombatMomentumSequence(events);
  assert.deepEqual(a.snapshot, b.snapshot);
  assert.deepEqual(a.history, b.history);
  assert.equal(a.deterministicDigest, b.deterministicDigest);
});

run('simulation changes when event order changes', () => {
  const a = simulatePlayerCombatMomentumSequence([
    { outcome: 'parry', timestamp: 0.4 },
    { outcome: 'heavy-hit', timestamp: 1.2, comboStep: 3 },
  ]);
  const b = simulatePlayerCombatMomentumSequence([
    { outcome: 'heavy-hit', timestamp: 0.4, comboStep: 3 },
    { outcome: 'parry', timestamp: 1.2 },
  ]);
  assert.notEqual(a.deterministicDigest, b.deterministicDigest);
});

run('failure streak controls faster decay than idle decay', () => {
  const failureTarget = new TestTarget();
  const idleTarget = new TestTarget();
  const failure = createPlayerCombatMomentumDirector({ target: failureTarget, emit: false });
  const idle = createPlayerCombatMomentumDirector({ target: idleTarget, emit: false });
  failure.applyOutcome('heavy-hit', {}, 1);
  idle.applyOutcome('heavy-hit', {}, 1);
  failure.applyOutcome('hit-stagger', {}, 1.5);
  idle.applyOutcome('heavy-hit', {}, 1.5);
  const beforeFailure = failure.read().score;
  const beforeIdle = idle.read().score;
  failure.update(0.1, 1.6);
  idle.update(0.1, 1.6);
  assert.ok(beforeFailure - failure.read().score > beforeIdle - idle.read().score);
  failure.dispose();
  idle.dispose();
});

run('finisher arm emits explicit readiness reason', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: true });
  for (let index = 0; index < 30 && !director.read().finisherReady; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 1);
  }
  if (!director.read().finisherReady) throw new Error('finisher did not arm during setup');
  const event = target.last(PLAYER_COMBAT_MOMENTUM_EVENT);
  assert.equal(event?.detail.reason, 'finisher-armed');
  assert.equal(event?.detail.finisherReady, true);
  director.dispose();
});

run('finisher expires after its explicit bounded window', () => {
  const target = new TestTarget();
  const director = createPlayerCombatMomentumDirector({ target, emit: false });
  for (let index = 0; index < 30 && !director.read().finisherReady; index += 1) {
    director.applyOutcome(index === 0 ? 'parry' : 'heavy-hit', { comboStep: 3 }, index + 1);
  }
  assert.equal(director.read().finisherReady, true);
  director.update(C.FINISHER_ARM_SECONDS, 40);
  const snapshot = director.read();
  assert.equal(snapshot.finisherReady, false);
  assert.equal(snapshot.finisherWindowRemaining, 0);
  director.dispose();
});

run('success streak is bounded', () => {
  const director = createPlayerCombatMomentumDirector({ target: new TestTarget(), emit: false });
  for (let index = 0; index < 100; index += 1) {
    director.applyOutcome('light-hit', { comboStep: 1 }, index + 1);
  }
  assert.equal(director.read().successStreak, C.MAX_STREAK);
  assert.equal(director.read().bestSuccessStreak, C.MAX_STREAK);
  director.dispose();
});

run('read returns a defensive immutable snapshot', () => {
  const director = createPlayerCombatMomentumDirector({ target: new TestTarget(), emit: false });
  const snapshot = director.read();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.attack));
  assert.ok(Object.isFrozen(snapshot.equipmentScale));
  director.dispose();
});

run('consumer exceptions do not break combat state', () => {
  let changes = 0;
  const director = createPlayerCombatMomentumDirector({
    target: new TestTarget(),
    emit: false,
    onChange() {
      changes += 1;
      throw new Error('consumer failure');
    },
  });
  director.applyOutcome('parry', {}, 1);
  assert.ok(changes >= 2);
  assert.equal(director.read().totalDefenses, 1);
  director.dispose();
});

run('provider exceptions fail closed to baseline equipment', () => {
  const director = createPlayerCombatMomentumDirector({
    target: new TestTarget(),
    equipmentProvider() {
      throw new Error('provider failure');
    },
    emit: false,
  });
  director.applyOutcome('heavy-hit', {}, 1);
  assert.equal(director.read().equipmentScale.damageScale, 1);
  assert.equal(director.read().equipmentScale.movementMultiplier, 1);
  director.dispose();
});

console.log('PLAYER_COMBAT_MOMENTUM_DIRECTOR_PASS');
