#!/usr/bin/env node
import fs from 'node:fs';

const workflows = [
  '.github/workflows/run287-checkpoint-parser-compat.yml',
  '.github/workflows/run289-run287-live-base-fix.yml',
  '.github/workflows/run290-pindex05-candidate-safe.yml',
  '.github/workflows/run292-run290-live-base-fix.yml',
];

const prGuard = 'if [ "${{ github.event_name }}" = "pull_request" ]; then';
const legacyScope = 'test -z "$(git diff --name-only "$BASE_SHA" HEAD -- src/3d service-worker.js scripts/run201CanonicalDevBoot.mjs godot/terrain-authoring)"';

function count(source, token) {
  return source.split(token).length - 1;
}

for (const workflow of workflows) {
  const source = fs.readFileSync(workflow, 'utf8');
  if (count(source, prGuard) !== 2) {
    throw new Error(`${workflow}: Run300 PR scope handoff must appear exactly twice (entry + final gate)`);
  }
  if (count(source, legacyScope) !== 2) {
    throw new Error(`${workflow}: expected exactly two historical scope-isolation checks`);
  }

  let cursor = 0;
  for (let occurrence = 0; occurrence < 2; occurrence += 1) {
    const scopeIndex = source.indexOf(legacyScope, cursor);
    const guardIndex = source.lastIndexOf(prGuard, scopeIndex);
    const additiveIndex = source.lastIndexOf('node scripts/checkAdditiveOnlyDiff.js "$BASE_SHA" HEAD', scopeIndex);
    const diffCheckIndex = source.lastIndexOf('git diff --check "$BASE_SHA" HEAD', scopeIndex);
    const exitIndex = source.indexOf('exit 0', guardIndex);
    if (!(additiveIndex >= 0 && diffCheckIndex > additiveIndex && guardIndex > diffCheckIndex && exitIndex > guardIndex && exitIndex < scopeIndex)) {
      throw new Error(`${workflow}: gate ${occurrence + 1} must keep live-base/additive/diff checks before the PR-only historical-scope handoff`);
    }
    cursor = scopeIndex + legacyScope.length;
  }

  if (!source.includes('github.event.pull_request.base.sha')) {
    throw new Error(`${workflow}: live pull-request base semantics missing`);
  }
  if (!source.includes('github.event.pull_request.head.sha')) {
    throw new Error(`${workflow}: exact pull-request head checkout missing`);
  }
}

console.log('[checkRun300LegacyPrScopeGate] PASS: four legacy candidate workflows keep global exact-main/additive gates while confining historical path isolation to non-PR runs');
