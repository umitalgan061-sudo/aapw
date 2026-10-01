import assert from 'node:assert/strict';
import { planSettlementPoiTravel, serializeSettlementPoiTravelPlan } from '../src/3d/gameplay/settlementPoiTravelPlanner.js';

const context = {
  player: { fatigue: 20, health: 100, copper: 120 },
  travel: { enabled: true, currentSettlement: 'winterfell', baseCost: 10, costPerDistance: 2, fatiguePerDistance: 1 },
  pois: [
    { id: 'market', label: 'Market', type: 'market', distance: 4, unlocked: true, discovered: true, destination: 'market' },
    { id: 'ruin', label: 'Ruin', type: 'ruin', distance: 2, unlocked: true, discovered: false, destination: 'ruin' },
    { id: 'smith', label: 'Smith', type: 'blacksmith', distance: 8, unlocked: false, discovered: true, destination: 'smith' },
  ],
};
const first = planSettlementPoiTravel(context);
const second = planSettlementPoiTravel(context);
assert.deepEqual(first, second);
assert.equal(first.summary.recommendedDestination, 'market');
assert.equal(first.routes.find((r) => r.id === 'market').available, true);
assert.equal(first.routes.find((r) => r.id === 'ruin').reason, 'undiscovered');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.routes), true);
assert.equal(serializeSettlementPoiTravelPlan(first), serializeSettlementPoiTravelPlan(second));
const malformed = planSettlementPoiTravel({ player: { fatigue: 'bad', health: NaN, copper: Infinity }, travel: { enabled: true }, pois: null });
assert.equal(malformed.canTravel, false);
assert.equal(malformed.summary.routeCount, 0);
console.log('settlement poi travel planner checks passed');
