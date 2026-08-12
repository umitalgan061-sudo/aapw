#!/usr/bin/env node
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/run305-run303-source-branch-guard.yml', 'utf8');
const liveBase = "BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'workflow_dispatch' && github.sha || 'a5b9dcfc6da0b199db6faa040c87c735bdd2dc58' }}";

const occurrences = workflow.split(liveBase).length - 1;
if (occurrences !== 2) {
  throw new Error(`Run305 requires exactly two event-aware BASE_SHA overrides; found ${occurrences}`);
}
if (!workflow.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}")) {
  throw new Error('Run305 checkout must remain pinned to the exact PR head or exact dispatched/pushed revision');
}
if (!workflow.includes('BASE_SHA: a5b9dcfc6da0b199db6faa040c87c735bdd2dc58')) {
  throw new Error('Run305 must retain its immutable historical branch-push base');
}
if (/permissions:[\s\S]{0,80}contents:\s*write/.test(workflow)) {
  throw new Error('Run305 validation workflow must remain read-only');
}

console.log('[checkRun305LiveBaseSemantics] PASS: PR uses live base, manual dispatch uses checked-out SHA, historical branch-push base remains immutable');
