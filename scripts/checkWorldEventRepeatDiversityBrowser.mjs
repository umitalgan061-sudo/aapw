#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const MAX_INTERVAL_SECONDS = 95;
const EVENT_COUNT = 96;
const RESUME_SPIKE_SECONDS = 300;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async ({ maxIntervalSeconds, eventCount, resumeSpikeSeconds }) => {
    const { createWorldEventSystem } = await import('/src/3d/gameplay/worldEvents.js');
    const { EventBus } = await import('/src/3d/eventBus.js');

    const runSequence = (seed, nightFactor, { injectResumeSpike = false, mutatePayload = false } = {}) => {
      const bus = new EventBus();
      const eventName = `repeat-diversity-${seed}-${String(nightFactor ?? 'legacy')}-${injectResumeSpike ? 'resume' : 'steady'}-${mutatePayload ? 'mutating' : 'passive'}`;
      const events = [];
      bus.on(eventName, (payload) => {
        // Snapshot what the listener actually received before intentionally annotating/mutating it.
        // The mutation must stay local to this delivery and never reach the canonical event catalog.
        events.push({ ...payload });
        if (mutatePayload) {
          payload.id = 'listener-mutated';
          payload.weight = 999999;
          payload.timeOfDay = 'night';
        }
      });
      const system = createWorldEventSystem({ eventsBus: bus, seed, eventName });
      let spikeInjected = false;
      while (events.length < eventCount) {
        const before = events.length;
        for (let second = 0; second <= maxIntervalSeconds && events.length === before; second += 1) {
          if (injectResumeSpike && !spikeInjected && events.length >= Math.floor(eventCount / 3)) {
            system.update(resumeSpikeSeconds, nightFactor);
            spikeInjected = true;
          } else {
            system.update(1, nightFactor);
          }
        }
        if (events.length !== before + 1) break;
      }
      system.dispose();
      return events;
    };

    const runRetainedMutationSequence = (seed, nightFactor) => {
      const bus = new EventBus();
      const eventName = `repeat-diversity-retained-${seed}`;
      const events = [];
      const retainedPayloads = [];
      bus.on(eventName, (payload) => {
        events.push({ ...payload });
        retainedPayloads.push(payload);
        const previous = retainedPayloads.at(-2);
        if (previous) {
          previous.id = 'delayed-listener-mutated';
          previous.weight = 777777;
          previous.timeOfDay = 'day';
        }
      });
      const system = createWorldEventSystem({ eventsBus: bus, seed, eventName });
      while (events.length < eventCount) {
        const before = events.length;
        for (let second = 0; second <= maxIntervalSeconds && events.length === before; second += 1) {
          system.update(1, nightFactor);
        }
        if (events.length !== before + 1) break;
      }
      system.dispose();
      return {
        events,
        distinctPayloadObjects: new Set(retainedPayloads).size,
      };
    };

    const legacyEvents = runSequence(148, undefined);
    const legacyRepeatEvents = runSequence(148, undefined);
    const mutatingListenerEvents = runSequence(148, undefined, { mutatePayload: true });
    const retainedMutation = runRetainedMutationSequence(148, undefined);
    const resumeEvents = runSequence(148, undefined, { injectResumeSpike: true });
    const resumeRepeatEvents = runSequence(148, undefined, { injectResumeSpike: true });
    const noonEvents = runSequence(248, 0);
    const midnightEvents = runSequence(348, 1);
    const infinityEvents = runSequence(448, Infinity);
    const stringLightingEvents = runSequence(548, '1');
    const aboveRangeEvents = runSequence(648, 2);
    const belowRangeEvents = runSequence(748, -1);

    const ids = (events) => events.map((event) => event.id);
    const legacy = ids(legacyEvents);
    const legacyRepeat = ids(legacyRepeatEvents);
    const listenerMutated = ids(mutatingListenerEvents);
    const retainedMutated = ids(retainedMutation.events);
    const legacyWithResumeSpike = ids(resumeEvents);
    const legacyWithResumeSpikeRepeat = ids(resumeRepeatEvents);
    const noon = ids(noonEvents);
    const midnight = ids(midnightEvents);
    const hasAdjacentRepeat = (eventIds) => eventIds.some((id, index) => index > 0 && id === eventIds[index - 1]);

    return {
      legacyCount: legacy.length,
      mutatingListenerCount: listenerMutated.length,
      retainedMutationCount: retainedMutated.length,
      retainedDistinctPayloadObjects: retainedMutation.distinctPayloadObjects,
      resumeCount: legacyWithResumeSpike.length,
      noonCount: noon.length,
      midnightCount: midnight.length,
      malformedCount: infinityEvents.length + stringLightingEvents.length,
      clampedCount: aboveRangeEvents.length + belowRangeEvents.length,
      legacyNoAdjacentRepeat: !hasAdjacentRepeat(legacy),
      listenerMutationNoAdjacentRepeat: !hasAdjacentRepeat(listenerMutated),
      retainedMutationNoAdjacentRepeat: !hasAdjacentRepeat(retainedMutated),
      resumeNoAdjacentRepeat: !hasAdjacentRepeat(legacyWithResumeSpike),
      noonNoAdjacentRepeat: !hasAdjacentRepeat(noon),
      midnightNoAdjacentRepeat: !hasAdjacentRepeat(midnight),
      sameSeedSameSequence: JSON.stringify(legacy) === JSON.stringify(legacyRepeat),
      listenerMutationPreservesSequence: JSON.stringify(legacy) === JSON.stringify(listenerMutated),
      listenerMutationNeverLeaks: !listenerMutated.includes('listener-mutated'),
      retainedMutationPreservesSequence: JSON.stringify(legacy) === JSON.stringify(retainedMutated),
      retainedMutationNeverLeaks: !retainedMutated.includes('delayed-listener-mutated'),
      resumeSameSeedSameSequence: JSON.stringify(legacyWithResumeSpike) === JSON.stringify(legacyWithResumeSpikeRepeat),
      resumePreservesEventOrder: JSON.stringify(legacy) === JSON.stringify(legacyWithResumeSpike),
      noonExcludesNightOnly: !noonEvents.some((event) => event.timeOfDay === 'night'),
      midnightExcludesDayOnly: !midnightEvents.some((event) => event.timeOfDay === 'day'),
      malformedLightingIsUngatedOnly: [...infinityEvents, ...stringLightingEvents].every((event) => event.timeOfDay === undefined),
      aboveRangeClampsToNight: aboveRangeEvents.every((event) => event.timeOfDay !== 'day'),
      belowRangeClampsToDay: belowRangeEvents.every((event) => event.timeOfDay !== 'night'),
    };
  }, { maxIntervalSeconds: MAX_INTERVAL_SECONDS, eventCount: EVENT_COUNT, resumeSpikeSeconds: RESUME_SPIKE_SECONDS });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert.equal(proof.legacyCount, EVENT_COUNT, 'legacy runtime must emit the full browser sample');
  assert.equal(proof.mutatingListenerCount, EVENT_COUNT, 'mutating-listener runtime must emit the full browser sample');
  assert.equal(proof.retainedMutationCount, EVENT_COUNT, 'retained-mutation runtime must emit the full browser sample');
  assert.equal(proof.retainedDistinctPayloadObjects, EVENT_COUNT, 'every browser world-event emission must deliver a fresh payload object');
  assert.equal(proof.resumeCount, EVENT_COUNT, 'resume-spike runtime must emit the full browser sample');
  assert.equal(proof.noonCount, EVENT_COUNT, 'noon runtime must emit the full browser sample');
  assert.equal(proof.midnightCount, EVENT_COUNT, 'midnight runtime must emit the full browser sample');
  assert.equal(proof.malformedCount, EVENT_COUNT * 2, 'malformed lighting contexts must emit complete fail-closed samples');
  assert.equal(proof.clampedCount, EVENT_COUNT * 2, 'finite out-of-range lighting contexts must emit complete clamped samples');
  assert.equal(proof.legacyNoAdjacentRepeat, true, 'legacy runtime emitted adjacent duplicate world events');
  assert.equal(proof.listenerMutationNoAdjacentRepeat, true, 'mutating EventBus listener broke repeat diversity');
  assert.equal(proof.retainedMutationNoAdjacentRepeat, true, 'delayed mutation of a retained payload broke repeat diversity');
  assert.equal(proof.resumeNoAdjacentRepeat, true, 'resume-spike runtime emitted adjacent duplicate world events');
  assert.equal(proof.noonNoAdjacentRepeat, true, 'noon runtime emitted adjacent duplicate world events');
  assert.equal(proof.midnightNoAdjacentRepeat, true, 'midnight runtime emitted adjacent duplicate world events');
  assert.equal(proof.sameSeedSameSequence, true, 'same seed must preserve the same shipped-browser event sequence');
  assert.equal(proof.listenerMutationPreservesSequence, true, 'EventBus listener mutation poisoned canonical seeded event selection');
  assert.equal(proof.listenerMutationNeverLeaks, true, 'a prior listener mutation leaked back out of the canonical world-event catalog');
  assert.equal(proof.retainedMutationPreservesSequence, true, 'delayed mutation of a retained EventBus payload poisoned later event selection');
  assert.equal(proof.retainedMutationNeverLeaks, true, 'a delayed retained-payload mutation leaked into a later browser event');
  assert.equal(proof.resumeSameSeedSameSequence, true, 'same seed plus the same resume spike must remain deterministic');
  assert.equal(proof.resumePreservesEventOrder, true, 'bounded resume spikes must not perturb seeded ambient event ordering');
  assert.equal(proof.noonExcludesNightOnly, true, 'noon browser sequence violated night-only gating');
  assert.equal(proof.midnightExcludesDayOnly, true, 'midnight browser sequence violated day-only gating');
  assert.equal(proof.malformedLightingIsUngatedOnly, true, 'malformed lighting input emitted a time-gated event in shipped runtime');
  assert.equal(proof.aboveRangeClampsToNight, true, 'nightFactor above 1 did not clamp to canonical night gating');
  assert.equal(proof.belowRangeClampsToDay, true, 'nightFactor below 0 did not clamp to canonical day gating');

  console.log('WORLD_EVENT_REPEAT_DIVERSITY_BROWSER_PASS', JSON.stringify({
    ...proof,
    resumeSpikeSeconds: RESUME_SPIKE_SECONDS,
  }));
} finally {
  await browser.close();
}
