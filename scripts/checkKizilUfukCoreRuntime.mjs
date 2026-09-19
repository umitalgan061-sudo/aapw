#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EVENTS } from '../src/3d/config.ts';
import { EventBus, gameEvents } from '../src/3d/eventBus.ts';

const bus = new EventBus();
const phases = [];
const subscription = bus.once(EVENTS.GAME_READY, payload => phases.push(payload.phase));

bus.emit(EVENTS.GAME_READY, { phase: 'proof' });
bus.emit(EVENTS.GAME_READY, { phase: 'duplicate' });

assert.deepEqual(phases, ['proof']);
assert.equal(bus.listenerCount(EVENTS.GAME_READY), 0);
assert.equal(Object.isFrozen(subscription), true);

const failure = new EventBus();
const errors = [];
failure.on(EVENTS.GAME_READY, () => { throw new Error('expected'); });
failure.on(EVENTS.GAME_READY, payload => phases.push(payload.phase));
const originalError = console.error;
console.error = (...args) => errors.push(args[0]);
failure.emit(EVENTS.GAME_READY, { phase: 'resilient' });
console.error = originalError;
assert.deepEqual(phases, ['proof', 'resilient']);
assert.equal(errors.length, 1);

failure.dispose();
assert.equal(failure.isDisposed, true);
assert.equal(failure.listenerCount(), 0);
assert.throws(() => failure.on(EVENTS.GAME_READY, () => {}), /disposed/);

const [typedSource, legacySource] = await Promise.all([
  readFile(new URL('../src/3d/eventBus.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/3d/eventBus.js', import.meta.url), 'utf8'),
]);
assert.equal(typedSource.includes('Math.random('), false);
assert.equal(typedSource.includes('EditorMaterialStudio.js'), false);
assert.match(legacySource, /from '\.\/eventBus\.ts';/);
assert.equal(gameEvents.isDisposed, false);

const checksum = createHash('sha256').update(typedSource).digest('hex');
console.log(JSON.stringify({
  ok: true,
  eventCount: Object.values(EVENTS).length,
  singletonDisposed: gameEvents.isDisposed,
  sourceChecksum: checksum,
}));
