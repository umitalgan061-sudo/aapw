import assert from 'node:assert/strict';
import {
  LIVING_WORLD_SCENARIO_POLICY,
  canScenarioUseActor,
  classifyLivingWorldGeographicContext,
  deterministicScenarioDigest,
  proposeLivingWorldScenarios,
  scenarioRuntimeBudget,
  validateLivingWorldScenarioAnchor,
} from '../src/3d/gameplay/livingWorldGeographicScenarioDirector.js';

const reach = classifyLivingWorldGeographicContext({
  worldX: -9000,
  worldZ: 1000,
  role: 'farmer',
  groundHeight: 40,
  slopeDegrees: 4,
  waterDepth: 0,
  settlementDistance: 40,
  roadDistance: 12,
  moisture: 0.45,
  seed: 77,
});
const reachAgain = classifyLivingWorldGeographicContext({
  worldX: -9000,
  worldZ: 1000,
  role: 'farmer',
  groundHeight: 40,
  slopeDegrees: 4,
  waterDepth: 0,
  settlementDistance: 40,
  roadDistance: 12,
  moisture: 0.45,
  seed: 77,
});
assert.deepEqual(reach, reachAgain);
assert.equal(reach.slopeDegrees, 4);
assert.equal(reach.waterDepth, 0);

const proposal = proposeLivingWorldScenarios({ context: reach, maxScenarios: 4 });
const proposalAgain = proposeLivingWorldScenarios({ context: reachAgain, maxScenarios: 4 });
assert.deepEqual(proposal, proposalAgain);
assert.ok(proposal.scenarios.length > 0);
assert.ok(proposal.scenarios.length <= 4);
assert.equal(deterministicScenarioDigest(proposal), deterministicScenarioDigest(proposalAgain));

const anchor = validateLivingWorldScenarioAnchor({
  position: { x: 0, z: 0 },
  role: 'guard',
  slopeDegrees: 5,
  waterDepth: 0,
  groundHeight: 10,
  settlementSeats: [{ x: 35, z: 0 }],
  roadEdges: [{ points: [{ x: 0, z: -50 }, { x: 0, z: 50 }] }],
  seed: 9,
});
assert.equal(anchor.ok, true);
assert.ok(anchor.distances.roadDistance < 1);
assert.ok(anchor.distances.settlementDistance > 30);

const invalid = validateLivingWorldScenarioAnchor({ position: { x: NaN, z: 0 } });
assert.equal(invalid.ok, false);
assert.equal(invalid.reason, 'invalid-position');

const actor = { region: proposal.region, speciesId: null, settlementDistance: 40, roadDistance: 12 };
assert.ok(proposal.scenarios.every((scenario) => canScenarioUseActor({ scenario, actorContext: actor })));
assert.equal(canScenarioUseActor({ scenario: { region: 'snow', type: 'winter-patrol' }, actorContext: actor }), false);

const budgetDesktop = scenarioRuntimeBudget({ activeActors: 220, visibleActors: 90, mobile: false });
const budgetMobile = scenarioRuntimeBudget({ activeActors: 220, visibleActors: 90, mobile: true });
assert.ok(budgetMobile.recommendedScenarioEvaluations <= budgetDesktop.recommendedScenarioEvaluations);
assert.ok(budgetDesktop.recommendedScenarioEvaluations <= LIVING_WORLD_SCENARIO_POLICY.maximumScenarioOptions);
assert.ok(budgetMobile.staggerSeconds >= budgetDesktop.staggerSeconds);

const snow = proposeLivingWorldScenarios({
  worldX: -25000,
  worldZ: -14000,
  role: 'guard',
  groundHeight: 70,
  slopeDegrees: 7,
  waterDepth: 0,
  settlementDistance: 500,
  roadDistance: 16,
  seed: 1234,
});
assert.ok(snow.ok || snow.scenarios.length === 0);

console.log(JSON.stringify({
  ok: true,
  policy: LIVING_WORLD_SCENARIO_POLICY.id,
  reachRegion: reach.region,
  scenarioCount: proposal.scenarios.length,
  desktopBudget: budgetDesktop.recommendedScenarioEvaluations,
  mobileBudget: budgetMobile.recommendedScenarioEvaluations,
}));
console.log('LIVING_WORLD_GEOGRAPHIC_SCENARIO_DIRECTOR_PASS');
