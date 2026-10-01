import assert from 'node:assert/strict';
import {
  createSettlementSaveCheckpointPlanner,
  serializeSettlementSaveCheckpoint,
} from '../src/3d/gameplay/settlementSaveCheckpointPlanner.js';

const currentState = {
  schemaVersion: 1,
  savedAt: 200,
  settlementId: 'river-market',
  locationId: 'market-square',
  copper: 120,
  fatigue: 34.25,
  health: 100,
  inventory: { iron_sword: 1, travel_rations: 2 },
  equipment: { rightHand: 'iron_sword' },
  quests: {
    market_repair: { state: 'active', step: 2, completed: false },
    tavern_intro: { state: 'completed', step: 1, completed: true, rewardClaimed: true },
  },
  perks: ['roadwise'],
  route: ['gate', 'market'],
};
const slots = [
  { savedAt: 100, slotId: 'slot-old', settlementId: 'river-market', copper: 80, fatigue: 20, health: 100, inventory: { iron_sword: 1 }, quests: { market_repair: { state: 'active', step: 1 } } },
  { savedAt: 150, slotId: 'slot-latest', settlementId: 'river-market', copper: 100, fatigue: 30, health: 100, inventory: { iron_sword: 1, travel_rations: 1 }, quests: { market_repair: { state: 'active', step: 1 } } },
];

const first = createSettlementSaveCheckpointPlanner({ currentState, slots });
const second = createSettlementSaveCheckpointPlanner({ currentState, slots });
assert.deepEqual(first, second);
assert.equal(first.canSave, true);
assert.equal(first.latest.slotId, 'slot-latest');
assert.equal(first.delta.copper, 20);
assert.equal(first.delta.questChanges, 1);
assert.equal(first.delta.inventoryChanges, 1);
assert.equal(first.summary.completedQuestCount, 1);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.current), true);
assert.equal(serializeSettlementSaveCheckpoint(first), serializeSettlementSaveCheckpoint(second));

const defeated = createSettlementSaveCheckpointPlanner({ currentState: { health: 0 } });
assert.equal(defeated.canSave, false);
assert.equal(defeated.reason, 'player-defeated');

const disabled = createSettlementSaveCheckpointPlanner({ currentState, canSave: false });
assert.equal(disabled.canSave, false);
assert.equal(disabled.reason, 'save-disabled');

console.log('settlement save checkpoint planner checks passed');
