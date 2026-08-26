#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorldEventSystem } from '../src/3d/gameplay/worldEvents.js';

function collect(seed, nightFactor) {
  const emitted = [];
  const system = createWorldEventSystem({
    eventsBus: { emit: (_name, payload) => emitted.push(payload) },
    seed,
    eventName: 'world:event',
  });
  for (let second = 0; second < 20000 && emitted.length < 160; second += 1) {
    system.update(1, nightFactor);
  }
  system.dispose();
  return emitted;
}

for (const nightFactor of [undefined, 0, 1, 0.5]) {
  const first = collect(1482026, nightFactor);
  const second = collect(1482026, nightFactor);
  assert.equal(first.length, 160, `expected 160 events for nightFactor=${nightFactor}`);
  assert.deepEqual(first.map((event) => event.id), second.map((event) => event.id), 'same seed must remain deterministic');
  for (let index = 1; index < first.length; index += 1) {
    assert.notEqual(first[index].id, first[index - 1].id, `immediate repeat at index ${index}: ${first[index].id}`);
  }
  for (const event of first) {
    if (nightFactor === 0) assert.notEqual(event.timeOfDay, 'night', `night event emitted at day: ${event.id}`);
    if (nightFactor === 1) assert.notEqual(event.timeOfDay, 'day', `day event emitted at night: ${event.id}`);
  }
}

const baseline = collect(1482026, undefined).map((event) => event.id);
const different = collect(1482027, undefined).map((event) => event.id);
assert.notDeepEqual(baseline, different, 'different seeds must not collapse to the same sequence');

console.log('WORLD_EVENT_REPEAT_DIVERSITY_PASS', JSON.stringify({ eventsChecked: 640, seed: 1482026 }));
