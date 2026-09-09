import assert from 'node:assert/strict';
import { previewSettlementDialogueConsequences, serializeSettlementDialogueConsequencePreview } from '../src/3d/gameplay/settlementDialogueConsequencePreview.js';

const dialogue = {
  id: 'tavern-keeper', title: 'Kervan söylentisi', prompt: 'Ne yapacaksın?',
  choices: [
    { id: 'ask', label: 'Sor', conditions: [], effects: [{ type: 'xp', amount: 5 }] },
    { id: 'bribe', label: 'Rüşvet ver', conditions: ['has-copper'], effects: [{ type: 'copper', amount: -10 }, { type: 'reputation', amount: 1 }], terminal: true },
  ],
};
const rich = { copper: 20, flags: { 'has-copper': true }, quests: {}, inventory: {}, skills: {}, perks: [] };
const poor = { copper: 0, flags: {}, quests: {}, inventory: {}, skills: {}, perks: [] };
const first = previewSettlementDialogueConsequences(dialogue, rich);
const second = previewSettlementDialogueConsequences(dialogue, rich);
assert.deepEqual(first, second);
assert.equal(first.availableCount, 2);
assert.equal(first.terminalAvailable, true);
assert.equal(first.choices[1].effects[0], '-10 bakır');
const blocked = previewSettlementDialogueConsequences(dialogue, poor);
assert.equal(blocked.availableCount, 1);
assert.equal(blocked.blockedCount, 1);
assert.equal(blocked.choices[1].status, 'blocked');
assert.equal(Object.isFrozen(blocked), true);
assert.equal(serializeSettlementDialogueConsequencePreview(dialogue, rich), serializeSettlementDialogueConsequencePreview(dialogue, rich));
console.log(`settlement-dialogue-consequence-preview checks passed (${first.digest})`);
