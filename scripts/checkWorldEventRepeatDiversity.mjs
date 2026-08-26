#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorldEventSystem } from '../src/3d/gameplay/worldEvents.js';

const EVENTS_PER_CONTEXT = 160;
const MIN_UNIQUE_EVENTS = 20;
const MAX_SINGLE_EVENT_SHARE = 0.12;
const CADENCE_EVENTS = 24;
const MIN_INTERVAL_SECONDS = 45;
const MAX_INTERVAL_SECONDS = 90;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function collectEmissionSeconds(seed, count) {
  const emittedSeconds = [];
  let simulatedSeconds = 0;
  const system = createWorldEventSystem({
    eventsBus: { emit: () => emittedSeconds.push(simulatedSeconds) },
    seed,
    eventName: 'world:event',
  });
  while (emittedSeconds.length < count && simulatedSeconds < 5000) {
    simulatedSeconds += 1;
    system.update(1, undefined);
  }
  system.dispose();
  return emittedSeconds;
}

function expectedEmissionSeconds(seed, count) {
  const random = mulberry32(seed);
  let secondsUntilNext = MIN_INTERVAL_SECONDS + random() * (MAX_INTERVAL_SECONDS - MIN_INTERVAL_SECONDS);
  let simulatedSeconds = 0;
  const expected = [];
  while (expected.length < count && simulatedSeconds < 5000) {
    simulatedSeconds += 1;
    secondsUntilNext -= 1;
    if (secondsUntilNext > 0) continue;
    expected.push(simulatedSeconds);
    secondsUntilNext += MIN_INTERVAL_SECONDS + random() * (MAX_INTERVAL_SECONDS - MIN_INTERVAL_SECONDS);
    random(); // weighted event selection: repeat suppression must not consume another RNG draw
  }
  return expected;
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

const cadenceSeed = 1482026;
const actualCadence = collectEmissionSeconds(cadenceSeed, CADENCE_EVENTS);
const expectedCadence = expectedEmissionSeconds(cadenceSeed, CADENCE_EVENTS);
assert.equal(actualCadence.length, CADENCE_EVENTS, `expected ${CADENCE_EVENTS} cadence events`);
assert.deepEqual(
  actualCadence,
  expectedCadence,
  'repeat suppression changed the canonical RNG draw order or event interval cadence',
);

const baseline = collect(1482026, undefined).map((event) => event.id);
const different = collect(1482027, undefined).map((event) => event.id);
assert.notDeepEqual(baseline, different, 'different seeds must not collapse to the same sequence');

console.log('WORLD_EVENT_REPEAT_DIVERSITY_PASS', JSON.stringify({
  eventsChecked: EVENTS_PER_CONTEXT * contextProof.length,
  seed: 1482026,
  minUniqueEvents: MIN_UNIQUE_EVENTS,
  maxSingleEventShare: MAX_SINGLE_EVENT_SHARE,
  cadenceEventsChecked: CADENCE_EVENTS,
  cadenceLastSecond: actualCadence.at(-1),
  contexts: contextProof,
}));
