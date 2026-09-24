import assert from 'node:assert/strict';
import { projectSettlementServiceRoute, isSettlementServiceRoute } from '../src/3d/gameplay/settlementServiceRoute.ts';

const ready = projectSettlementServiceRoute({
  serviceId: 'blacksmith',
  stage: 'inside',
  availableActions: ['craft', 'talk', 'craft'],
  requestedAction: 'craft',
});
assert.equal(ready.reason, 'ready');
assert.equal(ready.nextAction, 'craft');
assert.equal(ready.blocked, false);
assert.deepEqual(ready.availableActions, ['craft', 'talk']);
assert.equal(isSettlementServiceRoute(ready), true);
assert.equal(Object.isFrozen(ready), true);
assert.equal(Object.isFrozen(ready.availableActions), true);
assert.equal(Object.isFrozen(ready.condition), true);

const reordered = projectSettlementServiceRoute({
  serviceId: 'blacksmith',
  stage: 'inside',
  availableActions: ['talk', 'craft'],
  requestedAction: 'craft',
});
assert.deepEqual(reordered, ready);

const blocked = projectSettlementServiceRoute({
  serviceId: 'tavern',
  stage: 'service',
  availableActions: ['talk', 'acceptQuest'],
  requestedAction: 'acceptQuest',
  condition: { key: 'reputation', passed: false },
});
assert.equal(blocked.reason, 'condition-blocked');
assert.equal(blocked.blocked, true);
assert.equal(blocked.nextAction, 'talk');

const unavailable = projectSettlementServiceRoute({
  serviceId: 'market',
  stage: 'inside',
  availableActions: ['buy', 'sell'],
  requestedAction: 'craft',
});
assert.equal(unavailable.reason, 'action-unavailable');
assert.equal(unavailable.blocked, true);

const invalid = projectSettlementServiceRoute({ serviceId: 'not-a-service', stage: 'inside' });
assert.equal(invalid.reason, 'service-unavailable');
assert.equal(invalid.blocked, true);

const original = { availableActions: ['sell', 'buy'] };
projectSettlementServiceRoute({ serviceId: 'market', stage: 'inside', ...original });
assert.deepEqual(original, { availableActions: ['sell', 'buy'] });

const tampered = { ...ready, nextAction: 'sell' };
assert.equal(isSettlementServiceRoute(tampered), false);

const tamperedFlags = { ...ready, serviceKnown: false };
assert.equal(isSettlementServiceRoute(tamperedFlags), false);

const tamperedCondition = { ...ready, condition: { ...ready.condition, passed: false } };
assert.equal(isSettlementServiceRoute(tamperedCondition), false);

console.log('Settlement service route proof passed');
