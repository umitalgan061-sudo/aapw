import assert from 'node:assert/strict';
import { scoreDirectorRequest, buildDirectorPlan, decisionDigest, auditPriorityBatch } from '../src/3d/gameplay/livingWorldDirectorPriorityPolicy.js';

const roles = ['guard','watcher','merchant','caravan','farmer','hunter','herbalist','healer','blacksmith','miner','scout','courier','fisher','shepherd','forester','innkeeper','watchcaptain','quartermaster','ferryman','guide'];
const contexts = ['quiet','day','night','rain','storm','snow','festival','market','harvest','scarcity','fire','combat'];
const requests = [];
for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
    const role = roles[roleIndex];
    const context = contexts[contextIndex];
    const urgency = ((roleIndex * 7 + contextIndex * 3) % 10) / 10;
    const threat = ((roleIndex * 5 + contextIndex * 11) % 10) / 10;
    const socialNeed = ((roleIndex * 13 + contextIndex * 2) % 10) / 10;
    const fatigue = ((roleIndex * 3 + contextIndex * 7) % 10) / 10;
    const scarcity = ((roleIndex * 11 + contextIndex * 5) % 10) / 10;
    const travelRisk = ((roleIndex * 17 + contextIndex * 19) % 10) / 10;
    requests.push({ role, context, urgency, threat, socialNeed, fatigue, scarcity, travelRisk, distanceMeters: (roleIndex + 1) * (contextIndex + 1) * 17, requestId: `matrix-e-${role}-${context}` });
  }
}

const decisions = requests.map((request, index) => scoreDirectorRequest(request, index));
assert.equal(decisions.length, 240);
assert.equal(decisions.filter((decision) => decision.accepted).length, 240);
for (const decision of decisions) {
  assert.ok(decision.score >= 0 && decision.score <= 1);
  assert.ok(decision.reasons.length >= 1);
  assert.equal(decision.request.role.length > 0, true);
}

const protectedRequests = requests.map((request, index) => ({ ...request, requestId: `protected-e-${index}`, urgency: index % 2 ? 0.99 : request.urgency, threat: index % 3 ? request.threat : 0.95 }));
const plan = buildDirectorPlan(protectedRequests, { budget: 24, reservedProtected: 8, nowSeconds: 120 });
assert.equal(plan.policyId, 'living-world-director-priority-policy-2026-09-15-v1');
assert.ok(plan.selected.length <= 24);
assert.ok(plan.selected.length > 0);
assert.equal(auditPriorityBatch(plan).ok, true);
assert.equal(decisionDigest(plan.selected), plan.digest);

const secondPlan = buildDirectorPlan(protectedRequests, { budget: 24, reservedProtected: 8, nowSeconds: 120 });
assert.equal(secondPlan.digest, plan.digest);
assert.deepEqual(secondPlan.selected.map((d) => d.request.requestId), plan.selected.map((d) => d.request.requestId));

const unknown = scoreDirectorRequest({ role: 'missing-role', context: 'combat', requestId: 'matrix-e-unknown' });
assert.equal(unknown.accepted, false);

const disabled = scoreDirectorRequest({ role: 'guard', context: 'combat', enabled: false, requestId: 'matrix-e-disabled' });
assert.equal(disabled.accepted, false);

console.log(JSON.stringify({ ok: true, scenarios: requests.length, selected: plan.selected.length, deferred: plan.deferred.length, digest: plan.digest }));
