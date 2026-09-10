import assert from 'node:assert/strict';
import { createPlayerCombatObserver, attachPlayerCombatObserver } from '../src/3d/gameplay/playerCombatObserver.js';

const observer = createPlayerCombatObserver({ limit: 2 });
const first = observer.ingestAttackWindow({ kind: 'heavy', phase: 'start', active: false, comboStep: 1, stamina: 82 });
assert.equal(first.kind, 'heavy');
assert.equal(first.channel, 'attack-window');
const second = observer.ingestCombatFeedback({ outcome: 'parry', stamina: 76, poise: 88, appliedAmount: 0, blockedAmount: 12 });
assert.equal(second.outcome, 'parry');
observer.ingestAttackWindow({ kind: 'light', phase: 'active-start', active: true, comboStep: 2, stamina: 64 });
const snapshot = observer.snapshot();
assert.equal(snapshot.eventCount, 2);
assert.equal(snapshot.attackWindow.kind, 'light');
assert.equal(snapshot.combatFeedback.outcome, 'parry');
assert.equal(snapshot.history[0].channel, 'combat-feedback');
assert.equal(snapshot.history[1].phase, 'active-start');
assert.throws(() => { snapshot.history.push({}); }, TypeError);
assert.equal(JSON.stringify(observer.snapshot()), JSON.stringify(observer.snapshot()));

const listeners = new Map();
const target = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  removeEventListener(name) { listeners.delete(name); },
};
const attached = createPlayerCombatObserver();
const detach = attachPlayerCombatObserver({ target, observer: attached, now: () => 1234 });
listeners.get('aapw:player-attack-window')({ detail: { kind: 'light', phase: 'start', stamina: 99 } });
listeners.get('aapw:player-combat-feedback')({ detail: { outcome: 'hit', appliedAmount: 7 } });
assert.equal(attached.snapshot().eventCount, 2);
assert.equal(attached.snapshot().history[0].timestampMs, 1234);
detach();
assert.equal(listeners.size, 0);

const malformed = createPlayerCombatObserver();
malformed.ingestCombatFeedback({ outcome: null, stamina: Infinity, appliedAmount: NaN });
const malformedSnapshot = malformed.snapshot();
assert.equal(malformedSnapshot.combatFeedback.outcome, 'unknown');
assert.equal(malformedSnapshot.combatFeedback.stamina, 0);
assert.equal(malformedSnapshot.combatFeedback.appliedAmount, 0);

console.log('[checkPlayerCombatObserver] PASS');
