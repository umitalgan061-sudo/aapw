import assert from 'node:assert/strict';
import { projectSettlementServiceAvailability } from '../src/3d/modern/settlementServiceAvailabilityProjection.ts';

const input = [
  { service: 'stable', status: 'available', availableActions: ['travel', 'travel', 'rest'] },
  { service: 'blacksmith', status: 'locked', missingQuestIds: ['q-2', 'q-1', 'q-2'], reason: 'quest-locked' },
  { service: 'tavern', status: 'closed', availableActions: ['rest'] },
  { service: 'unknown', status: 'available', availableActions: ['trade'] },
  null,
];

const projection = projectSettlementServiceAvailability(input);
assert.deepEqual(projection.rows.map((row) => row.service), ['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable']);
assert.equal(projection.rows[0].missingQuestIds.join(','), 'q-1,q-2');
assert.deepEqual(projection.rows[5].availableActions, ['rest', 'travel']);
assert.equal(projection.rows[2].reason, 'service-unreported');
assert.equal(projection.availableCount, 1);
assert.equal(projection.blockedCount, 5);
assert.equal(projection.actionableCount, 2);
assert.equal(Object.isFrozen(projection), true);
assert.equal(Object.isFrozen(projection.rows[5]), true);
assert.equal(projectSettlementServiceAvailability([...input].reverse()).signature, projection.signature);
assert.deepEqual(input[0].availableActions, ['travel', 'travel', 'rest']);
console.log('settlement availability projection proof: PASS');
