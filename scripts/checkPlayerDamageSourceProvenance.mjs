#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHealthState, stageDamageResolution, readDamageResolution } from '../src/3d/gameplay/health.js';

class TestBus {
  constructor() { this.listeners = new Map(); this.emitted = []; }
  on(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); }
  off(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry !== fn)); }
  emit(name, payload) { this.emitted.push({ name, payload }); for (const fn of this.listeners.get(name) ?? []) fn(payload); }
}

async function flushResolutionCleanup() {
  await Promise.resolve();
  await Promise.resolve();
}

const bus = new TestBus();
const health = createHealthState({ eventsBus: bus, maxHealth: 50, damageEventName: 'damage', healthChangedEventName: 'health', diedEventName: 'died' });
const latest = (name) => bus.emitted.filter((entry) => entry.name === name).at(-1)?.payload;

const frozenHit = Object.freeze({ amount: 18 });
stageDamageResolution(frozenHit, { amount: 18, sourceId: 'sword-main-hand', rawAmount: 18 });
bus.emit('damage', frozenHit);
assert.equal(health.current, 32, 'staged immutable damage must apply exactly once');
assert.equal(latest('health')?.sourceId, 'sword-main-hand', 'health receipt must preserve staged source provenance');
assert.equal(readDamageResolution(frozenHit)?.sourceId, 'sword-main-hand', 'same-event resolution must keep staged source provenance');
await flushResolutionCleanup();
assert.equal(readDamageResolution(frozenHit), null, 'staged source provenance must still obey bounded cleanup');

const lethalFrozenHit = Object.freeze({ amount: 80 });
stageDamageResolution(lethalFrozenHit, { amount: 80, sourceId: 'dragon-fire', rawAmount: 80 });
bus.emit('damage', lethalFrozenHit);
assert.equal(health.current, 0, 'lethal staged immutable damage must clamp health to zero');
assert.equal(latest('health')?.sourceId, 'dragon-fire', 'lethal health receipt must preserve staged source provenance');
assert.equal(latest('died')?.sourceId, 'dragon-fire', 'death receipt must preserve the same staged source provenance');
assert.equal(latest('died')?.appliedAmount, 32, 'death receipt must preserve clamped applied damage');
await flushResolutionCleanup();
assert.equal(readDamageResolution(lethalFrozenHit), null, 'lethal staged resolution must clear after same-event consumers');

health.dispose();
console.log(JSON.stringify({ ok: true, contract: 'player-damage-source-provenance', immutable: true, deathParity: true }, null, 2));
