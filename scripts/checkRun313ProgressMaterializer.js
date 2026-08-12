#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'run313-progress-materializer.yml');
const scriptPath = path.join(__dirname, 'materializeRun313Progress.js');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const script = fs.readFileSync(scriptPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun313ProgressMaterializer] ${message}`); };

const requiredWorkflowTokens = [
  "- '.run313-progress-materialize'",
  'permissions:\n  contents: write',
  '- name: Fail closed outside Run313 source branch',
  'test "$GITHUB_REF" = "refs/heads/$RUN_BRANCH"',
  'RUN_BRANCH: run313-run303-dispatch-safety',
  'BASE_SHA: fd11b1024570cc3b725a4ad9d4ec8bf98f95f855',
  'ref: ${{ github.sha }}',
  'node scripts/collectPerfSnapshot.js run313-run303-dispatch-safety',
  'node scripts/materializeRun313Progress.js',
  'git diff --cached --numstat',
  'git push origin "HEAD:$RUN_BRANCH"',
];
for (const token of requiredWorkflowTokens) if (!workflow.includes(token)) fail(`workflow token missing: ${token}`);
if (workflow.includes('workflow_dispatch:')) fail('progress materializer must remain branch-push-only');

const guardIndex = workflow.indexOf('- name: Fail closed outside Run313 source branch');
const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4');
if (guardIndex < 0 || checkoutIndex < 0 || guardIndex >= checkoutIndex) fail('source-ref guard must precede checkout');
const beforeGuard = workflow.slice(0, guardIndex);
for (const forbidden of ['git add ', 'git commit ', 'git push ']) {
  if (beforeGuard.includes(forbidden)) fail(`write-capable command before source-ref guard: ${forbidden.trim()}`);
}

for (const token of [
  '## Run 313 — Run303 manual-dispatch fail-closed guard + SSOT catch-up',
  'stable-2026-08-12-run313',
  'appendOnce(progressPath, progressMarker, progressBlock)',
  'appendOnce(stablePath, stableMarker, stableBlock)',
]) {
  if (!script.includes(token)) fail(`materializer script token missing: ${token}`);
}
if (script.includes('appendFileSync')) fail('Run313 progress appender must use idempotent marker-controlled file replacement, not blind appendFileSync');

console.log('[checkRun313ProgressMaterializer] PASS: branch-only source guard, one-shot path trigger, idempotent JS records and additive staged gate are locked');
