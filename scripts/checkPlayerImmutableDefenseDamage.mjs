#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  createHealthState,
  readDamageResolution,
  stageDamageResolution,
} from '../src/3d/gameplay/health.js';

class TestBus {
  constructor() { this.listeners = new Map(); }
  on(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); }
  off(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry !== fn)); }
  emit(name, payload) { for (const fn of this.listeners.get(name) ?? []) fn(payload); }
}

const bus = new TestBus();
const health = createHealthState({
  eventsBus: bus,
  maxHealth: 100,
  damageEventName: 'damage',
  healthChangedEventName: 'health',
  diedEventName: 'died',
});

const frozenGuard = Object.freeze({ amount: 50, sourceId: 'frozen-guard' });
stageDamageResolution(frozenGuard, { rawAmount: 50, blockedAmount: 30, amount: 20, mitigation: 'guard' });
assert.doesNotThrow(() => bus.emit('damage', frozenGuard), 'frozen guarded damage must not throw');
assert.equal(health.current, 80, 'health must consume staged guarded amount instead of immutable raw amount');
assert.equal(readDamageResolution(frozenGuard)?.appliedAmount, 20, 'same-event resolution must expose authoritative applied damage');
assert.deepEqual(frozenGuard, { amount: 50, sourceId: 'frozen-guard' }, 'frozen producer payload must remain untouched');
await Promise.resolve();
assert.equal(readDamageResolution(frozenGuard), null, 'same-event resolution must be cleared after feedback microtasks');

const frozenDodge = Object.freeze({ amount: 40, sourceId: 'frozen-dodge' });
stageDamageResolution(frozenDodge, { rawAmount: 40, blockedAmount: 40, amount: 0, mitigation: 'dodge' });
assert.doesNotThrow(() => bus.emit('damage', frozenDodge), 'frozen dodge mitigation must not throw');
assert.equal(health.current, 80, 'zero-damage dodge resolution must prevent health mutation');
await Promise.resolve();
assert.equal(readDamageResolution(frozenDodge), null, 'zero-damage resolution must also be cleared');

const frozenOverkill = Object.freeze({ amount: 500, sourceId: 'frozen-overkill' });
stageDamageResolution(frozenOverkill, { amount: 500 });
bus.emit('damage', frozenOverkill);
assert.equal(health.current, 0, 'frozen unguarded overkill must still clamp health');
assert.equal(readDamageResolution(frozenOverkill)?.appliedAmount, 80, 'frozen overkill feedback must see clamped applied amount, not raw damage');
await Promise.resolve();
assert.equal(readDamageResolution(frozenOverkill), null, 'overkill resolution must be cleared after same-event consumers');
health.dispose();

const playerSource = fs.readFileSync(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
assert.match(playerSource, /from '\.\/health\.js'/, 'player must consume the existing health authority rather than add a second runtime module');
assert.match(playerSource, /stageDamageResolution\(payload, \{ amount: rawAmount \}\)/, 'every valid incoming hit must establish a same-event resolution');
for (const mitigation of ['dodge', 'parry', 'guard']) {
  assert.match(playerSource, new RegExp(`stageDamageResolution\\(payload, \\{[^}]*mitigation: '${mitigation}'`), `${mitigation} must use immutable-safe damage resolution`);
}
for (const directWrite of ['payload.rawAmount =', 'payload.blockedAmount =', 'payload.amount =', 'payload.mitigation =']) {
  assert.equal(playerSource.includes(directWrite), false, `player defense must not directly mutate producer payload: ${directWrite}`);
}
assert.match(playerSource, /readDamageResolution\(payload\)[\s\S]*staged\?\.appliedAmount/, 'feedback must prefer authoritative staged applied damage');

console.log('Player Immutable Defense Damage: PASS');
console.log('frozen=guard,dodge,overkill|health=authoritative-clamp|payload=unchanged|resolution=bounded|authority=health');
