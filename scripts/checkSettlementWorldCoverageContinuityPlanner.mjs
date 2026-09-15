import { strict as assert } from 'node:assert';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_PLANNER_API,
  createSettlementWorldCoverageContinuityPlan,
  createSettlementWorldCoverageContinuityQuickActions,
  summarizeSettlementWorldCoverageContinuity,
  verifySettlementWorldCoverageContinuityReplay,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';
import { validateSettlementWorldCoverageContinuityCatalogue } from '../src/3d/gameplay/settlementWorldCoverageContinuityCatalog.js';

const settlement = {
  id: 'winterhold', regionId: 'north_temperate_forest',
  anchor: { x: 512, y: 18, z: 768 }, entrance: { x: 520, y: 18, z: 768 },
  services: ['gate','market','tavern','blacksmith','farm','barracks','stable','house'],
};
const surface = { biome: 'north-temperate', layer: 'forest', moisture: .65, elevationMeters: 320, slopeDegrees: 6 };
const clone = (value) => JSON.parse(JSON.stringify(value));
const frozen = (value, label) => {
  assert(Object.isFrozen(value), `${label} not frozen`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') frozen(child, `${label}.${key}`);
};

assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_PLANNER_API.version, 1);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_PLANNER_API.generatedProfiles, 560);
assert.equal(validateSettlementWorldCoverageContinuityCatalogue().ok, true);

const thresholdPlayer = { position: { x: 538, y: 18, z: 768 }, inSettlement: false, settlementOpen: true, health: 96, fatigue: 30, copper: 240 };
const threshold = createSettlementWorldCoverageContinuityPlan({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 1001, mobile: false });
assert.equal(threshold.stage, 'threshold');
assert.equal(threshold.gatewayState, 'available');
assert.equal(threshold.gateway.canEnter, true);
assert.equal(threshold.serviceRecommendations.length, 8);
assert.equal(threshold.recommendedService.serviceId, 'market');
assert.ok(threshold.recommendedService.score >= 0 && threshold.recommendedService.score <= 1);
assert.ok(threshold.serviceRecommendations.every((row) => row.tags.length > 0));
assert.ok(threshold.serviceRecommendations.every((row) => row.score >= 0 && row.score <= 1));
frozen(threshold, 'threshold');

const quick = createSettlementWorldCoverageContinuityQuickActions({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 1001 }, 4);
assert.equal(quick.rows.length, 4);
assert.equal(quick.rows[0].serviceId, 'market');
assert.deepEqual(quick.rows.map((row) => row.rank), [1,2,3,4]);
frozen(quick, 'quick');

const summary = summarizeSettlementWorldCoverageContinuity({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 1001 });
assert.equal(summary.stage, 'threshold');
assert.equal(summary.gatewayState, 'available');
assert.equal(summary.recommendedService, 'market');
assert.equal(summary.recommendedIntent, 'talk');
assert.equal(typeof summary.lod, 'number');
frozen(summary, 'summary');

const replay = verifySettlementWorldCoverageContinuityReplay({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 1001 });
assert.equal(replay.ok, true);
assert.equal(replay.firstFingerprint, replay.secondFingerprint);
frozen(replay, 'replay');

const mobile = createSettlementWorldCoverageContinuityPlan({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 1001, mobile: true });
assert.ok(mobile.lod.factor < threshold.lod.factor);
assert.ok(mobile.lod.budget < threshold.lod.budget);
assert.ok(mobile.serviceRecommendations[0].density <= threshold.serviceRecommendations[0].density);

const tired = createSettlementWorldCoverageContinuityPlan({
  settlement, player: { ...thresholdPlayer, fatigue: 88 }, surface, regionId: settlement.regionId, seed: 1001,
});
assert.ok(['tavern','market','house','gate','blacksmith','barracks','stable','farm'].includes(tired.recommendedService.serviceId));
assert.equal(tired.serviceRecommendations.length, 8);
assert.equal(new Set(tired.serviceRecommendations.map((row) => row.serviceId)).size, 8);

const wealthy = createSettlementWorldCoverageContinuityPlan({
  settlement, player: { ...thresholdPlayer, copper: 5000, inSettlement: true }, surface, regionId: settlement.regionId, seed: 1001,
});
assert.equal(wealthy.gatewayState, 'inside');
assert.equal(wealthy.gateway.canExit, true);
assert.ok(wealthy.serviceRecommendations.some((row) => row.serviceId === 'market'));

const poor = createSettlementWorldCoverageContinuityPlan({
  settlement, player: { ...thresholdPlayer, copper: 0, inSettlement: true }, surface, regionId: settlement.regionId, seed: 1001,
});
assert.equal(poor.gatewayState, 'inside');
assert.ok(poor.serviceRecommendations[0].score >= 0);

const shore = createSettlementWorldCoverageContinuityPlan({
  settlement, player: thresholdPlayer, surface: { ...surface, biome: 'river', layer: 'shoreline', isWater: true }, regionId: settlement.regionId, seed: 1002,
});
assert.equal(shore.context, 'shoreline');
assert.equal(shore.catalogue.count, 560);
assert.ok(shore.serviceRecommendations.every((row) => row.density >= 0));

const mountain = createSettlementWorldCoverageContinuityPlan({
  settlement, player: thresholdPlayer, surface: { ...surface, biome: 'mountain-cold', layer: 'alpine', elevationMeters: 1500 }, regionId: settlement.regionId, seed: 1003,
});
assert.equal(mountain.context, 'mountain-pass');
assert.equal(mountain.catalogue.ok, true);

const allContexts = ['north-cold','north-temperate','north-river','north-moor','mountain-cold','mountain-pass','river-lowland','forest-edge','woodland','shoreline'];
const contextPlans = allContexts.map((context) => createSettlementWorldCoverageContinuityPlan({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 456, context }));
assert.equal(contextPlans.length, 10);
assert.equal(new Set(contextPlans.map((plan) => plan.context)).size, 10);
assert.equal(new Set(contextPlans.map((plan) => plan.fingerprint)).size, 10);
assert.ok(contextPlans.every((plan) => plan.catalogue.count === 560));
assert.ok(contextPlans.every((plan) => plan.serviceRecommendations.length === 8));

const stagePositions = [
  { name:'far', x:760 }, { name:'approach', x:640 }, { name:'threshold', x:538 },
];
for (const row of stagePositions) {
  const plan = createSettlementWorldCoverageContinuityPlan({
    settlement, player: { ...thresholdPlayer, position: { x: row.x, y: 18, z: 768 } }, surface, regionId: settlement.regionId, seed: 909,
  });
  assert.equal(plan.stage, row.name);
  assert.ok(plan.lod.factor >= 0 && plan.lod.factor <= 1);
  assert.ok(plan.lod.budget > 0);
  assert.ok(plan.approach.count > 0);
}

const boundedQuick = createSettlementWorldCoverageContinuityQuickActions({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 9 }, 99);
assert.ok(boundedQuick.rows.length <= 8);
assert.ok(boundedQuick.rows.length >= 1);
const tinyQuick = createSettlementWorldCoverageContinuityQuickActions({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed: 9 }, 0);
assert.equal(tinyQuick.rows.length, 1);

const malformed = createSettlementWorldCoverageContinuityPlan({
  settlement: clone(settlement),
  player: { position: { x:'NaN', y:'Infinity', z:null }, inSettlement:false, health:'NaN', fatigue:'Infinity', copper:'NaN' },
  surface: { moisture:'Infinity', elevationMeters:'NaN', slopeDegrees:'Infinity' },
  regionId: settlement.regionId,
  seed: 'bad-seed',
});
assert.ok(Number.isFinite(malformed.lod.factor));
assert.ok(Number.isFinite(malformed.lod.budget));
assert.ok(malformed.serviceRecommendations.every((row) => Number.isFinite(row.score)));

for (const seed of [0,1,7,99,1001,4294967295]) {
  const a = createSettlementWorldCoverageContinuityPlan({ settlement, player: thresholdPlayer, surface, regionId: settlement.regionId, seed });
  const b = createSettlementWorldCoverageContinuityPlan({ settlement: clone(settlement), player: clone(thresholdPlayer), surface: clone(surface), regionId: settlement.regionId, seed });
  assert.equal(a.fingerprint, b.fingerprint, `planner replay failed:${seed}`);
  assert.deepEqual(a.gateway, b.gateway);
  assert.deepEqual(a.serviceRecommendations, b.serviceRecommendations);
}

console.log('Settlement World Coverage Continuity Planner: PASS');
console.log(JSON.stringify({
  threshold: threshold.fingerprint,
  replay: replay.firstFingerprint,
  mobile: mobile.fingerprint,
  contexts: contextPlans.map((plan) => plan.context),
  recommendation: threshold.recommendedService.serviceId,
  generatedProfiles: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_PLANNER_API.generatedProfiles,
}));
