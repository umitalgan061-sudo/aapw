#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHealthState } from '../src/3d/gameplay/health.js';

class TestBus {
  constructor() { this.listeners = new Map(); this.emitted = []; }
  on(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); return () => this.off(name, fn); }
  off(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry !== fn)); }
  emit(name, payload) { this.emitted.push({ name, payload }); for (const fn of this.listeners.get(name) ?? []) fn(payload); }
}

const bus = new TestBus();
const health = createHealthState({
  eventsBus: bus,
  maxHealth: 100,
  damageEventName: 'damage',
  healthChangedEventName: 'health',
  diedEventName: 'died',
});

const healthEvents = () => bus.emitted.filter((entry) => entry.name === 'health').map((entry) => entry.payload);
assert.deepEqual(healthEvents().at(-1), {
  current: 100, maxHealth: 100, ratio: 1, delta: 0, reason: 'sync', appliedAmount: 0, sourceId: null,
});
assert.equal(Object.isFrozen(healthEvents().at(-1)), true, 'health receipts must be immutable');

const normalHit = { amount: 40, sourceId: 'guard-01' };
bus.emit('damage', normalHit);
assert.equal(health.current, 60);
assert.equal(normalHit.appliedAmount, 40, 'damage payload must expose the authoritative clamped amount to later same-event consumers');
assert.deepEqual(healthEvents().at(-1), {
  current: 60, maxHealth: 100, ratio: 0.6, delta: -40, reason: 'damage', appliedAmount: 40, sourceId: 'guard-01',
});

const overkill = { amount: 200, sourceId: 'dragon-01' };
bus.emit('damage', overkill);
assert.equal(health.current, 0);
assert.equal(overkill.appliedAmount, 60, 'overkill receipt must report only health actually removed');
const death = bus.emitted.filter((entry) => entry.name === 'died').at(-1)?.payload;
assert.deepEqual(death, { sourceId: 'dragon-01', current: 0, maxHealth: 100, appliedAmount: 60 });
assert.equal(Object.isFrozen(death), true, 'death receipt must be immutable');

const postDeath = { amount: 10, sourceId: 'after-death' };
bus.emit('damage', postDeath);
assert.equal(postDeath.appliedAmount, 0, 'damage against an already-dead state must reconcile to zero applied damage');

health.heal(25);
assert.equal(health.current, 25);
assert.deepEqual(healthEvents().at(-1), {
  current: 25, maxHealth: 100, ratio: 0.25, delta: 25, reason: 'heal', appliedAmount: 0, sourceId: null,
});
health.reset();
assert.deepEqual(healthEvents().at(-1), {
  current: 100, maxHealth: 100, ratio: 1, delta: 75, reason: 'reset', appliedAmount: 0, sourceId: null,
});

health.dispose();
const before = health.current;
bus.emit('damage', { amount: 10, sourceId: 'after-dispose' });
assert.equal(health.current, before, 'dispose must detach the damage listener');

console.log('Player Combat Health Receipt: PASS');
console.log('receipt=current,maxHealth,ratio,delta,reason,appliedAmount,sourceId');
console.log('damagePayloadAppliedAmount=normal,overkill,already-dead');
