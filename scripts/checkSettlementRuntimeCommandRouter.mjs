import assert from 'node:assert/strict';
import {
  routeSettlementCommand,
  createSettlementCommandBatch,
  serializeSettlementCommandResult,
} from '../src/3d/gameplay/settlementRuntimeCommandRouter.js';

const snapshot = {
  inventory: { iron_ore: 3, coal: 1 },
  copper: 100,
  tradeModifiers: { buyRate: -0.04 },
  travelModifiers: { fatigueRate: -0.07 },
};

const craft = routeSettlementCommand({ serviceId: 'blacksmith', action: 'craft', recipeId: 'iron_sword', requestId: 'c1' }, snapshot);
assert.equal(craft.preflight.ok, true);
assert.equal(craft.handler, 'craft');

const buy = routeSettlementCommand({ serviceId: 'market', action: 'buy', itemId: 'bread', quantity: 2, requestId: 'b1' }, snapshot);
assert.equal(buy.preflight.total, 6);
assert.equal(buy.handler, 'trade');

const blocked = routeSettlementCommand({ serviceId: 'gate', action: 'travel', routeId: 'unknown', requestId: 't1' }, snapshot);
assert.equal(blocked.preflight.ok, false);
assert.equal(blocked.preflight.reason, 'unknown-route');

const unsupported = routeSettlementCommand({ serviceId: 'tavern', action: 'craft' }, snapshot);
assert.equal(unsupported.reason, 'unsupported-action');

const batchA = createSettlementCommandBatch([
  { serviceId: 'blacksmith', action: 'talk' },
  { serviceId: 'market', action: 'sell', itemId: 'bread', quantity: 2 },
  { serviceId: 'gate', action: 'travel', routeId: 'north_gate' },
], snapshot);
const batchB = createSettlementCommandBatch([
  { serviceId: 'blacksmith', action: 'talk' },
  { serviceId: 'market', action: 'sell', itemId: 'bread', quantity: 2 },
  { serviceId: 'gate', action: 'travel', routeId: 'north_gate' },
], snapshot);
assert.deepEqual(batchA, batchB);
assert.equal(batchA.count, 3);
assert.equal(batchA.ready, 3);
assert.ok(Object.isFrozen(batchA));
assert.match(serializeSettlementCommandResult(craft), /"handler":"craft"/);

console.log('settlement-runtime-command-router: ok');
