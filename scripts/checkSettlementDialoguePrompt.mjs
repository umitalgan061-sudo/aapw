import assert from 'node:assert/strict';
import { createSettlementDialoguePrompt } from '../src/3d/modern/settlementDialoguePrompt.ts';

const allowed = createSettlementDialoguePrompt({
  settlementId: 'aydinlik',
  service: 'blacksmith',
  serviceOpen: true,
  accessGranted: true,
  availableActions: ['repair', 'craft'],
});
assert.equal(allowed.tone, 'action');
assert.equal(allowed.action, 'craft');
assert.equal(allowed.key, 'aydinlik:blacksmith:action:craft');
assert(Object.isFrozen(allowed));

const blocked = createSettlementDialoguePrompt({
  settlementId: 'aydinlik',
  service: 'market',
  serviceOpen: true,
  accessGranted: false,
  availableActions: ['trade'],
});
assert.equal(blocked.tone, 'blocked');
assert.equal(blocked.action, null);

const quest = createSettlementDialoguePrompt({
  settlementId: 'aydinlik',
  service: 'stable',
  serviceOpen: true,
  accessGranted: true,
  availableActions: ['travel'],
  missingQuestIds: ['q-2', 'q-1', 'q-1'],
});
assert.deepEqual(quest.missingQuestIds, ['q-1', 'q-2']);
assert.equal(quest.tone, 'quest');
assert.equal(quest.action, null);
assert.equal(quest.body, 'Önce şu görevleri tamamla: q-1, q-2.');

const welcome = createSettlementDialoguePrompt({
  settlementId: 'aydinlik',
  service: 'farm',
  serviceOpen: true,
  accessGranted: true,
  availableActions: [],
});
assert.equal(welcome.tone, 'welcome');
assert.equal(welcome.action, null);

console.log('settlement dialogue prompt checks passed');
