import assert from 'node:assert/strict';
import {
  buildDirectorScenarioRequests,
  buildDirectorScenarioPlan,
  summarizeDirectorPlan,
  directorScenarioEvidence,
  auditDirectorScenarioEvidence,
} from '../src/3d/gameplay/livingWorldDirectorScenarioBridge.js';
import { DIRECTOR_SCENARIO_POLICY } from '../src/3d/gameplay/livingWorldDirectorScenarioPolicy.js';

function actor(id, state, x, z, extra = {}) {
  return {
    id,
    state,
    fatigue: extra.fatigue ?? 0.1,
    staminaDebt: extra.staminaDebt ?? 0,
    object3D: { name: id, position: { x, z }, userData: {} },
  };
}

const snapshot = {
  npcs: [
    actor('guard-a', 'patrol', 0, 0),
    actor('guard-b', 'chase', 6, 4, { fatigue: 0.05 }),
    actor('healer-a', 'rest', 12, 3),
  ],
  animals: [
    actor('wolf-a', 'flee', 24, 18),
    actor('deer-a', 'forage', 40, 20),
  ],
  creatures: [actor('scout-a', 'watch', 100, 70)],
  dragons: [actor('dragon-a', 'alert', 300, 160)],
};

const context = {
  playerPosition: { x: 0, z: 0 },
  threatLevel: 0.88,
  danger: 0.82,
  urgency: 0.62,
  scarcity: 0.55,
  socialNeed: 0.40,
  travelRisk: 0.72,
};

const requests = buildDirectorScenarioRequests(snapshot, context);
assert.equal(requests.length, 7);
assert.equal(new Set(requests.map((request) => request.requestId)).size, 7);
assert.equal(requests[0].context, 'day');
assert.equal(requests[1].context, 'combat');
assert.ok(requests.every((request) => Object.isFrozen(request)));

const ledger = new Map();
const planA = buildDirectorScenarioPlan(snapshot, context, { limit: 6, protectedSlots: 2, cooldownLedger: ledger, nowSeconds: 120, minimumIntervalSeconds: 3 });
assert.equal(planA.policyId, DIRECTOR_SCENARIO_POLICY.id);
assert.equal(planA.audit.ok, true);
assert.ok(planA.selected.length <= 6);
assert.ok(planA.deferred.length >= 1);
assert.ok(planA.digest);

const summaryA = summarizeDirectorPlan(planA);
assert.equal(summaryA.selectedCount, planA.selected.length);
assert.equal(summaryA.deferredCount, planA.deferred.length);
assert.equal(summaryA.auditOk, true);
assert.equal(summaryA.tierCounts.critical + summaryA.tierCounts.priority + summaryA.tierCounts.normal + summaryA.tierCounts.deferred, summaryA.selectedCount);

const evidence = directorScenarioEvidence(snapshot, context, { limit: 6, protectedSlots: 2, cooldownLedger: new Map(), nowSeconds: 120 });
const evidenceAudit = auditDirectorScenarioEvidence(evidence);
assert.equal(evidenceAudit.ok, true);
assert.equal(evidence.summary.selectedCount, evidence.plan.selected.length);
assert.equal(evidence.summary.digest, evidence.plan.digest);

const replay = directorScenarioEvidence(snapshot, context, { limit: 6, protectedSlots: 2, cooldownLedger: new Map(), nowSeconds: 120 });
assert.equal(evidence.fingerprint, replay.fingerprint);
assert.deepEqual(evidence.plan, replay.plan);

const cooldownPlan = buildDirectorScenarioPlan(snapshot, context, { limit: 6, protectedSlots: 2, cooldownLedger: ledger, nowSeconds: 121, minimumIntervalSeconds: 3 });
assert.ok(cooldownPlan.skipped.length >= 0);
assert.equal(cooldownPlan.audit.ok, true);

const empty = buildDirectorScenarioPlan({}, { playerPosition: { x: 0, z: 0 } }, { limit: 4 });
assert.equal(empty.requestCount, 0);
assert.equal(empty.selected.length, 0);
assert.equal(empty.deferred.length, 0);
assert.equal(empty.audit.ok, true);

const invalidEvidence = auditDirectorScenarioEvidence({ schema: 'wrong', summary: {}, plan: {} });
assert.equal(invalidEvidence.ok, false);
assert.ok(invalidEvidence.errors.includes('schema'));

console.log(JSON.stringify({
  ok: true,
  policy: DIRECTOR_SCENARIO_POLICY.id,
  requests: requests.length,
  selected: summaryA.selectedCount,
  deferred: summaryA.deferredCount,
  skippedOnSecondPass: cooldownPlan.skipped.length,
  evidenceFingerprint: evidence.fingerprint,
}));
