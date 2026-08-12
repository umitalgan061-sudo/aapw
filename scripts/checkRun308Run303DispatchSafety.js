#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const ownerWorkflow = fs.readFileSync('.github/workflows/run303-run216-complete-marker-prefix.yml', 'utf8');
const validatorWorkflow = fs.readFileSync('.github/workflows/run308-run303-dispatch-safety.yml', 'utf8');
const expectedRef = 'refs/heads/agent/run303-run216-complete-marker-prefix';
const ownerGuard = `test "$GITHUB_REF" = '${expectedRef}'`;

for (const token of ['workflow_dispatch:', 'contents: write', ownerGuard, '- uses: actions/checkout@v4', 'git push origin HEAD:agent/run303-run216-complete-marker-prefix']) {
  if (!ownerWorkflow.includes(token)) throw new Error(`Run308 owner-workflow contract missing: ${token}`);
}
const guardIndex = ownerWorkflow.indexOf(ownerGuard);
const checkoutIndex = ownerWorkflow.indexOf('- uses: actions/checkout@v4');
const pushIndex = ownerWorkflow.indexOf('git push origin HEAD:agent/run303-run216-complete-marker-prefix');
if (!(guardIndex >= 0 && guardIndex < checkoutIndex && checkoutIndex < pushIndex)) {
  throw new Error('Run308 requires the Run303 source-ref guard before checkout and before its write-capable push');
}
if (/\bgit\s+(?:add|commit|push)\b/.test(ownerWorkflow.slice(0, guardIndex))) {
  throw new Error('Run308 detected repository mutation before the Run303 source-ref guard');
}

const runOwnerGuard = (ref) => spawnSync('bash', ['-c', `set -euo pipefail; ${ownerGuard}`], {
  env: { ...process.env, GITHUB_REF: ref },
  encoding: 'utf8',
});
if (runOwnerGuard(expectedRef).status !== 0) throw new Error('Run308 owner branch must pass its guard');
for (const rejected of ['refs/heads/main', 'refs/heads/run308-run303-dispatch-safety', 'refs/tags/manual-test']) {
  if (runOwnerGuard(rejected).status === 0) throw new Error(`Run308 owner guard unexpectedly accepted ${rejected}`);
}

const liveBase = "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'workflow_dispatch' && github.sha || '09448963fdac06db9f2a35d9fc2e72d1882badfb' }}";
if (!validatorWorkflow.includes(liveBase)) throw new Error('Run308 validator must derive live PR/dispatch base while retaining immutable branch-push base');
if (!validatorWorkflow.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}")) {
  throw new Error('Run308 validator must checkout the exact PR head or exact dispatched/pushed revision');
}
if (!validatorWorkflow.includes("if [ \"$GITHUB_EVENT_NAME\" != 'pull_request' ]; then")) {
  throw new Error('Run308 validator must scope historical path isolation to non-PR runs');
}
if (!validatorWorkflow.includes('node scripts/checkAdditiveOnlyDiff.js "$BASE_SHA" HEAD') || !validatorWorkflow.includes('git diff --check "$BASE_SHA" HEAD')) {
  throw new Error('Run308 must retain additive-only and diff gates for every event');
}
if (/permissions:[\s\S]{0,100}contents:\s*write/.test(validatorWorkflow)) {
  throw new Error('Run308 validation workflow must remain read-only');
}

console.log('[checkRun308Run303DispatchSafety] PASS: Run303 write workflow fails closed off-owner ref; Run308 validation stays future-PR-safe, exact-head and read-only');
