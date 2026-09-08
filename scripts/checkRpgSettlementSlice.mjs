import assert from 'node:assert/strict';
import {
  buyItem, completeQuestObjective, craftItem, createRpgSettlementState,
  loadRpgState, saveRpgState, useService
} from '../gameplay/rpgSettlementSlice.js';

const state = createRpgSettlementState('proof-seed');
assert.equal(state.location, 'winterfell');
assert.equal(buyItem(state, 'bread', 4, 2).ok, true);
assert.equal(state.inventory.bread, 4);
assert.equal(useService(state, 'farm').ok, true);
assert.equal(state.quests['settlement-supply'].progress, 1);
assert.equal(useService(state, 'farm').ok, true);
assert.equal(useService(state, 'farm').ok, true);
assert.equal(state.quests['settlement-supply'].state, 'complete');
assert.equal(state.quests['road-to-market'].state, 'active');
assert.equal(craftItem(state, 'ironSword').ok, true);
const save = saveRpgState(state);
const restored = loadRpgState(save);
assert.deepEqual(restored.inventory, state.inventory);
assert.equal(restored.quests['road-to-market'].state, 'active');
assert.equal(completeQuestObjective(restored, 'road-to-market').ok, true);
console.log('RPG settlement slice: PASS');
