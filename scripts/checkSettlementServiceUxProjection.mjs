import assert from 'node:assert/strict';
import { buildSettlementServiceUxProjection, stableSettlementServiceUxFingerprint } from '../src/3d/gameplay/settlementServiceUxProjection.js';

const input = {
  settlementId: 'winterfell',
  insideSettlement: true,
  playerState: { gold: 12, craftingMaterials: 2 },
  services: [
    { id: 'tavern', ready: true, distance: 8, queue: 0 },
    { id: 'blacksmith', ready: true, distance: 11, queue: 1 },
    { id: 'market', ready: false, distance: 4, queue: 0 },
  ],
};
const first = buildSettlementServiceUxProjection(input);
const second = buildSettlementServiceUxProjection(JSON.parse(JSON.stringify(input)));
assert.equal(first.version, 2);
assert.equal(first.summary.nextAction, 'rest');
assert.equal(first.summary.availableCount, 2);
assert.equal(first.summary.blockedCount, 0);
assert.equal(first.cards[0].serviceId, 'tavern');
assert.equal(first.cards[1].hint, 'queued:blacksmith:1');
assert.equal(first.cards[1].usable, true);
assert.equal(stableSettlementServiceUxFingerprint(first), stableSettlementServiceUxFingerprint(second));
assert(Object.isFrozen(first));
assert(Object.isFrozen(first.cards));
assert(Object.isFrozen(first.cards[0]));

const noResources = buildSettlementServiceUxProjection({
  ...input,
  playerState: { gold: 0, craftingMaterials: 0 },
  services: [
    { id: 'market', ready: true, distance: 4 },
    { id: 'blacksmith', ready: true, distance: 5 },
    { id: 'tavern', ready: true, distance: 6 },
  ],
});
assert.equal(noResources.summary.nextAction, 'rest');
assert.equal(noResources.summary.availableCount, 1);
assert.equal(noResources.summary.blockedCount, 2);
assert.equal(noResources.cards.find((card) => card.serviceId === 'market').status, 'blocked');
assert.equal(noResources.cards.find((card) => card.serviceId === 'market').usable, false);
assert.equal(noResources.cards.find((card) => card.serviceId === 'market').hint, 'market:needs-gold');
assert.equal(noResources.cards.find((card) => card.serviceId === 'blacksmith').status, 'blocked');

const outside = buildSettlementServiceUxProjection({ ...input, insideSettlement: false });
assert.equal(outside.cards.length, 0);
assert.equal(outside.summary.blockedReason, 'outside-settlement');
assert.equal(outside.summary.nextAction, null);

const malformed = buildSettlementServiceUxProjection({
  settlementId: 42,
  insideSettlement: true,
  playerState: { gold: Number.NaN, craftingMaterials: Number.POSITIVE_INFINITY },
  services: [{ id: 'blacksmith', ready: true, distance: 'bad', queue: -4 }],
});
assert.equal(malformed.settlementId, 'unknown-settlement');
assert.equal(malformed.cards[0].distance, 0);
assert.equal(malformed.cards[0].queue, 0);
assert.equal(malformed.cards[0].status, 'blocked');
assert.equal(malformed.cards[0].hint, 'blacksmith:needs-materials');

console.log('Settlement Service UX Projection: PASS');
