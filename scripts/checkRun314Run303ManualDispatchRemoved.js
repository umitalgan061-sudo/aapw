#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const OLD_PATH = path.join(WORKFLOWS, 'run303-run216-complete-marker-prefix.yml');
const NEW_PATH = path.join(WORKFLOWS, 'run314-run216-complete-marker-prefix-push-only.yml');
const fail = (message) => { throw new Error(`[checkRun314Run303ManualDispatchRemoved] ${message}`); };

if (fs.existsSync(OLD_PATH)) fail('historical dispatch-capable Run303 workflow identity must be retired from the default-branch tree');
if (!fs.existsSync(NEW_PATH)) fail('new push-only Run216 repair workflow identity is missing');

const source = fs.readFileSync(NEW_PATH, 'utf8');
if (source.includes('workflow_dispatch')) fail('push-only successor must not expose workflow_dispatch');
if (source.includes('repository_dispatch')) fail('push-only successor must not expose repository_dispatch');

const required = [
  'push:',
  '- agent/run303-run216-complete-marker-prefix',
  "- '.github/workflows/run314-run216-complete-marker-prefix-push-only.yml'",
  'permissions:\n  contents: write',
  '- name: Fail closed outside historical Run303 source branch',
  'test "$GITHUB_REF" = "refs/heads/agent/run303-run216-complete-marker-prefix"',
  'git push origin HEAD:agent/run303-run216-complete-marker-prefix',
  'node scripts/checkRun216ServiceWorkerMaterializer.js',
  'node scripts/checkServiceWorkerCache.js',
  'node scripts/checkPwaInstallability.js',
];
for (const token of required) {
  if (!source.includes(token)) fail(`required push-only successor contract missing: ${token}`);
}

const guardIndex = source.indexOf('- name: Fail closed outside historical Run303 source branch');
const checkoutIndex = source.indexOf('- uses: actions/checkout@v4');
if (guardIndex < 0 || checkoutIndex < 0 || guardIndex >= checkoutIndex) fail('source-ref guard must precede checkout in the new workflow identity');

const target = 'git push origin HEAD:agent/run303-run216-complete-marker-prefix';
const workflowFiles = fs.readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/i.test(name));
const targetOwners = [];
for (const name of workflowFiles) {
  const body = fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
  if (body.includes(target)) targetOwners.push(name);
  if (body.includes('agent/run303-run216-complete-marker-prefix') && body.includes('workflow_dispatch')) {
    fail(`dispatch-capable workflow still references historical Run303 branch: ${name}`);
  }
}
if (targetOwners.length !== 1 || targetOwners[0] !== 'run314-run216-complete-marker-prefix-push-only.yml') {
  fail(`historical branch write target must belong only to the new push-only workflow, found: ${targetOwners.join(', ') || 'none'}`);
}

console.log('[checkRun314Run303ManualDispatchRemoved] PASS: old workflow identity retired; sole historical-branch writer is the new guarded push-only workflow with no manual/repository dispatch');
