import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYER_COMBAT_MOMENTUM_EVENT,
  PLAYER_COMBAT_MOMENTUM_VERSION,
  PLAYER_COMBAT_MOMENTUM_CONFIG,
  createPlayerCombatMomentumDirector,
  calculatePlayerCombatRhythmQuality,
  calculatePlayerCombatMomentumDelta,
} from '../src/3d/gameplay/playerCombatMomentumDirector.js';

const modulePath = path.resolve('src/3d/gameplay/playerCombatMomentumDirector.js');
const source = fs.readFileSync(modulePath, 'utf8');

function assertContains(fragment) {
  assert.ok(source.includes(fragment), `expected source fragment: ${fragment}`);
}

function assertNotContains(fragment) {
  assert.equal(source.includes(fragment), false, `forbidden source fragment: ${fragment}`);
}

assertContains("aapw:player-motion");
assertContains("aapw:player-attack-window");
assertContains("aapw:player-combat-feedback");
assertContains("aapw:player-equipment-combat-frame");
assertContains('PLAYER_COMBAT_MOMENTUM_EVENT');
assertContains('FINISHER_SCORE');
assertContains('FINISHER_MIN_SUCCESS_STREAK');
assertContains('FINISHER_MIN_DEFENSE_STREAK');
assertContains('HISTORY_LIMIT');
assertNotContains("EditorMaterialStudio.js");
assertNotContains("document.createElement");
assertNotContains("new THREE.");
assertNotContains("OrbitControls");
assertNotContains("loadFBXModel");

assert.equal(PLAYER_COMBAT_MOMENTUM_VERSION, '2026-09-14-v1');
assert.ok(PLAYER_COMBAT_MOMENTUM_CONFIG.MAX_SCORE > 0);
assert.ok(PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_SCORE > PLAYER_COMBAT_MOMENTUM_CONFIG.SURGING_SCORE);
assert.ok(PLAYER_COMBAT_MOMENTUM_CONFIG.SURGING_SCORE > PLAYER_COMBAT_MOMENTUM_CONFIG.FOCUSED_SCORE);
assert.equal(PLAYER_COMBAT_MOMENTUM_EVENT, 'aapw:player-combat-momentum');

class Target {
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
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter(candidate => candidate !== handler));
  }
  dispatchEvent(event) {
    this.events.push(event);
    for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
    return true;
  }
  emit(type, detail) {
    this.dispatchEvent(new this.CustomEvent(type, { detail }));
  }
}

const target = new Target();
let clock = 0;
const emitted = [];
const director = createPlayerCombatMomentumDirector({
  target,
  now: () => clock,
  onChange: detail => emitted.push(detail),
});

assert.equal(director.read().version, PLAYER_COMBAT_MOMENTUM_VERSION);
assert.equal(director.read().rank, 'neutral');
assert.equal(director.read().scoreRatio, 0);
assert.equal(director.read().finisherReady, false);

const initialEvents = target.events.length;
target.emit('aapw:player-motion', {
  timestamp: 0,
  state: 'walk',
  speedMps: 3.1,
  isGrounded: true,
  staminaRatio: 0.9,
  poiseRatio: 0.8,
});
assert.equal(director.read().motionState, 'walk');
assert.equal(director.read().speedMps, 3.1);
assert.equal(director.read().staminaRatio, 0.9);
assert.equal(director.read().poiseRatio, 0.8);
assert.ok(target.events.length >= initialEvents);

const baseline = director.read();
target.emit('aapw:player-equipment-combat-frame', {
  attack: { kind: 'heavy', damageScale: 1.65 },
  movement: { movementMultiplier: 0.75 },
});
assert.equal(director.read().equipmentScale.damageScale, 1.65);
assert.equal(director.read().equipmentScale.movementMultiplier, 0.75);
assert.equal(director.read().totalActions, baseline.totalActions);

target.emit('aapw:player-combat-feedback', {
  serial: 1,
  outcome: 'parry',
  rawAmount: 20,
  blockedAmount: 20,
  appliedAmount: 0,
  timestamp: 0.4,
  source: 'gameplay',
});
assert.equal(director.read().lastOutcome, 'parry');
assert.equal(director.read().totalDefenses, 1);
assert.equal(director.read().successStreak, 1);

for (let index = 1; index < 16 && !director.read().finisherReady; index += 1) {
  clock = index + 0.25;
  target.emit('aapw:player-combat-feedback', {
    serial: index + 1,
    outcome: index % 2 ? 'heavy-hit' : 'light-hit',
    kind: index % 2 ? 'heavy' : 'light',
    comboStep: 3,
    timestamp: clock,
    source: 'gameplay',
  });
}
assert.equal(director.read().finisherReady, true, 'setup should arm finisher');
assert.equal(director.read().rank, 'finisher-ready');
assert.ok(emitted.some(value => value.reason === 'finisher-armed'));

const consumed = director.consumeFinisher(clock + 0.1);
assert.equal(consumed, true);
assert.equal(director.read().finisherReady, false);
assert.equal(director.read().finisherCooldownRemaining, PLAYER_COMBAT_MOMENTUM_CONFIG.FINISHER_LOCKOUT_SECONDS);
assert.ok(emitted.some(value => value.reason === 'finisher-consumed'));

const beforeDispose = director.read().totalActions;
director.dispose();
target.emit('aapw:player-combat-feedback', { outcome: 'heavy-hit', timestamp: 99 });
assert.equal(director.read().totalActions, beforeDispose);

for (const value of [0, 0.12, 0.3, 0.9, 1.5, 2.5, 3.25, 4, -1, Infinity, NaN]) {
  const rhythm = calculatePlayerCombatRhythmQuality(value);
  assert.ok(Number.isFinite(rhythm));
  assert.ok(rhythm >= 0 && rhythm <= 1);
}

const parityCases = [
  { outcome: 'light-hit', expectedSign: 1 },
  { outcome: 'heavy-hit', expectedSign: 1 },
  { outcome: 'guard', expectedSign: 1 },
  { outcome: 'parry', expectedSign: 1 },
  { outcome: 'dodge', expectedSign: 1 },
  { outcome: 'hit', expectedSign: -1 },
  { outcome: 'guard-break', expectedSign: -1 },
  { outcome: 'hit-stagger', expectedSign: -1 },
];
for (const test of parityCases) {
  const result = calculatePlayerCombatMomentumDelta({ outcome: test.outcome, timestamp: 1, previousTimestamp: 0 });
  assert.equal(Math.sign(result.delta), test.expectedSign);
}

console.log(`PLAYER_COMBAT_MOMENTUM_CONTRACT_PASS ${PLAYER_COMBAT_MOMENTUM_VERSION}`);
