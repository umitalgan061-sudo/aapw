import assert from 'node:assert/strict';
import {
  PLAYER_COMBAT_MOMENTUM_CONFIG as C,
  PLAYER_COMBAT_MOMENTUM_EVENT,
  calculatePlayerCombatRhythmQuality,
  createPlayerCombatMomentumDirector,
} from '../src/3d/gameplay/playerCombatMomentumDirector.js';

class Target {
  #listeners = new Map();
  addEventListener(type, handler) {
    const set = this.#listeners.get(type) || new Set();
    set.add(handler);
    this.#listeners.set(type, set);
  }
  removeEventListener(type, handler) { this.#listeners.get(type)?.delete(handler); }
  dispatchEvent(event) { for (const handler of this.#listeners.get(event.type) || []) handler(event); }
}

const target = new Target();
const director = createPlayerCombatMomentumDirector({ target, emit: true });
const detach = director.attach();
assert.equal(calculatePlayerCombatRhythmQuality(0.9), 1);
assert.equal(calculatePlayerCombatRhythmQuality(Number.NaN), 0);
assert.equal(calculatePlayerCombatRhythmQuality(8), 0);

target.dispatchEvent({ type: 'aapw:player-motion', detail: { state: 'run', grounded: true, speedMps: 4, staminaRatio: 0.7 } });
assert.equal(director.read().motionState, 'run');
assert.equal(director.read().grounded, true);
assert.equal(director.read().speedMps, 4);
assert.equal(director.read().staminaRatio, 0.7);

target.dispatchEvent({ type: 'aapw:player-equipment-combat-frame', detail: { attack: { damageScale: 1.4 }, movement: { movementMultiplier: 0.9 } } });
assert.equal(director.read().equipment.damageScale, 1.4);
assert.equal(director.read().equipment.movementMultiplier, 0.9);

target.dispatchEvent({ type: 'aapw:player-combat-feedback', detail: { outcome: 'parry', comboStep: 3, timestamp: 1 } });
target.dispatchEvent({ type: 'aapw:player-combat-feedback', detail: { outcome: 'heavy-hit', comboStep: 3, timestamp: 1.9 } });
target.dispatchEvent({ type: 'aapw:player-combat-feedback', detail: { outcome: 'light-hit', comboStep: 2, timestamp: 2.8 } });
const armed = director.read();
assert.ok(armed.score > 0);
assert.ok(armed.successStreak >= 3);
assert.equal(armed.failureStreak, 0);
assert.ok(armed.rank !== 'neutral');
assert.ok(armed.totalSuccesses >= 3);

for (let step = 0; step < 8; step += 1) director.update(0.1, 3 + step * 0.1);
const afterTick = director.read();
assert.ok(afterTick.score >= 0 && afterTick.score <= C.maxScore);
assert.ok(afterTick.finisherWindowRemaining >= 0);

const failure = createPlayerCombatMomentumDirector({ target: new Target(), emit: false });
const neutral = createPlayerCombatMomentumDirector({ target: new Target(), emit: false });
failure.applyOutcome('heavy-hit', {}, 1);
neutral.applyOutcome('heavy-hit', {}, 1);
failure.applyOutcome('hit-stagger', {}, 1.5);
const failureBefore = failure.read().score;
const neutralBefore = neutral.read().score;
failure.update(0.1, 1.6);
neutral.update(0.1, 1.6);
assert.ok(failureBefore - failure.read().score > neutralBefore - neutral.read().score);

const events = director.history();
assert.ok(events.length > 0);
assert.ok(events.every((entry) => entry.state.score >= 0 && entry.state.score <= C.maxScore));
assert.ok(events.every((entry) => entry.version === '2026-09-14-v2'));
detach();
assert.equal(PLAYER_COMBAT_MOMENTUM_EVENT, 'aapw:player-combat-momentum');
console.log('PLAYER_COMBAT_MOMENTUM_DIRECTOR_PASS');
