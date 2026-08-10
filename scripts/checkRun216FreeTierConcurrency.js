#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = Object.freeze([
  '.github/workflows/run216-editor-authoring-browser.yml',
  '.github/workflows/run216-editor-usability-browser.yml'
]);
const GROUP = '  group: ${{ github.workflow }}-${{ github.ref }}';
const CANCEL = '  cancel-in-progress: true';

for (const relativePath of WORKFLOWS) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const concurrencyMatches = source.match(/^concurrency:\s*$/gm) || [];
  if (concurrencyMatches.length !== 1) {
    throw new Error(`${relativePath}: expected exactly one workflow-level concurrency block, got ${concurrencyMatches.length}`);
  }
  if (!source.includes(GROUP)) {
    throw new Error(`${relativePath}: workflow/ref-scoped concurrency group missing`);
  }
  if (!source.includes(CANCEL)) {
    throw new Error(`${relativePath}: cancel-in-progress must be enabled`);
  }
  const jobsIndex = source.indexOf('\njobs:');
  const concurrencyIndex = source.indexOf('\nconcurrency:');
  if (jobsIndex < 0 || concurrencyIndex < 0 || concurrencyIndex <= jobsIndex) {
    throw new Error(`${relativePath}: expected additive top-level concurrency block after jobs`);
  }
}

console.log('PASS Run216 free-tier concurrency: heavy browser proofs cancel stale runs only within the same workflow/ref group.');
