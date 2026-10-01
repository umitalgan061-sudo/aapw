import assert from 'node:assert/strict';
import { resolveDialogueChoices } from '../src/3d/gameplay/dialogueConditionResolver.js';

const choices = [
  { id: 'open', label: 'Open', response: 'open' },
  { id: 'quest', label: 'Quest', response: 'quest', condition: { questId: 'wolves' } },
  { id: 'item', label: 'Item', response: 'item', condition: { itemId: 'iron', quantity: 2 } },
  { id: 'rep', label: 'Rep', response: 'rep', condition: { reputation: { factionId: 'north', minimum: 5 } } },
  { id: 'flag', label: 'Flag', response: 'flag', condition: { flag: 'met-blacksmith' } },
];

const context = {
  completedQuestIds: new Set(['wolves']),
  inventory: { iron: 2 },
  reputation: { north: 5 },
  flags: { 'met-blacksmith': true },
};

const first = resolveDialogueChoices(choices, context);
const second = resolveDialogueChoices(choices, context);
assert.deepEqual(first, second);
assert.deepEqual(first.choices.map((choice) => choice.id), ['open', 'quest', 'item']);
assert.equal(first.filteredCount, 2);
assert.equal(resolveDialogueChoices(choices, {}).choices.length, 1);
assert.equal(resolveDialogueChoices(choices, context, { maxChoices: 0 }).choices.length, 0);
assert.equal(resolveDialogueChoices(null, context).choices.length, 0);
console.log('DIALOGUE_CONDITION_RESOLVER_OK');
