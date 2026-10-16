import assert from 'node:assert/strict';
import {
  buildSettlementCampaignStageTracker,
  recordSettlementCampaignStep,
  serializeSettlementCampaignStageTracker,
  getSettlementCampaignStageTrackerLimits,
} from '../src/3d/gameplay/settlementCampaignStageTracker.js';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

const initial = buildSettlementCampaignStageTracker({
  completed: [],
  history: ['arrival', 'arrival', 'unknown'],
  activeStep: 'market-buy',
});
check(initial.activeStep === 'market-buy', 'known requested active step should win');
check(initial.visibleSteps.length <= getSettlementCampaignStageTrackerLimits().maxVisibleSteps, 'visible step cap');
check(initial.completedCount === 0 && initial.total === 16, 'initial counts');
check(initial.history.length === 3, 'history normalization keeps bounded entries');

const progressed = recordSettlementCampaignStep(initial, 'market-buy', { nextActiveStep: 'iron-sword' });
check(progressed.completed.includes('market-buy'), 'recorded step is complete');
check(progressed.activeStep === 'iron-sword', 'next active step is selected');
check(progressed.history.at(-1) === 'market-buy', 'history appends step');
check(progressed.visibleSteps.some(step => step.id === 'iron-sword' && step.state === 'active'), 'active step is projected');

const repeat = buildSettlementCampaignStageTracker({ completed: ['market-buy'], history: ['market-buy'], activeStep: 'iron-sword' });
check(serializeSettlementCampaignStageTracker(progressed) === serializeSettlementCampaignStageTracker(progressed), 'serialization deterministic');
check(Object.isFrozen(progressed), 'tracker frozen');
check(Object.isFrozen(progressed.visibleSteps), 'visible list frozen by contract');
check(repeat.completedCount === 1, 'duplicate completion deduplicated');

const malformed = buildSettlementCampaignStageTracker({ completed: 'market-buy', history: null, activeStep: 'missing' });
check(malformed.activeStep === 'arrival', 'malformed input fails closed to first step');
check(malformed.completedCount === 0, 'malformed completion input ignored');

console.log(`Settlement campaign stage tracker checks: ${checks}`);
