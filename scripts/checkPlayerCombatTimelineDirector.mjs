import assert from 'node:assert/strict';
import { createPlayerCombatTimelineDirector, stableSerializePlayerCombatTimeline } from '../src/3d/gameplay/playerCombatTimelineDirector.js';

const listeners = new Map();
const target = {
  addEventListener(type, fn) { listeners.set(type, fn); },
  removeEventListener(type) { listeners.delete(type); },
};
const director = createPlayerCombatTimelineDirector({ target, historyLimit: 4 });
assert.equal(director.attach(), true);
listeners.get('aapw:player-attack-window')({ detail: { serial: 1, phase: 'start', kind: 'light', comboStep: 1, active: false, stamina: 91, reachMeters: 1.65, damageScale: 1, position: { x: 1, y: 2, z: 3 } } });
listeners.get('aapw:player-combat-feedback')({ detail: { serial: 1, outcome: 'hit', rawAmount: 12, appliedAmount: 10, blockedAmount: 2, stamina: 90, poise: 88, state: 'attack-light' } });
listeners.get('aapw:player-attack-window')({ detail: { serial: 'bad', phase: null, kind: 'heavy', comboStep: 99, active: true, stamina: Infinity, reachMeters: 99, damageScale: -1, position: { x: NaN } } });
const snapshot = director.snapshot();
assert.equal(snapshot.eventCount, 3);
assert.equal(snapshot.attackEventCount, 2);
assert.equal(snapshot.feedbackEventCount, 1);
assert.equal(snapshot.latestAttack.detail.serial, 0);
assert.equal(snapshot.latestAttack.detail.comboStep, 3);
assert.equal(snapshot.latestAttack.detail.reachMeters, 10);
assert.equal(snapshot.latestAttack.detail.position.y, 0);
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(stableSerializePlayerCombatTimeline(snapshot), stableSerializePlayerCombatTimeline(director.snapshot()));
assert.equal(director.detach(), true);
director.reset();
assert.equal(director.snapshot().eventCount, 0);
console.log('PLAYER_COMBAT_TIMELINE_DIRECTOR_OK');
