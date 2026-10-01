import assert from 'node:assert/strict';
import { buildSettlementServiceAvailabilityTimeline, validateSettlementServiceAvailabilityTimeline } from '../src/3d/gameplay/settlementServiceAvailabilityTimeline.js';

const input = { currentHour: 21, horizonHours: 4, context: { insideSettlement: true, fatigue: 20 }, services: [
  { service: 'market', startHour: 8, endHour: 20, priority: 2 },
  { service: 'tavern', startHour: 18, endHour: 2, priority: 1 },
  { service: 'blacksmith', startHour: 7, endHour: 19, maxFatigue: 80, priority: 3 },
] };
const first = buildSettlementServiceAvailabilityTimeline(input);
const second = buildSettlementServiceAvailabilityTimeline(JSON.parse(JSON.stringify(input)));
assert.deepEqual(first, second);
assert.equal(first.primaryService, 'tavern');
assert.equal(first.rows.find((row) => row.service === 'market').reason, 'closed-hours');
assert.equal(first.snapshots.length, 5);
assert.equal(Object.isFrozen(first), true);
assert.equal(validateSettlementServiceAvailabilityTimeline(first).ok, true);
assert.equal(validateSettlementServiceAvailabilityTimeline({}).ok, false);
const defeated = buildSettlementServiceAvailabilityTimeline({ currentHour: 12, services: [{ service: 'farm', startHour: 0, endHour: 23 }], context: { defeated: true } });
assert.equal(defeated.rows[0].reason, 'defeated');
console.log('[settlement-service-availability-timeline] PASS');
