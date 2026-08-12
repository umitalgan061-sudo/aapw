#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'run313-run303-dispatch-safety.yml');
const source = fs.readFileSync(workflowPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun313FuturePrSafety] ${message}`); };

const required = [
  'pull_request:',
  'permissions:\n  contents: read',
  "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || 'fd11b1024570cc3b725a4ad9d4ec8bf98f95f855' }}",
  "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
  'if [ "$GITHUB_EVENT_NAME" != "pull_request" ]; then',
  'node scripts/checkAdditiveOnlyDiff.js "$BASE_SHA" HEAD',
  'git diff --check "$BASE_SHA" HEAD',
];
for (const token of required) if (!source.includes(token)) fail(`required future-PR safety token missing: ${token}`);

if (source.includes('workflow_dispatch:')) fail('Run313 read-only validation workflow must not expose manual dispatch');
const pathIsolation = 'test -z "$(git diff --name-only "$BASE_SHA" HEAD -- src/3d service-worker.js game3d.html canonical-dev.html rts.html godot/terrain-authoring)"';
const isolationCount = source.split(pathIsolation).length - 1;
if (isolationCount !== 2) fail(`expected exactly two historical path-isolation assertions, found ${isolationCount}`);
const bypassCount = source.split('if [ "$GITHUB_EVENT_NAME" != "pull_request" ]; then').length - 1;
if (bypassCount !== 2) fail(`expected exactly two PR-safe path-isolation guards, found ${bypassCount}`);

for (const sectionName of ['Exact-main additive entry gate', 'Final exact-main concurrency and additive-only gate']) {
  const sectionStart = source.indexOf(`- name: ${sectionName}`);
  if (sectionStart < 0) fail(`missing section: ${sectionName}`);
  const nextStep = source.indexOf('\n      - name:', sectionStart + 1);
  const section = source.slice(sectionStart, nextStep < 0 ? source.length : nextStep);
  const additive = section.indexOf('node scripts/checkAdditiveOnlyDiff.js "$BASE_SHA" HEAD');
  const diffCheck = section.indexOf('git diff --check "$BASE_SHA" HEAD');
  const prGuard = section.indexOf('if [ "$GITHUB_EVENT_NAME" != "pull_request" ]; then');
  if (additive < 0 || diffCheck < 0 || prGuard < 0 || additive > prGuard || diffCheck > prGuard) {
    fail(`${sectionName} must complete generic additive/diff checks before historical path isolation`);
  }
}

console.log('[checkRun313FuturePrSafety] PASS: live PR base, exact PR head, read-only permissions, and PR-safe historical path isolation are locked');
