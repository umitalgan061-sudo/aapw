#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const progressPath = path.join(ROOT, '3D_GAME_PROGRESS.md');
const stablePath = path.join(ROOT, 'STABLE_TAGS.md');

const progressMarker = '## Run 314 — remove Run303 manual-dispatch capability';
const stableMarker = 'stable-2026-08-12-run314';

const progressBlock = [
  '',
  progressMarker,
  '- Exact start main: `3d404c14b55e3e6121b70430fd0359e532b6f285`. GOVERNANCE was re-read after that commit: the owner explicitly removed the former additive-only/no-line-deletion requirement, while normal bug/performance/readability/architecture justification and the rest of the DoD remain in force.',
  '- RCA: Run313 / PR #224 reached 7/7 green exact-head CI but Codex correctly found a P1: a current-version `GITHUB_REF` guard cannot protect `workflow_dispatch --ref <historical-ref>` because the selected historical ref can contain the pre-guard workflow version. PR #224 was closed unmerged; Issue #226 records the blocker.',
  '- Capability-level fix: `.github/workflows/run303-run216-complete-marker-prefix.yml` no longer declares `workflow_dispatch`. The historical write workflow remains reachable only by its existing push trigger on branch `agent/run303-run216-complete-marker-prefix` and path `.github/workflows/run303-run216-complete-marker-prefix.yml`; its Run216/PWA verification and hard-coded historical branch publish target are otherwise unchanged.',
  '- Regression: `checkRun314Run303ManualDispatchRemoved.js` requires both manual/repository dispatch to be absent and pins the one historical branch filter, one workflow-file path filter, one branch push target, write permission, and Run216/PWA verification contracts.',
  '- Ownership/concurrency: active Pindex/HD terrain work PR #225, HTerrain polish PR #222, and stale/draft RTS proof PR #214 were left untouched. Runtime `src/3d`, service-worker payload, game pages, RTS runtime and Godot terrain-authoring behavior have zero Run314 delta.',
  '- Pre-materialization exact head `aa3affb268de8f7ebc6e871be24589c46b14d106`: Run314 full chain PASS and independent Run283 Final Head Governance full chain PASS, including exact-main entry/final concurrency, PWA/cache/installability, determinism/world-reference, Chromium, mobile performance, terrain/road safety, technical debt and 34+ browser smoke checks. The materialized final head must rerun the same mandatory PR gates before merge.',
  '- `perf_log.csv` gains a fresh real-frame `run314-run303-dispatch-removal` sample through `collectPerfSnapshot.js`. Technical debt introduced: 0. Risk: LOW. Confidence: 5/5. ADR not required: this is the direct least-capability bug fix for Issue #226; the security rationale and rollback history are captured in the issue and this SSOT entry.',
  '- World Evolution Report: road km +0; forest km² +0; castles/NPC/events/animals +0; World Coverage unchanged; assets/dialogue/ADR +0. Player-visible gameplay delta: none.',
  '- Next safe step: refresh `main`, this handoff and open ownership again. Do not overlap PR #225/#222/#214; select the next unowned high-value item under the now-current governance rather than reviving stale Run313.',
].join('\n') + '\n';

const stableBlock = [
  '',
  '- `stable-2026-08-12-run314` — Run303 manual-dispatch capability removal; one security-sensitive trigger line removed under current owner-approved governance, runtime/product delta 0; pre-materialization Run314 + Run283 full chains PASS; materialized final head remains exact-head PR-gated.',
].join('\n') + '\n';

function appendOnce(file, marker, block) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) {
    console.log(`[materializeRun314Progress] already present: ${marker}`);
    return false;
  }
  const prefix = source.length === 0 || source.endsWith('\n') ? source : source + '\n';
  fs.writeFileSync(file, prefix + block, 'utf8');
  console.log(`[materializeRun314Progress] appended: ${marker}`);
  return true;
}

const progressChanged = appendOnce(progressPath, progressMarker, progressBlock);
const stableChanged = appendOnce(stablePath, stableMarker, stableBlock);
console.log(`[materializeRun314Progress] PASS: progressChanged=${progressChanged} stableChanged=${stableChanged}`);
