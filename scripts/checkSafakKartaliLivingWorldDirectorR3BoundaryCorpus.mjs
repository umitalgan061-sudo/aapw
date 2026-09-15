import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  DIRECTOR_SCENARIO_ROLES,
  DIRECTOR_SCENARIO_CONTEXTS,
  scoreScenarioRequest,
} from '../src/3d/gameplay/livingWorldDirectorScenarioPolicy.js';

const ROOT = 'artifacts';
const FILES = [
  'living-world-director-r3-boundary-corpus-01.jsonl',
  'living-world-director-r3-boundary-corpus-02.jsonl',
  'living-world-director-r3-boundary-corpus-03.jsonl',
  'living-world-director-r3-boundary-corpus-04.jsonl',
  'living-world-director-r3-boundary-corpus-05.jsonl',
  'living-world-director-r3-boundary-corpus-06.jsonl',
  'living-world-director-r3-boundary-corpus-07.jsonl',
];
const EXPECTED_ROWS = 3328;
const BANDS = [0.05, 0.30, 0.65, 0.92];
const SOCIAL = [0.10, 0.35, 0.70, 0.95];
const SCARCITY = [0.05, 0.40, 0.72, 0.96];
const rows = [];

function fail(message) {
  throw new Error(`[r3-boundary-corpus] ${message}`);
}

function decode(raw, fileIndex, lineIndex) {
  const value = JSON.parse(raw);
  if (Array.isArray(value)) {
    assert.equal(value.length, 3, `array row ${fileIndex}:${lineIndex} must have [role,context,variant]`);
    return { roleIndex: value[0], contextIndex: value[1], variant: value[2] };
  }
  const roleIndex = DIRECTOR_SCENARIO_ROLES.indexOf(value.r);
  const contextIndex = DIRECTOR_SCENARIO_CONTEXTS.indexOf(value.c);
  return { roleIndex, contextIndex, variant: value.v };
}

for (let fileIndex = 0; fileIndex < FILES.length; fileIndex += 1) {
  const file = FILES[fileIndex];
  const lines = fs.readFileSync(`${ROOT}/${file}`, 'utf8').split(/\r?\n/).filter(Boolean);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const decoded = decode(lines[lineIndex], fileIndex, lineIndex);
    if (!Number.isInteger(decoded.roleIndex) || decoded.roleIndex < 0 || decoded.roleIndex >= DIRECTOR_SCENARIO_ROLES.length) {
      fail(`invalid role index at ${file}:${lineIndex + 1}`);
    }
    if (!Number.isInteger(decoded.contextIndex) || decoded.contextIndex < 0 || decoded.contextIndex >= DIRECTOR_SCENARIO_CONTEXTS.length) {
      fail(`invalid context index at ${file}:${lineIndex + 1}`);
    }
    if (!Number.isInteger(decoded.variant) || decoded.variant < 0 || decoded.variant > 11) {
      fail(`invalid variant at ${file}:${lineIndex + 1}`);
    }
    rows.push(decoded);
  }
}

assert.equal(rows.length, EXPECTED_ROWS, 'boundary corpus row count must remain exact');
const unique = new Set();
const roleCounts = new Map(DIRECTOR_SCENARIO_ROLES.map((role) => [role, 0]));
const contextCounts = new Map(DIRECTOR_SCENARIO_CONTEXTS.map((context) => [context, 0]));
const variantCounts = new Map();

for (const row of rows) {
  const role = DIRECTOR_SCENARIO_ROLES[row.roleIndex];
  const context = DIRECTOR_SCENARIO_CONTEXTS[row.contextIndex];
  const key = `${row.roleIndex}:${row.contextIndex}:${row.variant}`;
  assert(!unique.has(key), `duplicate boundary case ${key}`);
  unique.add(key);
  roleCounts.set(role, roleCounts.get(role) + 1);
  contextCounts.set(context, contextCounts.get(context) + 1);
  variantCounts.set(row.variant, (variantCounts.get(row.variant) ?? 0) + 1);

  const urgency = BANDS[row.variant % 4];
  const threat = BANDS[Math.floor(row.variant / 4)];
  const socialNeed = SOCIAL[(row.roleIndex + row.variant) % 4];
  const scarcity = SCARCITY[(row.contextIndex + row.variant * 2) % 4];
  const request = {
    role,
    context,
    urgency,
    threat,
    socialNeed,
    scarcity,
    fatigue: ((row.roleIndex + row.variant) % 5) / 5,
    travelRisk: ((row.contextIndex + row.variant) % 5) / 5,
    distanceMeters: 40 + ((row.roleIndex * 16 + row.contextIndex + row.variant) % 20) * 120,
    waitingSeconds: row.variant * 15,
  };

  const first = scoreScenarioRequest(request, 0);
  const second = scoreScenarioRequest(request, 0);
  assert.deepEqual(first, second, `non-deterministic result for ${key}`);
  assert.equal(first.request.role, role);
  assert.equal(first.request.context, context);
  assert(Number.isFinite(first.score), `invalid score for ${key}`);
  assert(['off', 'deferred', 'normal', 'priority', 'critical'].includes(first.tier), `invalid tier for ${key}`);
}

for (const role of DIRECTOR_SCENARIO_ROLES) assert.equal(roleCounts.get(role), 13 * DIRECTOR_SCENARIO_CONTEXTS.length, `role coverage drift: ${role}`);
for (const context of DIRECTOR_SCENARIO_CONTEXTS) assert.equal(contextCounts.get(context), 13 * DIRECTOR_SCENARIO_ROLES.length, `context coverage drift: ${context}`);
for (let variant = 0; variant <= 11; variant += 1) assert.equal(variantCounts.get(variant), 256, `variant coverage drift: ${variant}`);

const baseline = scoreScenarioRequest({ role: 'guard', context: 'quiet', urgency: 0.05, threat: 0.05, socialNeed: 0.10, scarcity: 0.05 });
const escalation = scoreScenarioRequest({ role: 'guard', context: 'combat', urgency: 0.92, threat: 0.92, socialNeed: 0.10, scarcity: 0.05 });
assert(escalation.score > baseline.score, 'high-threat/high-urgency boundary must escalate guard priority');
assert.equal(escalation.protected, true, 'protected boundary must activate at production threshold');

console.log(`R3 boundary corpus OK: ${rows.length} rows, ${unique.size} unique cases, 16 roles, 16 contexts, 12 variants`);
