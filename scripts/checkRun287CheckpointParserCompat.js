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
console.log('[checkRun287CheckpointParserCompat] PASS: legacy + current stable/perf run formats resolve to run282');
