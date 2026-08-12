#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const progressPath = path.join(ROOT, '3D_GAME_PROGRESS.md');
const stablePath = path.join(ROOT, 'STABLE_TAGS.md');

const progressMarker = '## Run 313 — Run303 manual-dispatch fail-closed guard + SSOT catch-up';
const stableMarker = 'stable-2026-08-12-run313';

const progressBlock = [
  '',
  progressMarker,
  '- Session snapshot refreshed from exact start main `fd11b1024570cc3b725a4ad9d4ec8bf98f95f855`; GOVERNANCE §8.14 concurrency was rechecked before branch creation and before the record materialization stage. Terrain PR #222 and the stale/draft RTS proof PR #214 remain owner-occupied areas and were not modified.',
  '- SSOT audit: the last direct `3D_GAME_PROGRESS.md` run entry on the ancestry is Run296 (`213face9edb0369867e30c9dc1c20fd5d4abe13b`). Comparing that checkpoint to the Run313 start main shows main is 10 commits ahead. This entry restores a current handoff without inventing missing historical run narratives.',
  '- Verified catch-up boundary: `d90939ac8d1eae7f327201576ba8f79507e96cce` made the prepared Pindex-01..09 semantic/micro-detail layer visibly affect shipped 3D terrain; `fd11b1024570cc3b725a4ad9d4ec8bf98f95f855` is the current Run312 RTS feedback-transition successor merge. Run296 had left Pindex-10 as the final explicit next pindex step.',
  '- Governance safety fix: `.github/workflows/run303-run216-complete-marker-prefix.yml` now fails closed on every ref except `refs/heads/agent/run303-run216-complete-marker-prefix` before checkout or any repository write-capable step. Manual dispatch from `main`, Run313, or a tag therefore cannot advance/recreate the historical Run303 branch.',
  '- Future-PR safety: Run313 validation uses the live `pull_request.base.sha`, checks out the exact PR head, keeps `contents: read`, and applies Run313 historical path-isolation only to non-PR branch runs after generic exact-main/additive/diff checks. This locks the two P1 lessons found during the abandoned Run305 attempt.',
  '- Pre-materialization exact head `5e295f533425571db031024bc8a5fbd7cdec30e2`: Run313 full chain PASS and independent Run283 Final Head Governance full chain PASS, including PWA/cache/installability, determinism/world-reference, mobile performance, terrain/road safety, technical debt, full Chromium smoke and final exact-main/additive concurrency gates. The materialized head must rerun the same exact-head gates before merge.',
  '- `perf_log.csv` gains a fresh real-frame `run313-run303-dispatch-safety` sample through `collectPerfSnapshot.js`; no production runtime, gameplay, Pindex, RTS, service-worker payload, or Godot terrain-authoring behavior is changed by Run313.',
  '- World Evolution Report: road km +0; forest km² +0; castles/NPC/events/animals +0; World Coverage unchanged; assets/dialogue/ADR +0. Player-visible gameplay delta: none. Technical debt introduced: 0. Risk: LOW. Confidence: 5/5.',
  '- Next safe step: refresh `main`, open PR ownership and this handoff again. Pindex-10 remains the last explicit Run296 product successor, but only start it if its files are still unowned; do not overlap Terrain Polish PR #222 or the draft RTS proof PR #214.',
].join('\n') + '\n';

const stableBlock = [
  '',
  '- `stable-2026-08-12-run313` — Run303 manual-dispatch fail-closed guard + SSOT catch-up; governance/test/docs/perf-log only, runtime/product delta 0; pre-materialization Run313 and Run283 full chains PASS; final materialized head remains exact-head merge-gated.',
].join('\n') + '\n';

function appendOnce(file, marker, block) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) {
    console.log(`[materializeRun313Progress] already present: ${marker}`);
    return false;
  }
  const prefix = source.length === 0 || source.endsWith('\n') ? source : source + '\n';
  fs.writeFileSync(file, prefix + block, 'utf8');
  console.log(`[materializeRun313Progress] appended: ${marker}`);
  return true;
}

const progressChanged = appendOnce(progressPath, progressMarker, progressBlock);
const stableChanged = appendOnce(stablePath, stableMarker, stableBlock);
console.log(`[materializeRun313Progress] PASS: progressChanged=${progressChanged} stableChanged=${stableChanged}`);
