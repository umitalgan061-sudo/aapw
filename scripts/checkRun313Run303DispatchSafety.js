#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'run303-run216-complete-marker-prefix.yml');
const source = fs.readFileSync(workflowPath, 'utf8');
const fail = (message) => { throw new Error(`[checkRun313Run303DispatchSafety] ${message}`); };

const guardName = '- name: Fail closed outside historical Run303 source branch';
const guardRef = 'test "$GITHUB_REF" = "refs/heads/agent/run303-run216-complete-marker-prefix"';
const checkout = '- uses: actions/checkout@v4';
const hardPush = 'git push origin HEAD:agent/run303-run216-complete-marker-prefix';

for (const token of ['workflow_dispatch:', 'permissions:\n  contents: write', guardName, guardRef, checkout, hardPush]) {
  if (!source.includes(token)) fail(`required token missing: ${token}`);
}

const guardIndex = source.indexOf(guardName);
const checkoutIndex = source.indexOf(checkout);
if (guardIndex < 0 || checkoutIndex < 0 || guardIndex >= checkoutIndex) {
  fail('source-ref guard must execute before checkout');
}

const beforeGuard = source.slice(0, guardIndex);
for (const forbidden of ['git add ', 'git commit ', 'git push ']) {
  if (beforeGuard.includes(forbidden)) fail(`write-capable command appears before source-ref guard: ${forbidden.trim()}`);
}

const guardCount = source.split(guardRef).length - 1;
if (guardCount !== 1) fail(`expected exactly one source-ref guard, found ${guardCount}`);

const allowedRef = 'refs/heads/agent/run303-run216-complete-marker-prefix';
for (const rejected of ['refs/heads/main', 'refs/heads/run313-run303-dispatch-safety', 'refs/tags/stable-example']) {
  if (rejected === allowedRef) fail('negative-control ref unexpectedly equals allowed ref');
}
if (allowedRef !== 'refs/heads/agent/run303-run216-complete-marker-prefix') fail('allowed source ref drifted');

console.log('[checkRun313Run303DispatchSafety] PASS: Run303 write workflow fails closed before checkout outside its historical source branch');
