#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHealthState, readDamageResolution } from '../src/3d/gameplay/health.js';

class TestBus {
  constructor() { this.listeners = new Map(); this.emitted = []; }
  on(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); return () => this.off(name, fn); }
  off(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry !== fn)); }
  emit(name, payload) { this.emitted.push({ name, payload }); for (const fn of this.listeners.get(name) ?? []) fn(payload); }
}

for (const invalidMaxHealth of [0, -1, Infinity, -Infinity, NaN]) {
  const invalidBus = new TestBus();
  assert.throws(
    () => createHealthState({ eventsBus: invalidBus, maxHealth: invalidMaxHealth, damageEventName: 'damage', healthChangedEventName: 'health', diedEventName: 'died' }),
    { name: 'RangeError', message: 'createHealthState maxHealth must be a finite positive number' },
    `invalid maxHealth=${String(invalidMaxHealth)} must fail before listener registration or initial paint`,
  );
  assert.equal(invalidBus.listeners.size, 0, 'invalid health construction must not leak an event listener');
  assert.equal(invalidBus.emitted.length, 0, 'invalid health construction must not emit a synthetic initial receipt');
}

const bus = new TestBus();
const health = createHealthState({ eventsBus: bus, maxHealth: 100, damageEventName: 'damage', healthChangedEventName: 'health', diedEventName: 'died' });
const healthEvents = () => bus.emitted.filter((entry) => entry.name === 'health').map((entry) => entry.payload);
function assertHealthReceipt(receipt, expected) {
  assert.deepEqual(receipt, { current: expected.current, maxHealth: expected.maxHealth }, 'legacy enumerable health payload shape must remain stable');
  for (const key of ['ratio', 'delta', 'reason', 'appliedAmount', 'sourceId']) assert.equal(receipt[key], expected[key], `receipt.${key}`);
  assert.equal(Object.isFrozen(receipt), true, 'health receipts must be immutable');
}

assertHealthReceipt(healthEvents().at(-1), { current: 100, maxHealth: 100, ratio: 1, delta: 0, reason: 'sync', appliedAmount: 0, sourceId: null });

const invalidEventCount = healthEvents().length;
for (const invalidAmount of [Infinity, -Infinity, NaN]) bus.emit('damage', { amount: invalidAmount, sourceId: 'invalid-damage' });
assert.equal(health.current, 100, 'non-finite damage must not mutate authoritative health');
assert.equal(health.isDead, false, 'non-finite damage must not enter the death state');
assert.equal(healthEvents().length, invalidEventCount, 'non-finite damage must not emit a synthetic health receipt');
health.heal(Infinity);
health.heal(NaN);
assert.equal(health.current, 100, 'non-finite healing must not mutate authoritative health');
assert.equal(healthEvents().length, invalidEventCount, 'non-finite healing must not emit a synthetic health receipt');

const normalHit = { amount: 40, sourceId: 'guard-01' };
bus.emit('damage', normalHit);
assert.equal(health.current, 60);
assert.equal(normalHit.appliedAmount, 40, 'damage payload must expose the authoritative clamped amount to later same-event consumers');
assertHealthReceipt(healthEvents().at(-1), { current: 60, maxHealth: 100, ratio: 0.6, delta: -40, reason: 'damage', appliedAmount: 40, sourceId: 'guard-01' });

const overkill = { amount: 200, sourceId: 'dragon-01' };
bus.emit('damage', overkill);
assert.equal(health.current, 0);
assert.equal(overkill.appliedAmount, 60, 'overkill receipt must report only health actually removed');
const death = bus.emitted.filter((entry) => entry.name === 'died').at(-1)?.payload;
assert.deepEqual(death, { sourceId: 'dragon-01' }, 'legacy enumerable death payload shape must remain stable');
assert.equal(death.current, 0); assert.equal(death.maxHealth, 100); assert.equal(death.appliedAmount, 60);
assert.equal(Object.isFrozen(death), true, 'death receipt must be immutable');

const postDeath = { amount: 10, sourceId: 'after-death' };
bus.emit('damage', postDeath);
assert.equal(postDeath.appliedAmount, 0, 'damage against an already-dead state must reconcile to zero applied damage');

health.heal(25);
assertHealthReceipt(healthEvents().at(-1), { current: 25, maxHealth: 100, ratio: 0.25, delta: 25, reason: 'heal', appliedAmount: 0, sourceId: null });
health.reset();
assertHealthReceipt(healthEvents().at(-1), { current: 100, maxHealth: 100, ratio: 1, delta: 75, reason: 'reset', appliedAmount: 0, sourceId: null });

const frozenHit = Object.freeze({ amount: 15, sourceId: 'frozen-guard' });
assert.doesNotThrow(() => bus.emit('damage', frozenHit), 'immutable damage payloads must not crash the authoritative health listener');
assert.equal(health.current, 85, 'immutable damage payloads must still apply finite authoritative damage');
assert.equal('appliedAmount' in frozenHit, false, 'immutable producer payload must remain untouched when reconciliation cannot be written back');
assertHealthReceipt(healthEvents().at(-1), { current: 85, maxHealth: 100, ratio: 0.85, delta: -15, reason: 'damage', appliedAmount: 15, sourceId: 'frozen-guard' });
await Promise.resolve();
assert.equal(readDamageResolution(frozenHit), null, 'immutable same-event resolution must be cleared after the event turn');

health.reset();
assertHealthReceipt(healthEvents().at(-1), { current: 100, maxHealth: 100, ratio: 1, delta: 15, reason: 'reset', appliedAmount: 0, sourceId: null });

const frozenOverkill = Object.freeze({ amount: 160, sourceId: 'frozen-overkill-direct' });
let frozenOverkillResolution = null;
const offFrozenObserver = bus.on('damage', (payload) => {
  if (payload === frozenOverkill) frozenOverkillResolution = readDamageResolution(payload);
});
bus.emit('damage', frozenOverkill);
offFrozenObserver();
assert.equal(health.current, 0, 'frozen direct overkill must still clamp authoritative health to zero');
assert.equal('appliedAmount' in frozenOverkill, false, 'frozen direct overkill producer payload must remain immutable');
assert.equal(frozenOverkillResolution?.appliedAmount, 100, 'later same-event consumers must see the exact clamped damage removed from immutable direct payloads');
assert.equal(Object.isFrozen(frozenOverkillResolution), true, 'same-event immutable damage resolution must be immutable');
await Promise.resolve();
assert.equal(readDamageResolution(frozenOverkill), null, 'direct immutable resolution must not survive beyond the originating event turn');

health.reset();
assertHealthReceipt(healthEvents().at(-1), { current: 100, maxHealth: 100, ratio: 1, delta: 100, reason: 'reset', appliedAmount: 0, sourceId: null });
health.dispose();
const before = health.current;
bus.emit('damage', { amount: 10, sourceId: 'after-dispose' });
assert.equal(health.current, before, 'dispose must detach the damage listener');

console.log('Player Combat Health Receipt: PASS');
console.log('legacy-enumerable=current,maxHealth|receipt=ratio,delta,reason,appliedAmount,sourceId');
console.log('constructor-guard=maxHealth>0+finite|finite-guard=damage+heal|invalid=Infinity,-Infinity,NaN');
console.log('damagePayloadAppliedAmount=normal,overkill,already-dead|immutable-payload=safe+same-event-clamped');