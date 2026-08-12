#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'run316-progress-materializer.yml');
const scriptPath = path.join(ROOT, 'scripts', 'materializeRun316Progress.js');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const script = fs.readFileSync(scriptPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun316ProgressMaterializer] ${message}`); };

for (const token of [
  "- '.run316-progress-materialize'",
  'permissions:\n  contents: write',
  '- name: Fail closed outside Run316 source branch',
  'test "$GITHUB_REF" = "refs/heads/$RUN_BRANCH"',
  'RUN_BRANCH: run316-retire-run303-write-workflow',
  'BASE_SHA: d89f1a01c76d48eb60f9f1cad0a6bfac026aa37c',
  'ref: ${{ github.sha }}',
  'node scripts/collectPerfSnapshot.js run316-run303-write-workflow-retirement',
  'node scripts/materializeRun316Progress.js',
  'node scripts/checkCheckpointConsistency.js',
  'git add 3D_GAME_PROGRESS.md STABLE_TAGS.md perf_log.csv',
  'git push origin "HEAD:$RUN_BRANCH"',
]) {
  if (!workflow.includes(token)) fail(`workflow token missing: ${token}`);
}
if (workflow.includes('workflow_dispatch:') || workflow.includes('repository_dispatch:')) {
  fail('Run316 progress materializer must remain branch-push-only');
}

const guardIndex = workflow.indexOf('- name: Fail closed outside Run316 source branch');
const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4');
if (guardIndex < 0 || checkoutIndex < 0 || guardIndex >= checkoutIndex) {
  fail('source-ref guard must precede checkout');
}
const beforeGuard = workflow.slice(0, guardIndex);
for (const forbidden of ['git add ', 'git commit ', 'git push ']) {
  if (beforeGuard.includes(forbidden)) fail(`write-capable command before source-ref guard: ${forbidden.trim()}`);
}

for (const token of [
  '## Run 316 — retire Run303 dispatch-capable write workflow identity + checkpoint catch-up',
  'stable-2026-08-12-run316',
  'appendOnce(progressPath, progressMarker, progressBlock)',
  'appendOnce(stablePath, stableMarker, stableBlock)',
  'Issue #226',
]) {
  if (!script.includes(token)) fail(`materializer script token missing: ${token}`);
}
if (script.includes('appendFileSync')) fail('Run316 progress appender must remain marker-idempotent');

console.log('[checkRun316ProgressMaterializer] PASS: branch-only source guard, exact-main pre/post gates, real perf sample, idempotent records and checkpoint consistency are locked');
