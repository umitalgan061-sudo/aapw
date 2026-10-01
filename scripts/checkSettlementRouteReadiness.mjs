import { strict as assert } from 'node:assert';
import { buildSettlementRouteReadiness, validateSettlementRouteReadiness } from '../src/3d/gameplay/settlementRouteReadiness.js';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const routes = [
  { id: 'hill_fort', name: 'Hill Fort', destination: 'hill-fort', cost: 20, fatigue: 15, minReputation: 5, requiredSkill: 2 },
  { id: 'north_gate', name: 'North Gate', destination: 'north-gate', cost: 5, fatigue: 4 },
  { id: 'watch_post', name: 'Watch Post', destination: 'watch-post', cost: 0, fatigue: 8, requiredItem: 'travel-ration' },
];
const input = { routes, context: { insideSettlement: true, defeated: false, copper: 30, fatigue: 10, maxFatigue: 40, reputation: 7, skill: 3, items: { 'travel-ration': 1 } } };
const first = buildSettlementRouteReadiness(input);
const second = buildSettlementRouteReadiness({ ...input, routes: [...routes].reverse() });
ok(validateSettlementRouteReadiness(first), 'valid-output');
equal(first.fingerprint, second.fingerprint, 'order-independent');
equal(first.counts.total, 3, 'route-count');
equal(first.counts.available, 3, 'available-count');
equal(first.primaryRouteId, 'hill_fort', 'stable-primary');
ok(Object.isFrozen(first) && Object.isFrozen(first.routes) && Object.isFrozen(first.context), 'deep-freeze');
const blocked = buildSettlementRouteReadiness({ routes, context: { insideSettlement: false, defeated: false, copper: 0, fatigue: 39, maxFatigue: 40, reputation: 0, skill: 0, items: {} } });
equal(blocked.nextAction, 'resolve-blocker', 'blocked-action');
ok(blocked.routes.every((row) => row.reason), 'blocked-reasons');
const defeated = buildSettlementRouteReadiness({ routes, context: { insideSettlement: true, defeated: true } });
ok(defeated.routes.every((row) => row.reasons.includes('defeated')), 'defeated-gating');
const malformed = buildSettlementRouteReadiness({ routes: [{ id: 'bad', cost: 'x', fatigue: NaN }], context: { copper: 'x', fatigue: Infinity, maxFatigue: 'x' } });
equal(malformed.context.copper, 0, 'finite-copper-fallback');
equal(malformed.routes[0].cost, 0, 'finite-cost-fallback');
console.log(`settlement-route-readiness checks=${checks}`);
