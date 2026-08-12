#!/usr/bin/env node
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/run305-run303-source-branch-guard.yml', 'utf8');
const bypass = "if [ \"$GITHUB_EVENT_NAME\" = 'pull_request' ]; then exit 0; fi";
const isolation = 'test -z "$(git diff --name-only "$BASE_SHA" HEAD -- src/3d service-worker.js game3d.html canonical-dev.html godot/terrain-authoring)"';

const bypassCount = workflow.split(bypass).length - 1;
const isolationCount = workflow.split(isolation).length - 1;
if (bypassCount !== 2) throw new Error(`Run305 requires two PR-only scope bypasses; found ${bypassCount}`);
if (isolationCount !== 2) throw new Error(`Run305 requires two historical path-isolation checks; found ${isolationCount}`);

let cursor = 0;
for (let index = 0; index < 2; index += 1) {
  const bypassIndex = workflow.indexOf(bypass, cursor);
  const isolationIndex = workflow.indexOf(isolation, bypassIndex);
  if (bypassIndex < 0 || isolationIndex < 0 || bypassIndex > isolationIndex) {
    throw new Error(`Run305 bypass ${index + 1} must precede its historical path-isolation check`);
  }
  const gatePrefix = workflow.slice(Math.max(0, bypassIndex - 700), bypassIndex);
  for (const required of [
    'git fetch origin main',
    'test "$(git rev-parse origin/main)" = "$BASE_SHA"',
    'node scripts/checkAdditiveOnlyDiff.js "$BASE_SHA" HEAD',
    'git diff --check "$BASE_SHA" HEAD',
  ]) {
    if (!gatePrefix.includes(required)) {
      throw new Error(`Run305 PR bypass must occur only after mandatory ${required}`);
    }
  }
  cursor = isolationIndex + isolation.length;
}

console.log('[checkRun305PrScopeBypass] PASS: PRs keep exact-main/additive/diff gates but skip only Run305 historical path isolation; branch/manual behavior remains bounded');
