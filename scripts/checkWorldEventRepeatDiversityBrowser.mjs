#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const MAX_INTERVAL_SECONDS = 95;
const EVENT_COUNT = 96;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async ({ maxIntervalSeconds, eventCount }) => {
    const { createWorldEventSystem } = await import('/src/3d/gameplay/worldEvents.js');
    const { EventBus } = await import('/src/3d/eventBus.js');

    const runSequence = (seed, nightFactor) => {
      const bus = new EventBus();
      const eventName = `repeat-diversity-${seed}-${nightFactor ?? 'legacy'}`;
      const ids = [];
      bus.on(eventName, (payload) => ids.push(payload.id));
      const system = createWorldEventSystem({ eventsBus: bus, seed, eventName });
      while (ids.length < eventCount) {
        const before = ids.length;
        for (let second = 0; second <= maxIntervalSeconds && ids.length === before; second += 1) {
          system.update(1, nightFactor);
        }
        if (ids.length !== before + 1) break;
      }
      system.dispose();
      return ids;
    };

    const legacy = runSequence(148, undefined);
    const legacyRepeat = runSequence(148, undefined);
    const noon = runSequence(248, 0);
    const midnight = runSequence(348, 1);
    const hasAdjacentRepeat = (ids) => ids.some((id, index) => index > 0 && id === ids[index - 1]);

    return {
      legacyCount: legacy.length,
      noonCount: noon.length,
      midnightCount: midnight.length,
      legacyNoAdjacentRepeat: !hasAdjacentRepeat(legacy),
      noonNoAdjacentRepeat: !hasAdjacentRepeat(noon),
      midnightNoAdjacentRepeat: !hasAdjacentRepeat(midnight),
      sameSeedSameSequence: JSON.stringify(legacy) === JSON.stringify(legacyRepeat),
      noonExcludesNightOnly: !noon.some((id) => ['wolf_howl', 'falling_star', 'northern_lights'].includes(id)),
      midnightExcludesDayOnly: !midnight.some((id) => ['eclipse', 'harvest_wagons', 'market_day', 'alms_giving'].includes(id)),
    };
  }, { maxIntervalSeconds: MAX_INTERVAL_SECONDS, eventCount: EVENT_COUNT });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(proof.legacyCount, EVENT_COUNT, 'legacy runtime must emit the full browser sample');
  assert.equal(proof.noonCount, EVENT_COUNT, 'noon runtime must emit the full browser sample');
  assert.equal(proof.midnightCount, EVENT_COUNT, 'midnight runtime must emit the full browser sample');
  assert.equal(proof.legacyNoAdjacentRepeat, true, 'legacy runtime emitted adjacent duplicate world events');
  assert.equal(proof.noonNoAdjacentRepeat, true, 'noon runtime emitted adjacent duplicate world events');
  assert.equal(proof.midnightNoAdjacentRepeat, true, 'midnight runtime emitted adjacent duplicate world events');
  assert.equal(proof.sameSeedSameSequence, true, 'same seed must preserve the same shipped-browser event sequence');
  assert.equal(proof.noonExcludesNightOnly, true, 'noon browser sequence violated night-only gating');
  assert.equal(proof.midnightExcludesDayOnly, true, 'midnight browser sequence violated day-only gating');

  console.log('WORLD_EVENT_REPEAT_DIVERSITY_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
