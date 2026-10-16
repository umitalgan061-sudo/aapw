import assert from 'node:assert/strict';
import {
  createSettlementQuestProgressModel,
  summarizeSettlementQuestProgress,
} from '../src/3d/gameplay/settlementQuestProgressModel.js';

const input = {
  snapshot: { player: { copper: 100, inventory: { iron_ore: 4, coal: 2 } } },
  activeChainId: 'iron_and_oath',
  completedStepIds: ['iron-01', 'iron-01'],
};
const first = createSettlementQuestProgressModel(input);
const second = createSettlementQuestProgressModel(input);
assert.deepEqual(first, second, 'projection must be deterministic');
assert.equal(first.activeChainId, 'iron_and_oath');
assert.equal(first.activeStepId, 'iron-02');
assert.equal(first.activeAction, 'talk');
assert.equal(first.chains.length, 6);
assert.equal(first.chains[0].completedSteps, 1);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.chains), true);
assert.equal(summarizeSettlementQuestProgress(first).totalSteps, 48);
assert.equal(summarizeSettlementQuestProgress(first).completedSteps, 1);

const evaluated = createSettlementQuestProgressModel({
  ...input,
  ruleEvaluator: () => ({ ok: true }),
});
assert.equal(evaluated.evaluation?.ready, true);

const fallback = createSettlementQuestProgressModel({ activeChainId: 'unknown' });
assert.equal(fallback.activeChainId, 'iron_and_oath');
assert.equal(fallback.activeStepId, 'iron-01');

console.log('[checkSettlementQuestProgressModel] PASS');
