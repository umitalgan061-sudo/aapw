#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const checks = [
  { label: 'visible aurora + bright authoring browser proof', script: 'scripts/checkRun216EditorVisibleAuroraBrowser.js', nodeArgs: [] },
  { label: 'edit-mode fog contract', script: 'scripts/checkRun216EditModeFog.mjs', nodeArgs: ['--experimental-vm-modules'] },
  { label: 'scale-input precision contract', script: 'scripts/checkRun216ScaleInputPrecision.js', nodeArgs: [] },
  { label: 'scale-input behavior contract', script: 'scripts/checkRun216ScaleInputBehavior.js', nodeArgs: [] },
  { label: 'clipboard wiring contract', script: 'scripts/checkRun216EditorClipboardWiring.js', nodeArgs: [] },
  { label: 'instance editing safety suite', script: 'scripts/checkRun216InstanceEditingSafetySuite.js', nodeArgs: [] }
];

for (const { label, script, nodeArgs } of checks) {
  const result = spawnSync(process.execPath, [...nodeArgs, path.join(ROOT, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    console.error(`[checkRun218EditorAuthoringRegressionSuiteV2] FAIL ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[checkRun218EditorAuthoringRegressionSuiteV2] FAIL ${label}: exit ${result.status}`);
    process.exit(result.status || 1);
  }
  console.log(`[checkRun218EditorAuthoringRegressionSuiteV2] PASS ${label}`);
}

console.log(`[checkRun218EditorAuthoringRegressionSuiteV2] PASS all ${checks.length} editor authoring regressions`);
