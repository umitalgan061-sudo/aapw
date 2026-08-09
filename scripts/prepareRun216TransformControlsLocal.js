#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_VENDOR_SHA = '1163078c49179a40d5a9d129c13d582e8369bf37';
const REQUIRED_CHECKS = Object.freeze([
  'src/3d/vendor/three/addons/controls/TransformControls.js',
  'src/3d/editor/EditorTransformControls.js',
  'src/3d/editor/worldEditor.js',
  'service-worker.js',
  'scripts/materializeRun216TransformControls.js',
  'scripts/materializeRun216ServiceWorkerCache.js',
  'scripts/checkRun216TransformControlsCoreContract.js',
  'scripts/checkRun216ServiceWorkerMaterializer.js',
  'scripts/checkRun216WorldEditorTransformControls.js',
  'scripts/prepareRun216TransformControlsLocal.js'
]);

function fail(message) {
  throw new Error(message);
}

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(buffer).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout || ''}${result.stderr || ''}` : '';
    fail(`${command} ${args.join(' ')} failed with exit ${result.status}${details}`);
  }
  return result;
}

function verifyVendor() {
  const file = path.join(ROOT, 'src/3d/vendor/three/addons/controls/TransformControls.js');
  if (!fs.existsSync(file)) fail('Exact r160 TransformControls vendor file is missing. Run materializeRun216TransformControls.js on a networked checkout first.');
  const actual = gitBlobSha(fs.readFileSync(file));
  if (actual !== EXPECTED_VENDOR_SHA) fail(`TransformControls vendor SHA drift: ${actual}`);
  console.log(`[prepareRun216TransformControlsLocal] vendor PASS ${actual}`);
}

function checkSyntax() {
  for (const relative of REQUIRED_CHECKS) {
    run(process.execPath, ['--check', relative]);
  }
  console.log(`[prepareRun216TransformControlsLocal] syntax PASS ${REQUIRED_CHECKS.length} JS files`);
}

function verifyWorkingTreeAdditiveServiceWorker() {
  const result = run('git', ['diff', '--numstat', '--', 'service-worker.js'], { capture: true });
  const output = (result.stdout || '').trim();
  if (!output) {
    console.log('[prepareRun216TransformControlsLocal] service-worker working tree unchanged (already materialized in HEAD)');
    return;
  }
  const fields = output.split(/\s+/);
  if (fields.length < 3) fail(`Unexpected git diff --numstat output: ${output}`);
  const additions = Number(fields[0]);
  const deletions = Number(fields[1]);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) fail(`Non-numeric service-worker diff: ${output}`);
  if (deletions !== 0) fail(`service-worker materialization is not additive-only: ${output}`);
  console.log(`[prepareRun216TransformControlsLocal] service-worker additive PASS +${additions}/-${deletions}`);
}

function runSelfTest() {
  const fixture = Buffer.from('hello\n', 'utf8');
  const hash = gitBlobSha(fixture);
  if (hash !== 'ce013625030ba8dba906f756967f9e9ca394464a') fail(`Git blob self-test drift: ${hash}`);
  if (!REQUIRED_CHECKS.includes('service-worker.js')) fail('Self-test missing service-worker syntax gate');
  if (!REQUIRED_CHECKS.includes('scripts/checkRun216WorldEditorTransformControls.js')) fail('Self-test missing browser proof syntax gate');
  if (!REQUIRED_CHECKS.includes('scripts/checkRun216ServiceWorkerMaterializer.js')) fail('Self-test missing real service-worker materializer regression gate');
  console.log('[prepareRun216TransformControlsLocal] PASS: self-test');
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) {
    runSelfTest();
    return;
  }

  verifyVendor();
  run(process.execPath, ['scripts/materializeRun216TransformControls.js', '--verify-only']);
  run(process.execPath, ['scripts/materializeRun216ServiceWorkerCache.js']);
  run(process.execPath, ['scripts/materializeRun216ServiceWorkerCache.js', '--verify-only']);
  checkSyntax();
  run(process.execPath, ['scripts/checkRun216TransformControlsCoreContract.js']);
  run(process.execPath, ['scripts/checkRun216ServiceWorkerMaterializer.js']);
  verifyWorkingTreeAdditiveServiceWorker();
  run('git', ['diff', '--check']);

  if (args.has('--browser')) {
    run(process.execPath, ['scripts/checkRun216WorldEditorTransformControls.js']);
  }

  console.log(`[prepareRun216TransformControlsLocal] PASS: offline-safe Run216 local preparation${args.has('--browser') ? ' + browser proof' : ''}`);
}

try {
  main();
} catch (error) {
  console.error(`[prepareRun216TransformControlsLocal] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
