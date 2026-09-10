import assert from 'node:assert/strict';
import {
  createSettlementDialogueConditionMatrix,
  serializeSettlementDialogueConditionMatrix,
  applySettlementDialogueConditionMatrix,
} from '../src/3d/gameplay/settlementDialogueConditionMatrix.js';

const dialogues = [
  { id: 'rumor', speakerId: 'tavern-keeper', label: 'Kasaba söylentisi', priority: 10, conditions: [{ type: 'reputation', threshold: 5 }] },
  { id: 'blacksmith-quest', speakerId: 'smith', label: 'Kayıp cevher', priority: 20, conditions: [{ type: 'quest', target: 'ore-run', }, { type: 'item', target: 'iron-ore', threshold: 2 }] },
  { id: 'welcome', speakerId: 'gate', label: 'Hoş geldin', priority: 1, conditions: [] },
];
const record = { settlementId: 'northwatch', reputation: 7, copper: 40, insideSettlement: true, alive: true, quests: { 'ore-run': { completed: true } }, inventory: { 'iron-ore': 3 }, flags: {} };
const first = createSettlementDialogueConditionMatrix({ record, dialogues });
const second = createSettlementDialogueConditionMatrix({ record, dialogues: [...dialogues].reverse() });
assert.equal(first.summary.total, 3);
assert.equal(first.summary.available, 3);
assert.equal(first.summary.primaryDialogueId, 'blacksmith-quest');
assert.equal(serializeSettlementDialogueConditionMatrix(first), serializeSettlementDialogueConditionMatrix(second));
assert.equal(Object.isFrozen(first), true);
assert.throws(() => { first.summary.available = 0; }, TypeError);

const blocked = createSettlementDialogueConditionMatrix({ record: { ...record, reputation: 0 }, dialogues });
assert.equal(blocked.summary.blocked, 1);
assert.equal(blocked.rows.find((row) => row.id === 'rumor').reason, 'reputation-too-low');
const outside = createSettlementDialogueConditionMatrix({ record: { ...record, insideSettlement: false }, dialogues: [dialogues[2]] });
assert.equal(outside.rows[0].reason, 'outside-settlement');
const target = {};
assert.equal(applySettlementDialogueConditionMatrix(target, first), target);
assert.equal(target.settlementDialogueConditionMatrix.summary.available, 3);
console.log('Settlement dialogue condition matrix checks passed.');
