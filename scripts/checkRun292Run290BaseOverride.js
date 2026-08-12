#!/usr/bin/env node
import fs from 'node:fs';

const workflowPath = '.github/workflows/run290-pindex05-candidate-safe.yml';
const source = fs.readFileSync(workflowPath, 'utf8');

const required = [
  'BASE_SHA: 5c562b6518dfe9c198bb1393e15e1ae1f022ecd9',
  "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || '5c562b6518dfe9c198bb1393e15e1ae1f022ecd9' }}",
  "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
  'test "$(git rev-parse origin/main)" = "$BASE_SHA"',
  'permissions:\n  contents: read',
];

for (const token of required) {
  if (!source.includes(token)) throw new Error(`Run292 contract missing: ${token}`);
}

const validateBlock = source.match(/jobs:\n  validate:\n([\s\S]*)$/)?.[1] ?? '';
if (!/\n    env:\n[\s\S]*?github\.event\.pull_request\.base\.sha/.test(`\n${validateBlock}`)) {
  throw new Error('Run292 job-level BASE_SHA override is not scoped to jobs.validate');
}
if (/permissions:[\s\S]{0,120}\b(write|write-all)\b/i.test(source)) {
  throw new Error('Run292 must not broaden Run290 workflow permissions');
}
if (!/pull_request:\n    branches: \[main\]/.test(source)) {
  throw new Error('Run290 pull_request protection must remain enabled');
}

console.log('[checkRun292Run290BaseOverride] PASS: Run290 keeps historical push base while PR jobs use live target head');
