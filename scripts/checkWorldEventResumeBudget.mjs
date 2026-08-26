#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorldEventSystem, MAX_WORLD_EVENT_STEP_SECONDS } from '../src/3d/gameplay/worldEvents.js';

assert.equal(MAX_WORLD_EVENT_STEP_SECONDS, 1, 'ambient world-event simulation must be capped to one second per rendered frame');

function makeHarness(seed = 0x5af4a11) {
  const events = [];
  const system = createWorldEventSystem({
    eventsBus: { emit: (name, payload) => events.push({ name, id: payload.id }) },
    seed,
    eventName: 'world-event-test',
  });
  return { system, events };
}

const resume = makeHarness();
resume.system.update(300, 0.8);
assert.equal(resume.events.length, 0, 'a five-minute background-frame delta must not immediately fire an ambient event');
for (let i = 0; i < 40; i += 1) resume.system.update(1, 0.8);
assert.equal(resume.events.length, 0, 'bounded resume must preserve the authored minimum interval before any event can fire');
for (let i = 0; i < 60; i += 1) resume.system.update(1, 0.8);
assert.ok(resume.events.length >= 1 && resume.events.length <= 2, `100 foreground seconds should yield a bounded ambient count, got ${resume.events.length}`);
resume.system.dispose();

const invalid = makeHarness();
invalid.system.update(Number.NaN, 0);
invalid.system.update(Infinity, 0);
invalid.system.update(-10, 0);
assert.equal(invalid.events.length, 0, 'invalid or negative deltas must not advance ambient world events');
invalid.system.dispose();

const a = makeHarness(123456);
const b = makeHarness(123456);
for (let frame = 0; frame < 240; frame += 1) {
  const delta = frame === 80 ? 180 : (frame % 3 === 0 ? 1 / 30 : 1 / 60);
  const nightFactor = frame < 120 ? 0.05 : 0.85;
  a.system.update(delta, nightFactor);
  b.system.update(delta, nightFactor);
}
assert.deepEqual(a.events, b.events, 'same seed and frame sequence must remain bit-for-bit event deterministic across a resume spike');
a.system.dispose();
b.system.dispose();

console.log('WORLD_EVENT_RESUME_BUDGET_PASS', JSON.stringify({ emittedAfter100ForegroundSeconds: resume.events.length, deterministicEvents: a.events }));
