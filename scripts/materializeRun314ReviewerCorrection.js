#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const progressPath = path.join(ROOT, '3D_GAME_PROGRESS.md');
const stablePath = path.join(ROOT, 'STABLE_TAGS.md');

const progressMarker = '### Run 314 reviewer correction — retire old workflow identity';
const stableMarker = 'stable-2026-08-12-run314-reviewer-correction';

const progressBlock = [
  '',
  progressMarker,
  '- Supersedes the earlier Run314 wording that described the old Run303 workflow as merely having `workflow_dispatch` removed. Codex review on PR #229 correctly identified that an older ref could still contain the historical workflow path with its pre-removal manual-dispatch definition.',
  '- Final capability fix: the default-branch workflow identity `.github/workflows/run303-run216-complete-marker-prefix.yml` is retired/deleted, so that historical dispatch-capable identity is no longer registered by the current default-branch tree.',
  '- A new identity, `.github/workflows/run314-run216-complete-marker-prefix-push-only.yml`, preserves only the narrow repair path: push trigger on `agent/run303-run216-complete-marker-prefix`, path filter on its own new workflow file, `contents: write`, and a source-ref fail-closed guard before checkout. It exposes neither `workflow_dispatch` nor `repository_dispatch`.',
  '- `checkRun314Run303ManualDispatchRemoved.js` now scans all current workflow files: the old identity must be absent, no dispatch-capable workflow may reference the historical Run303 branch, and the hard-coded historical branch write target must belong only to the new guarded push-only workflow.',
  '- This reviewer correction changes no runtime/gameplay/PWA payload, produces no second performance sample, and leaves the existing Run314 `perf_log.csv` row unchanged. Final publication still requires a fresh exact-head Run314/Run283/full PR gate rerun and a clean automated re-review.',
].join('\n') + '\n';

const stableBlock = [
  '',
  '- `stable-2026-08-12-run314-reviewer-correction` — supersedes the initial Run314 checkpoint wording: historical dispatch-capable Run303 workflow identity retired; new guarded push-only workflow identity introduced; existing Run314 perf sample unchanged; final exact-head PR gates/re-review still required.',
].join('\n') + '\n';

function appendOnce(file, marker, block) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) {
    console.log(`[materializeRun314ReviewerCorrection] already present: ${marker}`);
    return false;
  }
  const prefix = source.length === 0 || source.endsWith('\n') ? source : source + '\n';
  fs.writeFileSync(file, prefix + block, 'utf8');
  console.log(`[materializeRun314ReviewerCorrection] appended: ${marker}`);
  return true;
}

const progressChanged = appendOnce(progressPath, progressMarker, progressBlock);
const stableChanged = appendOnce(stablePath, stableMarker, stableBlock);
console.log(`[materializeRun314ReviewerCorrection] PASS: progressChanged=${progressChanged} stableChanged=${stableChanged}`);
