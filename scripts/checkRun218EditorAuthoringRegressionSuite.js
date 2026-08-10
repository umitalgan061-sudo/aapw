#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const checks = [
  ['visible aurora + bright authoring browser proof', 'scripts/checkRun216EditorVisibleAuroraBrowser.js'],
  ['edit-mode fog contract', 'scripts/checkRun216EditModeFog.mjs'],
  ['scale-input precision contract', 'scripts/checkRun216ScaleInputPrecision.js'],
  ['scale-input behavior contract', 'scripts/checkRun216ScaleInputBehavior.js'],
  ['clipboard wiring contract', 'scripts/checkRun216EditorClipboardWiring.js'],
  ['instance editing safety suite', 'scripts/checkRun216InstanceEditingSafetySuite.js']
];

for (const [label, script] of checks) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    console.error(`[checkRun218EditorAuthoringRegressionSuite] FAIL ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[checkRun218EditorAuthoringRegressionSuite] FAIL ${label}: exit ${result.status}`);
    process.exit(result.status || 1);
  }
  console.log(`[checkRun218EditorAuthoringRegressionSuite] PASS ${label}`);
}

console.log(`[checkRun218EditorAuthoringRegressionSuite] PASS all ${checks.length} editor authoring regressions`);
