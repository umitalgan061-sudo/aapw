import assert from 'node:assert/strict';
import { planSettlementDialogue, getAvailableSettlementDialogueChoices, serializeSettlementDialoguePlan } from '../src/3d/gameplay/settlementDialoguePlanner.js';

const dialogue = { id:'market-dialogue', speaker:'Mira', prompt:'What do you need?', choices:[
  { id:'buy', label:'Buy supplies', action:'trade', conditions:['market-open'] },
  { id:'teach', label:'Ask about the road', action:'talk', conditions:['known-road'] },
  { id:'leave', label:'Leave', terminal:true },
]};
const snapshot = { flags:{'market-open':true}, quests:{}, inventory:{}, skills:{}, copper:100, fatigue:10 };
const first = planSettlementDialogue(dialogue, snapshot);
const second = planSettlementDialogue(dialogue, snapshot);
assert.deepEqual(first, second);
assert.equal(first.availableCount, 2);
assert.equal(first.blockedCount, 1);
assert.equal(first.choices[0].available, true);
assert.equal(first.choices[1].available, false);
assert.equal(getAvailableSettlementDialogueChoices(dialogue, snapshot).length, 2);
assert.throws(() => { first.choices.push({}); }, TypeError);
assert.equal(serializeSettlementDialoguePlan(first), serializeSettlementDialoguePlan(second));
const malformed = planSettlementDialogue({ choices: [null, { conditions:['missing'] }] }, {});
assert.equal(malformed.choices.length, 2);
assert.equal(malformed.choices[1].available, false);
console.log('settlement dialogue planner checks: 9 passed');
