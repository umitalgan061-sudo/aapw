import assert from 'node:assert/strict';
import { normalizeCombatFeedback, validatePlayerCombatFeedbackDirector, createPlayerCombatFeedbackDirector } from '../src/3d/gameplay/playerCombatFeedbackDirector.js';

const hit = normalizeCombatFeedback({ serial: 4, outcome: 'hit', appliedAmount: 12.5, blockedAmount: 2, stamina: 55, poise: 88, position: { x: 1, y: 2, z: 3 } });
assert.equal(hit.style, 'impact');
assert.equal(hit.cue.vfx, true);
assert.equal(hit.cue.sfx, true);
assert.equal(hit.eventType, 'feedback');
assert.equal(Object.isFrozen(hit), true);

const malformed = normalizeCombatFeedback({ outcome: 'blocked', appliedAmount: NaN, blockedAmount: Infinity, stamina: -10, poise: 140, position: { x: Infinity } });
assert.equal(malformed.appliedAmount, 0);
assert.equal(malformed.blockedAmount, 0);
assert.equal(malformed.stamina, 0);
assert.equal(malformed.poise, 100);

const target = new EventTarget();
const director = createPlayerCombatFeedbackDirector({ target, maxEvents: 3 });
target.dispatchEvent(new CustomEvent('aapw:player-combat-feedback', { detail: { serial: 1, outcome: 'hit', appliedAmount: 8 } }));
target.dispatchEvent(new CustomEvent('aapw:player-combat-feedback', { detail: { serial: 1, outcome: 'hit', appliedAmount: 8 } }));
target.dispatchEvent(new CustomEvent('aapw:player-attack-window', { detail: { serial: 1, phase: 'active-start', kind: 'light', comboStep: 1, reachMeters: 1.65, damageScale: 1 } }));
target.dispatchEvent(new CustomEvent('aapw:player-attack-window', { detail: { serial: 1, phase: 'active-start', kind: 'light', comboStep: 1, reachMeters: 1.65, damageScale: 1 } }));
target.dispatchEvent(new CustomEvent('aapw:player-combat-feedback', { detail: { serial: 2, outcome: 'parried', blockedAmount: 5 } }));
const snapshot = director.read();
assert.equal(snapshot.length, 3);
assert.equal(snapshot.filter((entry) => entry.eventType === 'feedback').length, 2);
assert.equal(snapshot.filter((entry) => entry.eventType === 'attack-window').length, 1);
assert.equal(validatePlayerCombatFeedbackDirector(snapshot), true);
assert.equal(snapshot[2].style, 'parry');
assert.equal(Object.isFrozen(snapshot), true);
director.dispose();
assert.equal(director.read().length, 0);
console.log('player combat feedback director: ok');
