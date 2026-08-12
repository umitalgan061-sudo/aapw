#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const OLD_NAME = 'run303-run216-complete-marker-prefix.yml';
const READ_ONLY_NAME = 'run303-run216-complete-marker-exact-head-v2.yml';
const HISTORICAL_BRANCH = 'agent/run303-run216-complete-marker-prefix';
const HARD_TARGET = `git push origin HEAD:${HISTORICAL_BRANCH}`;
const fail = (message) => { throw new Error(`[checkRun316Run303WriteWorkflowRetired] ${message}`); };

if (fs.existsSync(path.join(WORKFLOWS, OLD_NAME))) {
  fail(`dispatch-capable write workflow identity still exists: ${OLD_NAME}`);
}

const readOnlyPath = path.join(WORKFLOWS, READ_ONLY_NAME);
if (!fs.existsSync(readOnlyPath)) fail(`read-only negative-control workflow missing: ${READ_ONLY_NAME}`);
const readOnly = fs.readFileSync(readOnlyPath, 'utf8');
if (!readOnly.includes('workflow_dispatch:')) fail('read-only negative control no longer exercises the dispatch distinction');
if (!/permissions:\s*[\r\n]+\s*contents:\s*read\b/.test(readOnly)) fail('read-only negative control must keep contents: read');
if (/contents:\s*write\b/.test(readOnly) || /permissions:\s*write-all\b/.test(readOnly) || readOnly.includes(HARD_TARGET)) {
  fail('read-only negative control unexpectedly gained write capability');
}

const workflowFiles = fs.readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/i.test(name)).sort();
const dispatchWriteRisks = [];
const hardTargetOwners = [];
for (const name of workflowFiles) {
  const body = fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
  const referencesHistoricalBranch = body.includes(HISTORICAL_BRANCH);
  const exposesDispatch = body.includes('workflow_dispatch:') || body.includes('repository_dispatch:');
  const hasContentsWrite = /contents:\s*write\b/.test(body) || /permissions:\s*write-all\b/.test(body);
  const hasHardTarget = body.includes(HARD_TARGET);
  if (hasHardTarget) hardTargetOwners.push(name);
  if (referencesHistoricalBranch && exposesDispatch && (hasContentsWrite || hasHardTarget)) {
    dispatchWriteRisks.push(name);
  }
}

if (dispatchWriteRisks.length) {
  fail(`dispatch + historical-branch write risk remains in current default-tree workflows: ${dispatchWriteRisks.join(', ')}`);
}
if (hardTargetOwners.length) {
  fail(`current default-tree workflow still hard-pushes the historical Run303 branch: ${hardTargetOwners.join(', ')}`);
}

console.log(`[checkRun316Run303WriteWorkflowRetired] PASS: ${OLD_NAME} retired; no dispatch+write or hard-push owner remains for ${HISTORICAL_BRANCH}; ${READ_ONLY_NAME} remains a contents:read negative control`);
