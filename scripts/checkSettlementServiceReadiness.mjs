import { strict as assert } from 'node:assert';
import { createSettlementServiceReadiness, serializeSettlementServiceReadiness } from '../src/3d/gameplay/settlementServiceReadiness.js';

const snapshot = { copper: 120, fatigue: 10, health: 100, inventory: { iron_ore: 3, wood: 2 }, perks: [] };
const intents = [
  { kind: 'trade', itemId: 'iron_ore', quantity: 1, direction: 'buy' },
  { kind: 'craft', recipeId: 'iron_sword' },
  { kind: 'travel', routeId: 'north_gate' },
];
const first = createSettlementServiceReadiness({ snapshot, intents });
const second = createSettlementServiceReadiness({ snapshot, intents });
assert.deepEqual(first, second);
assert.equal(Object.isFrozen(first), true);
assert.equal(first.services.length, 8);
assert.equal(first.intents.length, 3);
assert.equal(first.intents.every((item) => ['ready', 'blocked'].includes(item.status)), true);
assert.equal(typeof first.digest, 'string');
assert.equal(serializeSettlementServiceReadiness(first), serializeSettlementServiceReadiness(second));
const tired = createSettlementServiceReadiness({ snapshot: { ...snapshot, fatigue: 99 } });
assert.equal(tired.services.find((item) => item.id === 'tavern').status, 'ready');
assert.equal(tired.services.find((item) => item.id === 'market').status, 'deferred');
const defeated = createSettlementServiceReadiness({ snapshot: { ...snapshot, health: 0 } });
assert.equal(defeated.services.every((item) => item.status === 'blocked'), true);
const malformed = createSettlementServiceReadiness({ snapshot: { copper: 'x', fatigue: 'x', health: 'x', inventory: null }, intents: [{ kind: 'mystery' }] });
assert.equal(malformed.summary.copper, 0);
assert.equal(malformed.summary.fatigue, 0);
assert.equal(malformed.intents[0].reason, 'unsupported-intent');
console.log('settlement service readiness checks passed');
