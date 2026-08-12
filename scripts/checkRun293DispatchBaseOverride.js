#!/usr/bin/env node
import fs from 'node:fs';

const workflowPath = '.github/workflows/run292-run290-live-base-fix.yml';
const source = fs.readFileSync(workflowPath, 'utf8');

const dispatchOverride = "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'workflow_dispatch' && github.sha || '9e94d5ef76ad75a1e4e84b514cf44af79c728e33' }}";

if (!source.includes('workflow_dispatch:')) {
  throw new Error('Run293 contract missing workflow_dispatch trigger');
}
if ((source.match(new RegExp(dispatchOverride.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length < 2) {
  throw new Error('Run293 requires dispatch-aware BASE_SHA on both exact-main gates');
}
if (!source.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}")) {
  throw new Error('Run293 checkout must continue using the exact event revision');
}
if (/permissions:[\s\S]{0,120}\b(write|write-all)\b/i.test(source)) {
  throw new Error('Run293 must not broaden Run292 workflow permissions');
}

console.log('[checkRun293DispatchBaseOverride] PASS: Run292 manual dispatch validates the checked-out current SHA while PR/push semantics stay bounded');
