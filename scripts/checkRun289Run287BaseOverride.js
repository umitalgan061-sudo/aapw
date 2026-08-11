#!/usr/bin/env node
import fs from 'node:fs';

const workflowPath = '.github/workflows/run287-checkpoint-parser-compat.yml';
const source = fs.readFileSync(workflowPath, 'utf8');

const required = [
  'BASE_SHA: 8416d9540f5a5f2bc1e8bfe59811c1459330938b',
  "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || '8416d9540f5a5f2bc1e8bfe59811c1459330938b' }}",
  'ref: ${{ github.event_name == \'pull_request\' && github.event.pull_request.head.sha || github.sha }}',
  'test "$(git rev-parse origin/main)" = "$BASE_SHA"',
  'permissions:\n  contents: read',
];

for (const token of required) {
  if (!source.includes(token)) throw new Error(`Run289 contract missing: ${token}`);
}

const validateBlock = source.match(/jobs:\n  validate:\n([\s\S]*)$/)?.[1] ?? '';
if (!/\n    env:\n[\s\S]*?github\.event\.pull_request\.base\.sha/.test(`\n${validateBlock}`)) {
  throw new Error('Run289 job-level BASE_SHA override is not scoped to jobs.validate');
}
if (/permissions:[\s\S]{0,120}\b(write|write-all)\b/i.test(source)) {
  throw new Error('Run289 must not broaden workflow permissions');
}
if (!/pull_request:\n    branches: \[main\]/.test(source)) {
  throw new Error('Run287 pull_request protection must remain enabled');
}

console.log('[checkRun289Run287BaseOverride] PASS: Run287 keeps historical base while PR jobs use live target head');
