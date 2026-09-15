import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DIRECTOR_SCENARIO_ROLES,
  DIRECTOR_SCENARIO_CONTEXTS,
  DIRECTOR_SCENARIO_POLICY,
  buildScenarioRequest,
  scoreScenarioRequest,
  rankScenarioRequests,
  reserveProtectedScenarioBudget,
  applyScenarioCooldown,
  buildScenarioPlan,
  auditScenarioResult,
  auditScenarioBatch,
  expectedScenarioTier,
  scenarioCartesianDimensions,
  policyFingerprint,
} from '../src/3d/gameplay/livingWorldDirectorScenarioPolicy.js';

const MATRIX = 'artifacts/safak-kartali-living-world-director-matrix-r3.jsonl';
const lines = fs.readFileSync(MATRIX, 'utf8').trim().split(/\r?\n/);
const header = JSON.parse(lines[0]);
const rows = lines.slice(1).map((line) => JSON.parse(line));
const dims = scenarioCartesianDimensions();

assert.equal(header.schema, 'safak-kartali-director-matrix-r3');
assert.equal(header.version, 3);
assert.equal(header.dimensions, dims.total);
assert.equal(header.cases, dims.total);
assert.equal(rows.length, dims.total);
assert.equal(header.policyFingerprint, policyFingerprint());
assert.equal(rows.every((row) => row.policyFingerprint === policyFingerprint()), true);

const seenIds = new Set();
const seenPairs = new Set();
const tierCounts = new Map();
const roleCounts = new Map();
const contextCounts = new Map();
let protectedCount = 0;
let acceptedCount = 0;
let monotonicViolations = 0;

for (const row of rows) {
  assert.equal(DIRECTOR_SCENARIO_ROLES.includes(row.role), true);
  assert.equal(DIRECTOR_SCENARIO_CONTEXTS.includes(row.context), true);
  assert.equal(seenIds.has(row.caseId), false);
  seenIds.add(row.caseId);
  seenPairs.add(`${row.role}|${row.context}`);
  roleCounts.set(row.role, (roleCounts.get(row.role) ?? 0) + 1);
  contextCounts.set(row.context, (contextCounts.get(row.context) ?? 0) + 1);
  const result = scoreScenarioRequest(row.inputs, row.inputs.index);
  const audit = auditScenarioResult(result);
  assert.equal(audit.ok, true);
  assert.equal(result.score, row.expected.score);
  assert.equal(result.accepted, row.expected.accepted);
  assert.equal(result.protected, row.expected.protected);
  assert.equal(result.accepted ? result.tier : 'off', row.expected.tier);
  if (result.accepted) {
    acceptedCount += 1;
    tierCounts.set(result.tier, (tierCounts.get(result.tier) ?? 0) + 1);
    if (result.protected) protectedCount += 1;
  }
}

assert.equal(seenPairs.size, DIRECTOR_SCENARIO_ROLES.length * DIRECTOR_SCENARIO_CONTEXTS.length);
for (const role of DIRECTOR_SCENARIO_ROLES) assert.equal(roleCounts.get(role), dims.contexts * dims.urgencyBands * dims.threatBands * dims.socialBands * dims.scarcityBands);
for (const context of DIRECTOR_SCENARIO_CONTEXTS) assert.equal(contextCounts.get(context), dims.roles * dims.urgencyBands * dims.threatBands * dims.socialBands * dims.scarcityBands);
assert.ok(acceptedCount > rows.length * 0.4);
assert.ok(protectedCount > rows.length * 0.05);
assert.ok((tierCounts.get('critical') ?? 0) > 0);
assert.ok((tierCounts.get('priority') ?? 0) > 0);
assert.ok((tierCounts.get('normal') ?? 0) > 0);
assert.ok((tierCounts.get('deferred') ?? 0) > 0);

for (const role of ['guard', 'merchant', 'healer', 'courier']) {
  const baseline = buildScenarioRequest({ role, context: 'quiet', urgency: 0.1, threat: 0.1, socialNeed: 0.1, scarcity: 0.1, distanceMeters: 100 });
  const escalated = { ...baseline, urgency: 0.92, threat: 0.92, waitingSeconds: 60 };
  const a = scoreScenarioRequest(baseline);
  const b = scoreScenarioRequest(escalated);
  assert.ok(b.score >= a.score);
  assert.equal(b.tier, expectedScenarioTier(b.score));
}

const duplicate = buildScenarioRequest({ role: 'guard', context: 'combat', requestId: 'duplicate-case', urgency: 0.9, threat: 0.9 });
const ranked = rankScenarioRequests([duplicate, { ...duplicate, index: 1 }], { limit: 2 });
const batch = reserveProtectedScenarioBudget(ranked.selected, { limit: 2, protectedSlots: 1 });
assert.equal(auditScenarioBatch(batch).ok, true);
assert.equal(batch.selected.length <= 2, true);

const ledger = new Map();
const firstCooldown = applyScenarioCooldown(batch.selected, ledger, 100, 10);
const secondCooldown = applyScenarioCooldown(batch.selected, ledger, 104, 10);
assert.equal(firstCooldown.accepted.length > 0, true);
assert.equal(secondCooldown.skipped.length >= 0, true);
const plan = buildScenarioPlan([duplicate, { ...duplicate, requestId: 'duplicate-case-b', urgency: 0.85, threat: 0.86 }], { limit: 2, protectedSlots: 1, cooldownLedger: new Map(), nowSeconds: 200, minimumIntervalSeconds: 2 });
assert.equal(plan.policyId, DIRECTOR_SCENARIO_POLICY.id);
assert.ok(plan.selected.length <= 2);

const invalid = scoreScenarioRequest({ role: 'not-a-role', context: 'quiet', urgency: 1 });
assert.equal(invalid.accepted, false);
assert.equal(invalid.tier, 'off');

const dimensionsFingerprint = JSON.stringify({ dims, roles: DIRECTOR_SCENARIO_ROLES, contexts: DIRECTOR_SCENARIO_CONTEXTS, policy: DIRECTOR_SCENARIO_POLICY });
assert.equal(dimensionsFingerprint.includes('deterministic'), true);

console.log(JSON.stringify({
  ok: true,
  rows: rows.length,
  acceptedCount,
  protectedCount,
  tierCounts: Object.fromEntries(tierCounts),
  dimensions: dims,
  policyFingerprint: policyFingerprint(),
  monotonicViolations,
}));
