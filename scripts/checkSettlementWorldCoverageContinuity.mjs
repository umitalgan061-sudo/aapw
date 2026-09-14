import { strict as assert } from 'node:assert';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY,
  buildSettlementWorldCoverageApproachNodes,
  buildSettlementWorldCoverageContinuityContext,
  createSettlementWorldCoverageContinuityProof,
  createSettlementWorldCoverageContinuitySession,
  planSettlementWorldCoverageTransition,
  validateSettlementWorldCoverageContinuity,
} from '../src/3d/gameplay/settlementWorldCoverageContinuity.js';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES,
  buildSettlementWorldCoverageContinuityCatalogue,
  getSettlementWorldCoverageContinuityProfile,
  validateSettlementWorldCoverageContinuityCatalogue,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityCatalog.js';
import {
  buildSettlementWorldCoverageContinuityMatrix,
  auditSettlementWorldCoverageContinuity,
  validateSettlementWorldCoverageContinuityAudit,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityAudit.js';
import {
  createSettlementWorldCoverageContinuityPlan,
  createSettlementWorldCoverageContinuityQuickActions,
  summarizeSettlementWorldCoverageContinuity,
  verifySettlementWorldCoverageContinuityReplay,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';

const fixtureSettlement = {
  id: 'winterhold',
  regionId: 'north_temperate_forest',
  anchor: { x: 512, y: 18, z: 768 },
  entrance: { x: 520, y: 18, z: 768 },
  services: [...SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES],
};
const fixtureSurface = {
  biome: 'north-temperate',
  layer: 'forest',
  moisture: .68,
  elevationMeters: 312,
  slopeDegrees: 7,
  settlementDistanceMeters: 52,
  roadDistanceMeters: 12,
};
const fixturePlayer = { position: { x: 660, y: 18, z: 768 }, inSettlement: false, settlementOpen: true, health: 95, fatigue: 34, copper: 260 };
const clone = (value) => JSON.parse(JSON.stringify(value));
const frozen = (value, label) => {
  assert(Object.isFrozen(value), `${label} must be frozen`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') frozen(child, `${label}.${key}`);
};

const profileCheck = validateSettlementWorldCoverageContinuityCatalogue();
assert.equal(profileCheck.ok, true, profileCheck.errors.join(','));
assert.equal(profileCheck.count, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API.generatedProfileCount);
assert.equal(profileCheck.count, 8 * 7 * 10);

const catalogue = buildSettlementWorldCoverageContinuityCatalogue();
assert.equal(catalogue.length, 560);
assert.equal(new Set(catalogue.map((row) => row.id)).size, catalogue.length);
for (const service of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES) {
  assert.equal(catalogue.filter((row) => row.serviceId === service).length, 70);
  for (const stage of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES) {
    assert.equal(catalogue.filter((row) => row.serviceId === service && row.stage === stage).length, 10);
  }
}
for (const context of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS) assert.equal(catalogue.filter((row) => row.context === context).length, 56);

const baseContext = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: fixturePlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123, mobile: false });
assert.equal(baseContext.settlement.id, 'winterhold');
assert.equal(baseContext.worldChunkKey, '4:6');
assert.equal(baseContext.stage, 'far');
assert.equal(baseContext.mobile, false);
assert.equal(baseContext.geography.regionId, 'north_temperate_forest');
frozen(baseContext, 'baseContext');

const nearPlayer = { position: { x: 620, y: 18, z: 768 }, inSettlement: false, settlementOpen: true, health: 95, fatigue: 34, copper: 260 };
const nearContext = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: nearPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(nearContext.stage, 'approach');
const thresholdPlayer = { position: { x: 538, y: 18, z: 768 }, inSettlement: false, settlementOpen: true, health: 95, fatigue: 34, copper: 260 };
const thresholdContext = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(thresholdContext.stage, 'threshold');
const insideContext = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: { position: fixtureSettlement.anchor, inSettlement: true, settlementOpen: true, health: 95 }, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(insideContext.stage, 'threshold');
assert.equal(insideContext.inSettlement, true);

const farPlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: fixturePlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(farPlan.transition.gatewayState, 'blocked');
assert.equal(farPlan.transition.canEnter, false);
assert.equal(farPlan.transition.canApproach, false);
assert.equal(farPlan.gatewayCandidates.length, 16);
frozen(farPlan, 'farPlan');

const approachPlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: nearPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(approachPlan.transition.gatewayState, 'approach-only');
assert.equal(approachPlan.transition.canApproach, true);
assert.equal(approachPlan.transition.canEnter, false);

const thresholdPlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(thresholdPlan.transition.gatewayState, 'available');
assert.equal(thresholdPlan.transition.canEnter, true);
assert.equal(thresholdPlan.transition.canApproach, true);

const insidePlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: { position: fixtureSettlement.anchor, inSettlement: true, settlementOpen: true, health: 95 }, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(insidePlan.transition.gatewayState, 'inside');
assert.equal(insidePlan.transition.canExit, true);
assert.equal(insidePlan.transition.primaryService.id, 'gate');

const closedPlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: { ...thresholdPlayer, settlementOpen: false }, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(closedPlan.transition.gatewayState, 'approach-only');
assert.equal(closedPlan.transition.canEnter, false);

const defeatedPlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: { position: fixtureSettlement.anchor, inSettlement: true, settlementOpen: true, health: 0 }, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(defeatedPlan.transition.gatewayState, 'departure-only');
assert.equal(defeatedPlan.transition.canExit, true);
assert.equal(defeatedPlan.transition.canEnter, false);

const waterPlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: thresholdPlayer, surface: { ...fixtureSurface, isWater: true, layer: 'shoreline', waterBody: 'lake' }, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.ok(waterPlan.gatewayCandidates.length > 0);
assert.equal(waterPlan.settlementId, 'winterhold');

const approachNodes = buildSettlementWorldCoverageApproachNodes({ settlement: fixtureSettlement, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123, count: 24 });
assert.equal(approachNodes.length, 24);
assert.equal(new Set(approachNodes.map((node) => node.id)).size, 24);
assert.ok(approachNodes.every((node) => Number.isFinite(node.point.x) && Number.isFinite(node.point.z)));
assert.ok(approachNodes.some((node) => node.stage === 'threshold'));
assert.ok(approachNodes.some((node) => node.stage === 'approach'));
frozen(approachNodes, 'approachNodes');

const replay = verifySettlementWorldCoverageContinuityReplay({ settlement: fixtureSettlement, player: nearPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(replay.ok, true);
assert.equal(replay.firstFingerprint, replay.secondFingerprint);
frozen(replay, 'replay');

const proof = createSettlementWorldCoverageContinuityProof({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(proof.validation.ok, true);
assert.equal(proof.gateway.state, 'available');
assert.equal(proof.approach.count, 24);
assert.ok(proof.fingerprint);
frozen(proof, 'proof');

const audit = auditSettlementWorldCoverageContinuity({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(audit.ok, true);
assert.equal(audit.score, 1);
assert.ok(audit.gateway.candidateCount >= 1);
assert.equal(audit.services.count, 8);
frozen(audit, 'audit');

const auditValidation = validateSettlementWorldCoverageContinuityAudit({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(auditValidation.ok, true, auditValidation.errors.join(','));
assert.equal(auditValidation.matrix.rowCount, 8);
frozen(auditValidation, 'auditValidation');

const planner = createSettlementWorldCoverageContinuityPlan({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(planner.gatewayState, 'available');
assert.equal(planner.stage, 'threshold');
assert.equal(planner.serviceRecommendations.length, 8);
assert.equal(planner.recommendedService.serviceId, 'market');
assert.ok(planner.catalogue.ok);
frozen(planner, 'planner');

const quick = createSettlementWorldCoverageContinuityQuickActions({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 }, 4);
assert.equal(quick.rows.length, 4);
assert.equal(quick.rows[0].serviceId, 'market');
frozen(quick, 'quick');

const summary = summarizeSettlementWorldCoverageContinuity({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(summary.stage, 'threshold');
assert.equal(summary.gatewayState, 'available');
assert.equal(summary.recommendedService, 'market');
frozen(summary, 'summary');

const session = createSettlementWorldCoverageContinuitySession({
  settlement: fixtureSettlement,
  initialPlayer: { ...thresholdPlayer },
  surface: fixtureSurface,
  regionId: fixtureSettlement.regionId,
  seed: 77123,
  now: () => 1700000000000,
  historyLimit: 24,
});
const sessionStart = session.snapshot();
assert.equal(sessionStart.sequence, 0);
assert.equal(sessionStart.player.inSettlement, false);
frozen(sessionStart, 'sessionStart');

const transitionBeforeEnter = session.transition();
assert.equal(transitionBeforeEnter.transition.gatewayState, 'available');
const enter = session.enter();
assert.equal(enter.ok, true);
assert.equal(enter.player.inSettlement, true);
assert.equal(enter.plan.transition.gatewayState, 'inside');

const marketService = session.service('market');
assert.equal(marketService.ok, true);
assert.equal(marketService.service.id, 'market');
const badService = session.service('not-a-service');
assert.equal(badService.ok, false);
assert.equal(badService.reason, 'unknown-service');

const checkpoint = session.checkpoint({ source: 'continuity-test', tag: 'arrival' });
assert.equal(checkpoint.ok, true);
assert.equal(checkpoint.checkpoint.settlementId, 'winterhold');
assert.equal(checkpoint.checkpoint.stage, 'inside');
frozen(checkpoint, 'checkpoint');

const moved = session.move({ position: { x: 735, y: 18, z: 768 }, inSettlement: false, settlementOpen: true, health: 95 });
assert.equal(moved.ok, true);
assert.equal(moved.plan.transition.stage, 'far');
const exitedAfterMove = session.exit();
assert.equal(exitedAfterMove.ok, false);
assert.equal(exitedAfterMove.reason, 'not-inside');

const resumed = session.resume(checkpoint.checkpoint);
assert.equal(resumed.ok, true);
assert.equal(resumed.checkpoint.settlementId, 'winterhold');
frozen(resumed, 'resumed');

const mismatch = session.resume({ ...checkpoint.checkpoint, settlementId: 'elsewhere' });
assert.equal(mismatch.ok, false);
assert.equal(mismatch.reason, 'settlement-mismatch');

const postResumeExit = session.exit();
assert.equal(postResumeExit.ok, true);
assert.equal(postResumeExit.player.inSettlement, false);

const disposed = session.dispose();
assert.equal(disposed, true);
assert.equal(session.dispose(), false);
assert.equal(session.enter().ok, false);
assert.equal(session.enter().reason, 'disposed');

const invalidSettlement = validateSettlementWorldCoverageContinuity({ settlement: {}, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(invalidSettlement.ok, true);

const badChunk = planSettlementWorldCoverageTransition({ settlement: { ...fixtureSettlement, worldChunkKey: 'not-a-chunk' }, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(badChunk.context.worldChunkKey, 'not-a-chunk');
assert.ok(badChunk.digest);

const nullPlayer = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: null, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 0 });
assert.ok(Number.isFinite(nullPlayer.player.x));
assert.ok(Number.isFinite(nullPlayer.player.z));

const nullSurface = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: thresholdPlayer, surface: null, regionId: fixtureSettlement.regionId, seed: 0 });
assert.equal(nullSurface.surface.moisture, .5);
assert.ok(Number.isFinite(nullSurface.surface.elevationMeters));

const mobilePlan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123, mobile: true });
assert.ok(mobilePlan.lod.factor <= 0.62);
assert.ok(mobilePlan.lod.budget < thresholdPlan.lod.budget);

const customRadius = buildSettlementWorldCoverageContinuityContext({ settlement: { ...fixtureSettlement, approachRadius: 90, arrivalRadius: 18 }, player: { ...nearPlayer, position: { x: 590, y: 18, z: 768 } }, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 });
assert.equal(customRadius.stage, 'far');

const routePlan = planSettlementWorldCoverageTransition({ ...{ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 }, routeId: 'river_market' });
assert.equal(routePlan.transition.route.id, 'river_market');

const unknownRoute = planSettlementWorldCoverageTransition({ ...{ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77123 }, routeId: 'unknown-route' });
assert.equal(unknownRoute.transition.route.id, 'unknown-route');
assert.equal(unknownRoute.transition.route.risk, 'unknown');

const generatedContexts = SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.map((context) => createSettlementWorldCoverageContinuityPlan({ settlement: fixtureSettlement, player: thresholdPlayer, surface: { ...fixtureSurface, biome: context, layer: context }, regionId: fixtureSettlement.regionId, context, seed: 991 })).map((plan) => ({ context: plan.context, recommended: plan.recommendedService.serviceId, fingerprint: plan.fingerprint }));
assert.equal(generatedContexts.length, 10);
assert.equal(new Set(generatedContexts.map((row) => row.fingerprint)).size, 10);

const serviceStageRows = [];
for (const service of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SERVICES) {
  for (const stage of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_STAGES) {
    const profile = getSettlementWorldCoverageContinuityProfile(service, stage, 'north-temperate');
    assert.ok(profile);
    assert.equal(profile.serviceId, service);
    assert.equal(profile.stage, stage);
    assert.ok(profile.density >= 0 && profile.density <= 1);
    serviceStageRows.push(profile);
  }
}
assert.equal(serviceStageRows.length, 56);
frozen(serviceStageRows, 'serviceStageRows');

const contextsMatrix = buildSettlementWorldCoverageContinuityMatrix({ settlement: fixtureSettlement, player: thresholdPlayer, initialPlayer: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 12345 });
assert.equal(contextsMatrix.rowCount, 8);
assert.equal(contextsMatrix.rows.filter((row) => row.mode === 'desktop').length, 4);
assert.equal(contextsMatrix.rows.filter((row) => row.mode === 'mobile').length, 4);
assert.ok(contextsMatrix.rows.some((row) => row.gatewayState === 'available'));
assert.ok(contextsMatrix.rows.some((row) => row.gatewayState === 'inside'));

const catalogApi = SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CATALOG_API;
assert.equal(catalogApi.serviceCount, 8);
assert.equal(catalogApi.stageCount, 7);
assert.equal(catalogApi.contextCount, 10);
assert.equal(catalogApi.generatedProfileCount, 560);

assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.services.length, 8);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.stages.length, 7);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.gatewayStates.length, 5);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.deterministic, true);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.noTerrainMutation, true);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.noRoadMutation, true);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.noModelAttachment, true);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.approachRadiusMeters, 150);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.arrivalRadiusMeters, 36);

const edgePositions = [
  ['exact-anchor', { x: 512, y: 18, z: 768 }, true],
  ['just-outside-threshold', { x: 549, y: 18, z: 768 }, false],
  ['just-inside-threshold', { x: 547, y: 18, z: 768 }, false],
  ['approach-middle', { x: 600, y: 18, z: 768 }, false],
  ['far-east', { x: 700, y: 18, z: 768 }, false],
  ['far-west', { x: 300, y: 18, z: 768 }, false],
  ['far-north', { x: 512, y: 18, z: 400 }, false],
  ['far-south', { x: 512, y: 18, z: 1100 }, false],
  ['chunk-edge-x', { x: 511.9, y: 18, z: 768 }, false],
  ['chunk-edge-z', { x: 512, y: 18, z: 767.9 }, false],
];
for (const [id, position, inSettlement] of edgePositions) {
  const result = buildSettlementWorldCoverageContinuityContext({ settlement: fixtureSettlement, player: { position, inSettlement }, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 222 });
  assert.ok(['far', 'approach', 'threshold'].includes(result.stage));
  assert.equal(typeof result.lod, 'number');
  assert.equal(Number.isFinite(result.lod), true);
}

const deterministicSeeds = [0, 1, 2, 13, 99, 77123, 4294967295];
for (const seed of deterministicSeeds) {
  const a = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed });
  const b = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed });
  assert.equal(a.digest, b.digest, `digest mismatch for seed ${seed}`);
  assert.deepEqual(a.gatewayCandidates, b.gatewayCandidates, `gateway mismatch for seed ${seed}`);
}

const malformed = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: { position: { x: 'NaN', y: 'Infinity', z: null }, inSettlement: false }, surface: { elevationMeters: 'Infinity', slopeDegrees: 'NaN' }, regionId: fixtureSettlement.regionId, seed: 'not-number' });
assert.ok(Number.isFinite(malformed.context.player.x));
assert.ok(Number.isFinite(malformed.context.player.y));
assert.ok(Number.isFinite(malformed.context.player.z));
assert.ok(Number.isFinite(malformed.context.surface.elevationMeters));
assert.ok(Number.isFinite(malformed.context.surface.slopeDegrees));

const gatewayCountCaps = [1, 2, 4, 8, 16, 32, 99];
for (const count of gatewayCountCaps) {
  const plan = planSettlementWorldCoverageTransition({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 77, gatewayCandidateCount: count });
  assert.ok(plan.gatewayCandidates.length >= 1);
  assert.ok(plan.gatewayCandidates.length <= 16);
}

const approachCountCaps = [1, 2, 8, 12, 24, 36, 99];
for (const count of approachCountCaps) {
  const nodes = buildSettlementWorldCoverageApproachNodes({ settlement: fixtureSettlement, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 66, count });
  assert.ok(nodes.length >= 1);
  assert.ok(nodes.length <= 24);
}

const sessionHistory = createSettlementWorldCoverageContinuitySession({ settlement: fixtureSettlement, initialPlayer: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 7, historyLimit: 5, now: () => 17 });
for (let i = 0; i < 20; i += 1) sessionHistory.move({ position: { x: 548 - i, y: 18, z: 768 }, inSettlement: i < 4 });
const bounded = sessionHistory.snapshot();
assert.equal(bounded.history.length, 5);
assert.ok(bounded.history.every((row) => row.sequence > 0));
frozen(bounded, 'bounded');

const checkpointMalformed = sessionHistory.resume({ settlementId: fixtureSettlement.id, stage: 'invalid', gatewayState: 'invalid', sequence: 'NaN' });
assert.equal(checkpointMalformed.ok, false);
assert.equal(checkpointMalformed.reason, 'invalid-stage');

const plannerMobile = createSettlementWorldCoverageContinuityPlan({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 999, mobile: true });
const plannerDesktop = createSettlementWorldCoverageContinuityPlan({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, seed: 999, mobile: false });
assert.ok(plannerMobile.lod.factor < plannerDesktop.lod.factor);
assert.ok(plannerMobile.lod.budget < plannerDesktop.lod.budget);

for (const context of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS) {
  const plan = createSettlementWorldCoverageContinuityPlan({ settlement: fixtureSettlement, player: thresholdPlayer, surface: fixtureSurface, regionId: fixtureSettlement.regionId, context, seed: 4567 });
  assert.equal(plan.context, context);
  assert.ok(plan.catalogue.count === 560);
  assert.ok(plan.recommendedService);
  assert.ok(plan.serviceRecommendations.every((row) => row.score >= 0 && row.score <= 1));
}

console.log('Settlement World Coverage Continuity: PASS');
console.log(JSON.stringify({
  policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id,
  catalogueProfiles: catalogue.length,
  services: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.services.length,
  stages: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.stages.length,
  contexts: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_CONTEXTS.length,
  gatewayStates: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.gatewayStates.length,
  proofFingerprint: proof.fingerprint,
  plannerFingerprint: planner.fingerprint,
  auditFingerprint: audit.fingerprint,
  sessionSequence: bounded.sequence,
}));
