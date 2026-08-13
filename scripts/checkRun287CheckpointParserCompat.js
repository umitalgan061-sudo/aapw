#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('scripts/checkCheckpointConsistency.js', 'utf8').replace(/\nmain\(\);\n/, '\n');
const sandbox = { console, process: { exit() { throw new Error('unexpected exit'); } }, require, __dirname: require('path').resolve('scripts') };
vm.runInNewContext(source, sandbox, { filename: 'checkCheckpointConsistency.js' });

const stable = [
  'stable-2026-08-01-1000 — Run200 legacy checkpoint',
  '- `stable-2026-08-11-run281` — Pindex-03',
  '- `stable-2026-08-11-run282` — Pindex-04',
].join('\n');
const perf = [
  'run,date,scope',
  'legacy,run206,old-shape',
  'run281,2026-08-11,pindex03',
  'run282,2026-08-11,pindex04',
].join('\n');
if (sandbox.maxRunFromStableTags(stable) !== 282) throw new Error('current Markdown stable tag format not parsed');
if (sandbox.maxRunFromPerfCsv(perf) !== 282) throw new Error('current first-column perf run format not parsed');

const progressWithExplicitNonCheckpoints = [
  '## Run 322 — completed checkpoint',
  '- Full DoD and checkpoint records completed.',
  '',
  '## Run 323 — documentation-only audit entry',
  '- Runtime/product source delta: 0; no smoke-test/perf-log entry needed.',
  '',
  '## Run 324 — partial validation entry',
  '- **Not run, explicitly:** Godot headless import and browser smoke.',
].join('\n');
if (sandbox.maxRunFromProgress(progressWithExplicitNonCheckpoints) !== 322) {
  throw new Error('explicitly non-checkpoint progress sections advanced the completed-run watermark');
}

const progressWithLaterCompletedRun = [
  progressWithExplicitNonCheckpoints,
  '',
  '## Run 325 — completed checkpoint',
  '- Full DoD PASS; stable and performance records emitted.',
].join('\n');
if (sandbox.maxRunFromProgress(progressWithLaterCompletedRun) !== 325) {
  throw new Error('a later completed progress section did not advance the completed-run watermark');
}

console.log('[checkRun287CheckpointParserCompat] PASS: legacy/current stable+perf formats and explicit non-checkpoint progress sections are parsed safely');

const progressWithNoCodeCollision = [
  '## Run 327 — completed checkpoint',
  '- Full DoD PASS; stable and performance records emitted.',
  '',
  '## Run 328 — concurrency collision; no code shipped',
  '- No code shipped; duplicate local work discarded after another session published first.',
].join('\n');
if (sandbox.maxRunFromProgress(progressWithNoCodeCollision) !== 327) {
  throw new Error('no-code collision progress section advanced the completed-run watermark');
}

const stableWithNoCodeCollision = [
  '- `stable-2026-08-13-run327` — completed checkpoint',
  '- `stable-2026-08-13-run328` — no code shipped; verification + concurrency-collision handling run.',
].join('\n');
if (sandbox.maxRunFromStableTags(stableWithNoCodeCollision) !== 327) {
  throw new Error('no-code collision stable note advanced the completed-run watermark');
}

console.log('[checkRun287CheckpointParserCompat] PASS: explicit no-code collision records remain off the completed-run watermark');

const progressWithHeadingOnlyNoCodeCollision = [
  '## Run 327 — completed checkpoint',
  '- Full DoD PASS; stable and performance records emitted.',
  '',
  '## Run 328 (scheduled run) — concurrency collision; no code shipped',
  '- Duplicate work was discarded after another session published first.',
  '- Priority re-scan completed; repository history remains unchanged.',
].join('\n');
if (sandbox.maxRunFromProgress(progressWithHeadingOnlyNoCodeCollision) !== 327) {
  throw new Error('heading-only no-code collision advanced the completed-run watermark');
}

console.log('[checkRun287CheckpointParserCompat] PASS: heading-only non-checkpoint reasons are parsed with their progress section');
