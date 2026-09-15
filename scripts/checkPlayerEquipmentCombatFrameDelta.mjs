import assert from 'node:assert/strict';
import { createPlayerEquipmentCombatFrameDelta } from '../src/3d/gameplay/playerEquipmentCombatFrameDelta.js';

const listeners = new Map();
const target = {
  addEventListener(type, fn) { listeners.set(type, fn); },
  removeEventListener(type) { listeners.delete(type); },
};
const seen = [];
const delta = createPlayerEquipmentCombatFrameDelta({ target, onDelta: (value) => seen.push(value) });
assert.deepEqual(delta.publish({ revision: 1, timestamp: 10, phase: 'idle', movement: { state: 'idle' } }).changed, ['phase', 'movement']);
assert.equal(delta.publish({ revision: 2, timestamp: 11, phase: 'idle', movement: { state: 'idle' } }), null);
listeners.get('aapw:player-equipment-combat-frame')({ detail: { revision: 3, timestamp: 12, phase: 'windup', attack: { kind: 'light' }, animation: { action: 'light' } } });
assert.deepEqual(delta.read().changed, ['phase', 'attack', 'movement', 'animation']);
assert.deepEqual(delta.read().patch.attack, { kind: 'light' });
assert.equal(Object.isFrozen(delta.read().patch), true);
assert.equal(delta.readHistory().length, 2);
delta.reset();
assert.equal(delta.readHistory().length, 0);
assert.deepEqual(delta.publish({ revision: 4, phase: 'idle' }).changed, ['phase']);
delta.dispose();
assert.equal(delta.disposed, true);
assert.equal(delta.publish({ revision: 5, phase: 'active' }), null);
assert.equal(delta.readHistory().length, 0);
assert.equal(seen.length, 3);
console.log('player combat frame delta contract: PASS');
