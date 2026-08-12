#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'run303-run216-complete-marker-prefix.yml');
const source = fs.readFileSync(workflowPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun314Run303ManualDispatchRemoved] ${message}`); };

if (source.includes('workflow_dispatch')) fail('Run303 must not expose workflow_dispatch on the default-branch definition');
if (source.includes('repository_dispatch')) fail('Run303 must not expose repository_dispatch');

const required = [
  'push:',
  '- agent/run303-run216-complete-marker-prefix',
  "- '.github/workflows/run303-run216-complete-marker-prefix.yml'",
  'permissions:\n  contents: write',
  'git push origin HEAD:agent/run303-run216-complete-marker-prefix',
  'node scripts/checkRun216ServiceWorkerMaterializer.js',
  'node scripts/checkServiceWorkerCache.js',
  'node scripts/checkPwaInstallability.js',
];
for (const token of required) {
  if (!source.includes(token)) fail(`required historical push-path contract missing: ${token}`);
}

const targetCount = source.split('git push origin HEAD:agent/run303-run216-complete-marker-prefix').length - 1;
if (targetCount !== 1) fail(`expected exactly one historical branch push target, found ${targetCount}`);

const branchCount = source.split('- agent/run303-run216-complete-marker-prefix').length - 1;
if (branchCount !== 1) fail(`expected exactly one push branch filter, found ${branchCount}`);

const pathCount = source.split("- '.github/workflows/run303-run216-complete-marker-prefix.yml'").length - 1;
if (pathCount !== 1) fail(`expected exactly one workflow-file path filter, found ${pathCount}`);

console.log('[checkRun314Run303ManualDispatchRemoved] PASS: Run303 has no manual/repository dispatch and remains restricted to its historical branch+path push trigger');
