#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorldEventSystem } from '../src/3d/gameplay/worldEvents.js';

const EVENTS_PER_CONTEXT = 160;
const MIN_UNIQUE_EVENTS = 20;
const MAX_SINGLE_EVENT_SHARE = 0.12;

function collect(seed, nightFactor) {
  const emitted = [];
  const system = createWorldEventSystem({
    eventsBus: { emit: (_name, payload) => emitted.push(payload) },
    seed,
    eventName: 'world:event',
  });
  for (let second = 0; second < 20000 && emitted.length < EVENTS_PER_CONTEXT; second += 1) {
    system.update(1, nightFactor);
  }
  system.dispose();
  return emitted;
}

const contextProof = [];
for (const nightFactor of [undefined, 0, 1, 0.5]) {
  const first = collect(1482026, nightFactor);
  const second = collect(1482026, nightFactor);
  assert.equal(first.length, EVENTS_PER_CONTEXT, `expected ${EVENTS_PER_CONTEXT} events for nightFactor=${nightFactor}`);
  assert.deepEqual(first.map((event) => event.id), second.map((event) => event.id), 'same seed must remain deterministic');
  for (let index = 1; index < first.length; index += 1) {
    assert.notEqual(first[index].id, first[index - 1].id, `immediate repeat at index ${index}: ${first[index].id}`);
  }
  for (const event of first) {
    if (nightFactor === 0) assert.notEqual(event.timeOfDay, 'night', `night event emitted at day: ${event.id}`);
    if (nightFactor === 1) assert.notEqual(event.timeOfDay, 'day', `day event emitted at night: ${event.id}`);
  }

  // Repeat suppression must not trade one visible defect for another by collapsing ambient life
  // onto a tiny deterministic subset. Keep this deliberately distribution-agnostic: rarity weights
  // may evolve, but every context must retain broad catalog coverage and no single event may own an
  // implausibly large share of the sample.
  const counts = new Map();
  for (const event of first) counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  const uniqueEvents = counts.size;
  const dominantCount = Math.max(...counts.values());
  const dominantShare = dominantCount / first.length;
  assert.ok(uniqueEvents >= MIN_UNIQUE_EVENTS, `ambient diversity collapsed for nightFactor=${nightFactor}: ${uniqueEvents} unique events`);
  assert.ok(dominantShare <= MAX_SINGLE_EVENT_SHARE, `one event dominates nightFactor=${nightFactor}: share=${dominantShare.toFixed(3)}`);
  contextProof.push({ nightFactor: nightFactor ?? 'legacy', uniqueEvents, dominantShare: Number(dominantShare.toFixed(3)) });
}

const baseline = collect(1482026, undefined).map((event) => event.id);
const different = collect(1482027, undefined).map((event) => event.id);
assert.notDeepEqual(baseline, different, 'different seeds must not collapse to the same sequence');

console.log('WORLD_EVENT_REPEAT_DIVERSITY_PASS', JSON.stringify({
  eventsChecked: EVENTS_PER_CONTEXT * contextProof.length,
  seed: 1482026,
  minUniqueEvents: MIN_UNIQUE_EVENTS,
  maxSingleEventShare: MAX_SINGLE_EVENT_SHARE,
  contexts: contextProof,
}));
