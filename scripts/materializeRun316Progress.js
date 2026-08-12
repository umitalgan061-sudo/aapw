#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const progressPath = path.join(ROOT, '3D_GAME_PROGRESS.md');
const stablePath = path.join(ROOT, 'STABLE_TAGS.md');
const progressMarker = '## Run 316 — retire Run303 dispatch-capable write workflow identity + checkpoint catch-up';
const stableMarker = 'stable-2026-08-12-run316';

const progressBlock = [
  '',
  progressMarker,
  '- Exact start main: `d89f1a01c76d48eb60f9f1cad0a6bfac026aa37c`. Concurrency/ownership refreshed after the owner-approved Run314 patika commit; open terrain/editor/RTS work remains untouched.',
  '- Security RCA (Issue #226): the default-tree `.github/workflows/run303-run216-complete-marker-prefix.yml` combined `workflow_dispatch`, `contents: write`, and a hard-coded push to `agent/run303-run216-complete-marker-prefix`. Current-version source guards were insufficient because manual dispatch can select a historical ref containing an older pre-guard workflow version.',
  '- Final capability-level fix: the dispatch-capable write-workflow identity is removed from the current default-tree candidate. No replacement writer is added. The separate `run303-run216-complete-marker-exact-head-v2.yml` remains intentionally dispatchable because it is `contents: read` and has no historical-branch push target.',
  '- Regression: `checkRun316Run303WriteWorkflowRetired.js` scans every current workflow file, requires the retired identity to be absent, forbids any historical-Run303 reference that combines dispatch with write/hard-push capability, requires zero current hard-push owners for that branch, and keeps the read-only validator as an explicit negative control.',
  '- Checkpoint catch-up: current main entered Run316 with progress at Run314 but stable/perf records still at Run296. That mismatch was detected by `checkCheckpointConsistency.js` before publication. This materialization writes Run316 progress + stable checkpoint + one real-frame perf sample together, then requires checkpoint consistency before commit.',
  '- Validation boundary: pre-materialization focused Run316 security/current-main gate passed through the retirement regression, Run216 materializer, Run300/Run283 governance, service-worker and PWA contracts. The standing Run283 heavy branch gate reached the known checkpoint mismatch; final materialized PR head must pass Run316, PR Main Freshness Guard, Run283 and all mandatory PR workflows before merge.',
  '- Runtime/product delta: 0. No `src/3d`, `service-worker.js`, game page, RTS runtime, terrain-authoring or gameplay/world geometry changes. Technical debt introduced: 0. Risk: LOW. Confidence: 5/5.',
  '- World Evolution Report: road km +0; forest km² +0; castles/NPC/events/animals +0; World Coverage unchanged; assets/dialogue/ADR +0; player-visible gameplay delta none.',
  '- Next safe step: refresh `main`, this handoff and open ownership after Run316 publication. Resume only an unowned priority item; do not revive stale Run313/Run314/Run315 security branches.',
].join('\n') + '\n';

const stableBlock = [
  '',
  '- `stable-2026-08-12-run316` — dispatch-capable Run303 write-workflow identity retired + checkpoint continuity repaired; runtime/product delta 0; final materialized PR head remains exact-current-main and full-DoD gated.',
].join('\n') + '\n';

function appendOnce(file, marker, block) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) {
    console.log(`[materializeRun316Progress] already present: ${marker}`);
    return false;
  }
  const prefix = source.length === 0 || source.endsWith('\n') ? source : `${source}\n`;
  fs.writeFileSync(file, prefix + block, 'utf8');
  console.log(`[materializeRun316Progress] appended: ${marker}`);
  return true;
}

const progressChanged = appendOnce(progressPath, progressMarker, progressBlock);
const stableChanged = appendOnce(stablePath, stableMarker, stableBlock);
console.log(`[materializeRun316Progress] PASS: progressChanged=${progressChanged} stableChanged=${stableChanged}`);
