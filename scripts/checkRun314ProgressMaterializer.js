#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'run314-progress-materializer.yml');
const scriptPath = path.join(__dirname, 'materializeRun314Progress.js');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const script = fs.readFileSync(scriptPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun314ProgressMaterializer] ${message}`); };

const requiredWorkflowTokens = [
  "- '.run314-progress-materialize'",
  'permissions:\n  contents: write',
  '- name: Fail closed outside Run314 source branch',
  'test "$GITHUB_REF" = "refs/heads/$RUN_BRANCH"',
  'RUN_BRANCH: run314-remove-run303-manual-dispatch',
  'BASE_SHA: 3d404c14b55e3e6121b70430fd0359e532b6f285',
  'ref: ${{ github.sha }}',
  'node scripts/collectPerfSnapshot.js run314-run303-dispatch-removal',
  'node scripts/materializeRun314Progress.js',
  'git add 3D_GAME_PROGRESS.md STABLE_TAGS.md perf_log.csv',
  'git push origin "HEAD:$RUN_BRANCH"',
];
for (const token of requiredWorkflowTokens) if (!workflow.includes(token)) fail(`workflow token missing: ${token}`);
if (workflow.includes('workflow_dispatch:')) fail('Run314 progress materializer must not expose manual dispatch');
if (workflow.includes('repository_dispatch:')) fail('Run314 progress materializer must not expose repository dispatch');

const guardIndex = workflow.indexOf('- name: Fail closed outside Run314 source branch');
const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4');
if (guardIndex < 0 || checkoutIndex < 0 || guardIndex >= checkoutIndex) fail('source-ref guard must precede checkout');
const beforeGuard = workflow.slice(0, guardIndex);
for (const forbidden of ['git add ', 'git commit ', 'git push ']) {
  if (beforeGuard.includes(forbidden)) fail(`write-capable command before source-ref guard: ${forbidden.trim()}`);
}

for (const token of [
  '## Run 314 — remove Run303 manual-dispatch capability',
  'stable-2026-08-12-run314',
  'appendOnce(progressPath, progressMarker, progressBlock)',
  'appendOnce(stablePath, stableMarker, stableBlock)',
  'Issue #226',
]) {
  if (!script.includes(token)) fail(`materializer script token missing: ${token}`);
}
if (script.includes('appendFileSync')) fail('Run314 progress appender must remain idempotent/marker-controlled');

console.log('[checkRun314ProgressMaterializer] PASS: one-shot path trigger, branch guard-before-checkout, idempotent JS records and scoped checkpoint staging are locked');
