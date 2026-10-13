import assert from 'node:assert/strict';
import { createSettlementQuestJournalProjection, isSettlementQuestJournalProjection } from '../src/3d/gameplay/settlementQuestJournalProjection.ts';

const input = {
  settlementId: 'dragonstone-watch',
  quests: [
    { id: 'b', title: 'B', status: 'active', objectives: [{ id: 'z', progress: 2, target: 2 }, { id: 'a', progress: 1, target: 3 }] },
    { id: 'a', title: 'A', status: 'completed', objectives: [] },
    { id: 'bad', state: 'mystery', objectives: [{ label: 'Unstarted', current: 'nope', required: 4 }] },
  ],
};
const before = structuredClone(input);
const projection = createSettlementQuestJournalProjection(input);
assert.equal(isSettlementQuestJournalProjection(projection), true);
assert.deepEqual(projection.quests.map((quest) => quest.id), ['a', 'b', 'bad']);
assert.deepEqual(projection.quests[1].objectives.map((objective) => objective.id), ['a', 'z']);
assert.equal(projection.quests[1].completedCount, 1);
assert.equal(projection.readyToTurnInCount, 0);
assert.equal(Object.isFrozen(projection), true);
assert.equal(Object.isFrozen(projection.quests[1].objectives[0]), true);
assert.deepEqual(input, before);

const replay = createSettlementQuestJournalProjection({ ...input, quests: [...input.quests].reverse() });
assert.equal(replay.signature, projection.signature);
assert.equal(replay.failClosed, false);

const empty = createSettlementQuestJournalProjection({ settlementId: 'x', quests: [] });
assert.equal(empty.failClosed, true);
assert.equal(empty.activeCount, 0);
assert.equal(empty.signature, '');

console.log('settlement quest journal projection proof: PASS');
