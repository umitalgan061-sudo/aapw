import assert from 'node:assert/strict';
import { planSettlementServiceBoard, serializeSettlementServiceBoard } from '../src/3d/gameplay/settlementServiceBoard.js';

const context = { fatigue: 78, copper: 6, completedServices: ['house'], unlockedServices: ['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable', 'house', 'gate'] };
const first = planSettlementServiceBoard(context);
const second = planSettlementServiceBoard(context);
assert.deepEqual(first, second, 'board must be deterministic');
assert.equal(first.services.length, 8, 'all authored services must be represented');
assert.equal(first.recommendedServiceId, 'tavern', 'high fatigue should prioritize tavern');
assert.equal(first.services.find((service) => service.id === 'house').state, 'complete', 'completed service state');
assert.equal(first.readyCount, 7, 'ready count');
assert.equal(first.completedCount, 1, 'completed count');
assert.equal(first.lockedCount, 0, 'unlocked board');
assert.ok(serializeSettlementServiceBoard(first).includes('recommendedServiceId'), 'stable serialization');
const locked = planSettlementServiceBoard({ unlockedServices: ['gate'] });
assert.equal(locked.services.filter((service) => service.state === 'locked').length, 7, 'locked fallback');
assert.equal(Object.isFrozen(first), true, 'board frozen');
assert.equal(Object.isFrozen(first.services), true, 'service list frozen');
console.log('Settlement service board checks passed');
