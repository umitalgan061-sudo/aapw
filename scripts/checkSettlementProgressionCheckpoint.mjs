import assert from 'node:assert/strict';
import { buildSettlementProgressionCheckpoint, stableSettlementProgressionDigest, validateSettlementProgressionCheckpoint, applySettlementProgressionCheckpoint } from '../src/3d/gameplay/settlementProgressionCheckpoint.js';

const base = { settlementId: 'winterhold', insideSettlement: true, state: { currentStage: 'trade', completedStages: ['arrival', 'dialogue'] } };
const first = buildSettlementProgressionCheckpoint(base);
const second = buildSettlementProgressionCheckpoint({ ...base, state: { ...base.state, completedStages: ['dialogue', 'arrival'] } });
assert.equal(first.nextAction, 'trade');
assert.equal(first.stages.find(s => s.id === 'trade').available, true);
assert.equal(validateSettlementProgressionCheckpoint(first).ok, true);
assert.equal(stableSettlementProgressionDigest(first), stableSettlementProgressionDigest(second));
assert.equal(buildSettlementProgressionCheckpoint({ ...base, insideSettlement: false }).gated, 'outside-settlement');
assert.equal(buildSettlementProgressionCheckpoint({ ...base, defeated: true }).nextAction, null);
const target = { events: [], emit(name, payload) { this.events.push({ name, payload }); } };
assert.equal(applySettlementProgressionCheckpoint(target, first).applied, true);
assert.equal(target.events[0].name, 'settlement:progression-checkpoint');
console.log('settlement progression checkpoint regression: ok');
