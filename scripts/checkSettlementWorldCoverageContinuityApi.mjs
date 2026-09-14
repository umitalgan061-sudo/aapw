import { strict as assert } from 'node:assert';
import * as continuity from '../src/3d/gameplay/settlementWorldCoverageContinuity.js';
import * as audit from '../src/3d/gameplay/settlementWorldCoverageContinuityAudit.js';
import * as catalog from '../src/3d/gameplay/settlementWorldCoverageContinuityCatalog.js';
import * as planner from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';

const required = [
  [continuity,'buildSettlementWorldCoverageContinuityContext'],
  [continuity,'planSettlementWorldCoverageTransition'],
  [continuity,'buildSettlementWorldCoverageApproachNodes'],
  [continuity,'createSettlementWorldCoverageContinuitySession'],
  [continuity,'validateSettlementWorldCoverageContinuity'],
  [continuity,'createSettlementWorldCoverageContinuityProof'],
  [audit,'auditSettlementWorldCoverageContinuity'],
  [audit,'buildSettlementWorldCoverageContinuityMatrix'],
  [audit,'validateSettlementWorldCoverageContinuityAudit'],
  [catalog,'getSettlementWorldCoverageContinuityProfile'],
  [catalog,'buildSettlementWorldCoverageContinuityCatalogue'],
  [catalog,'findSettlementWorldCoverageContinuityProfiles'],
  [catalog,'validateSettlementWorldCoverageContinuityCatalogue'],
  [planner,'createSettlementWorldCoverageContinuityPlan'],
  [planner,'createSettlementWorldCoverageContinuityQuickActions'],
  [planner,'verifySettlementWorldCoverageContinuityReplay'],
  [planner,'summarizeSettlementWorldCoverageContinuity'],
];
for (const [module, name] of required) assert.equal(typeof module[name], 'function', `missing export:${name}`);

assert.equal(typeof continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id, 'string');
assert.equal(continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.deterministic, true);
assert.equal(continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.noTerrainMutation, true);
assert.equal(audit.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_AUDIT_API.version, 1);
assert.equal(catalog.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API.generatedProfileCount, 560);
assert.equal(planner.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_PLANNER_API.generatedProfiles, 560);

const apiCounts = {
  services: continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.services.length,
  stages: continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.stages.length,
  gateways: continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.gatewayStates.length,
  contexts: catalog.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API.contextCount,
  profiles: catalog.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API.generatedProfileCount,
};
assert.deepEqual(apiCounts, { services:8, stages:7, gateways:5, contexts:10, profiles:560 });
assert.equal(apiCounts.services * apiCounts.stages * apiCounts.contexts, apiCounts.profiles);

const serviceSet = new Set(continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.services);
assert.equal(serviceSet.size, 8);
assert.ok(serviceSet.has('gate'));
assert.ok(serviceSet.has('market'));
assert.ok(serviceSet.has('tavern'));
assert.ok(serviceSet.has('blacksmith'));
assert.ok(serviceSet.has('farm'));
assert.ok(serviceSet.has('barracks'));
assert.ok(serviceSet.has('stable'));
assert.ok(serviceSet.has('house'));

const stageSet = new Set(continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.stages);
for (const stage of ['far','approach','threshold','inside','service','departure','resume']) assert.ok(stageSet.has(stage));
const gatewaySet = new Set(continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.gatewayStates);
for (const state of ['available','approach-only','blocked','inside','departure-only']) assert.ok(gatewaySet.has(state));

const expectedProfile = catalog.getSettlementWorldCoverageContinuityProfile('market','threshold','north-temperate');
assert.ok(expectedProfile);
assert.equal(expectedProfile.id, 'market:threshold:north-temperate');
assert.equal(expectedProfile.focus, 'trade');
assert.equal(expectedProfile.icon, 'market');
assert.equal(expectedProfile.audio, 'crowd');
assert.ok(expectedProfile.tags.includes('road'));
assert.ok(expectedProfile.density > 0);
assert.ok(expectedProfile.mobileDensity <= expectedProfile.density);

const rows = catalog.findSettlementWorldCoverageContinuityProfiles({ serviceId:'market', stage:'threshold' });
assert.equal(rows.length, 10);
assert.equal(new Set(rows.map((row) => row.context)).size, 10);

const all = catalog.buildSettlementWorldCoverageContinuityCatalogue();
assert.equal(all.length, 560);
assert.equal(new Set(all.map((row) => row.id)).size, 560);
assert.equal(catalog.validateSettlementWorldCoverageContinuityCatalogue().ok, true);

const policy = continuity.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY;
assert.equal(policy.maxApproachNodes, 24);
assert.equal(policy.maxGatewayCandidates, 16);
assert.equal(policy.maxTransitionHistory, 24);
assert.equal(policy.mobileLodScale, 0.62);

const apiObject = Object.freeze({ ...apiCounts, policy: policy.id });
assert.equal(Object.isFrozen(apiObject), true);
assert.equal(typeof audit.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_AUDIT_API.stageCount, 'number');
assert.equal(typeof audit.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_AUDIT_API.gatewayStateCount, 'number');
assert.equal(typeof audit.SETTLEMENT_WORLD_COVERAGE_CONTINUITY_AUDIT_API.serviceCount, 'number');

console.log('Settlement World Coverage Continuity API: PASS');
console.log(JSON.stringify({ ...apiCounts, policy:policy.id }));
