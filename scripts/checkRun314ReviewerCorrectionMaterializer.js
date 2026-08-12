#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'run314-review-correction-materializer.yml');
const scriptPath = path.join(ROOT, 'scripts', 'materializeRun314ReviewerCorrection.js');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const script = fs.readFileSync(scriptPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun314ReviewerCorrectionMaterializer] ${message}`); };

for (const token of [
  "- '.run314-review-correction-materialize'",
  'permissions:\n  contents: write',
  '- name: Fail closed outside Run314 source branch',
  'test "$GITHUB_REF" = "refs/heads/$RUN_BRANCH"',
  'RUN_BRANCH: run314-remove-run303-manual-dispatch',
  'BASE_SHA: 3d404c14b55e3e6121b70430fd0359e532b6f285',
  'node scripts/materializeRun314ReviewerCorrection.js',
  'BEFORE_PERF="$(git hash-object perf_log.csv)"',
  'git add 3D_GAME_PROGRESS.md STABLE_TAGS.md',
  'git push origin "HEAD:$RUN_BRANCH"',
]) {
  if (!workflow.includes(token)) fail(`workflow token missing: ${token}`);
}
if (workflow.includes('workflow_dispatch:') || workflow.includes('repository_dispatch:')) {
  fail('review correction materializer must be push-only');
}
if (workflow.includes('collectPerfSnapshot')) fail('review correction must not produce another performance sample');

const guardIndex = workflow.indexOf('- name: Fail closed outside Run314 source branch');
const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4');
if (guardIndex < 0 || checkoutIndex < 0 || guardIndex >= checkoutIndex) fail('source-ref guard must precede checkout');

for (const token of [
  '### Run 314 reviewer correction — retire old workflow identity',
  'stable-2026-08-12-run314-reviewer-correction',
  '.github/workflows/run303-run216-complete-marker-prefix.yml',
  '.github/workflows/run314-run216-complete-marker-prefix-push-only.yml',
  'appendOnce(progressPath, progressMarker, progressBlock)',
  'appendOnce(stablePath, stableMarker, stableBlock)',
]) {
  if (!script.includes(token)) fail(`review correction script token missing: ${token}`);
}
if (script.includes('appendFileSync')) fail('review correction appender must remain marker-idempotent');

console.log('[checkRun314ReviewerCorrectionMaterializer] PASS: reviewer correction is branch-only, idempotent, perf-preserving and scoped to progress/stable records');
