#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflowPath = '.github/workflows/run303-run216-complete-marker-prefix.yml';
const source = fs.readFileSync(workflowPath, 'utf8');
const expectedRef = 'refs/heads/agent/run303-run216-complete-marker-prefix';
const guard = `test "$GITHUB_REF" = '${expectedRef}'`;
const checkout = '- uses: actions/checkout@v4';
const push = 'git push origin HEAD:agent/run303-run216-complete-marker-prefix';

for (const token of ['workflow_dispatch:', 'contents: write', guard, checkout, push]) {
  if (!source.includes(token)) throw new Error(`Run305 contract missing: ${token}`);
}

const guardIndex = source.indexOf(guard);
const checkoutIndex = source.indexOf(checkout);
const pushIndex = source.indexOf(push);
if (!(guardIndex >= 0 && guardIndex < checkoutIndex && checkoutIndex < pushIndex)) {
  throw new Error('Run305 source-branch guard must execute before checkout and before the write-capable push');
}

const runGuard = (ref) => spawnSync('bash', ['-c', `set -euo pipefail; ${guard}`], {
  env: { ...process.env, GITHUB_REF: ref },
  encoding: 'utf8',
});

const sourceBranch = runGuard(expectedRef);
if (sourceBranch.status !== 0) throw new Error(`Run305 source branch must pass the guard: ${sourceBranch.stderr}`);
for (const rejectedRef of ['refs/heads/main', 'refs/heads/run305-run303-source-branch-guard', 'refs/tags/manual-test']) {
  const result = runGuard(rejectedRef);
  if (result.status === 0) throw new Error(`Run305 guard unexpectedly accepted ${rejectedRef}`);
}

const prefix = source.slice(0, guardIndex);
if (/\bgit\s+push\b/.test(prefix) || /\bgit\s+(commit|add)\b/.test(prefix)) {
  throw new Error('Run305 detected repository mutation before the source-branch guard');
}

console.log('[checkRun305Run303SourceBranchGuard] PASS: Run303 write workflow fails closed on main/other refs before checkout and permits only its historical source branch');
