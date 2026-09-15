import { strict as assert } from 'node:assert';
import { buildSettlementMilestoneBoard, serializeSettlementMilestoneBoard, validateSettlementMilestoneBoard } from '../src/3d/gameplay/settlementMilestoneBoard.js';

const snapshot = { settlementId: 'north-settlement', locationId: 'north-settlement', health: 92, copper: 240 };
const input = {
  milestones: [
    { id: 'arrival', label: 'Yerleşime gir', kind: 'travel', status: 'complete', progress: 1, action: 'review', rewardCopper: 4, rewardXp: 12 },
    { id: 'supply', label: 'Han görevi', kind: 'quest', status: 'active', progress: 0.5, action: 'advanceQuest', questId: 'settlement-supply', serviceId: 'tavern', rewardCopper: 8, rewardXp: 20 },
    { id: 'forge', label: 'Kılıcı tamamla', kind: 'craft', status: 'available', progress: 0, action: 'craft', serviceId: 'blacksmith', rewardCopper: 0, rewardXp: 18 },
    { id: 'market', label: 'Pazar kilidi', kind: 'trade', status: 'locked', progress: 0, action: 'trade' }
  ],
  history: [
    { id: 'h2', type: 'quest', milestoneId: 'supply', ok: true, sequence: 2, timestamp: 20 },
    { id: 'h1', type: 'travel', milestoneId: 'arrival', ok: true, sequence: 1, timestamp: 10 }
  ]
};

const first = buildSettlementMilestoneBoard(snapshot, input);
const second = buildSettlementMilestoneBoard(snapshot, input);
assert.deepEqual(first, second, 'deterministic');
assert.equal(first.primaryMilestoneId, 'supply');
assert.equal(first.counts.active, 1);
assert.equal(first.counts.complete, 1);
assert.equal(first.rewardPreview.copper, 4);
assert.equal(first.rewardPreview.xp, 12);
assert.equal(first.history[0].id, 'h1');
assert.ok(Object.isFrozen(first) && Object.isFrozen(first.milestones[0]));
assert.ok(validateSettlementMilestoneBoard(first).ok);
assert.equal(serializeSettlementMilestoneBoard(first), serializeSettlementMilestoneBoard(second));

const malformed = buildSettlementMilestoneBoard({ health: 'bad', copper: Infinity }, { milestones: [{ id: null, progress: NaN, rewardXp: Infinity }] });
assert.equal(malformed.defeated, false);
assert.equal(malformed.copper, 0);
assert.ok(validateSettlementMilestoneBoard(malformed).ok);

console.log(`SETTLEMENT_MILESTONE_BOARD_OK milestones=${first.counts.total} history=${first.history.length}`);
