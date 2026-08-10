#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RUN216_ROOT ? path.resolve(process.env.RUN216_ROOT) : path.resolve(__dirname, '..');
const EXPECTED_VENDOR_SHA = '1163078c49179a40d5a9d129c13d582e8369bf37';

function fail(message) {
  throw new Error(message);
}

function read(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) fail(`Missing ${relativePath}`);
  return fs.readFileSync(fullPath);
}

function text(relativePath) {
  return read(relativePath).toString('utf8');
}

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(buffer).digest('hex');
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) fail(`${label} missing: ${needle}`);
}

function forbidText(source, needle, label) {
  if (source.includes(needle)) fail(`${label} forbidden: ${needle}`);
}

function runSelfTest() {
  const fixture = Buffer.from('hello\n', 'utf8');
  const hash = gitBlobSha(fixture);
  if (hash !== 'ce013625030ba8dba906f756967f9e9ca394464a') fail(`git blob self-test drift: ${hash}`);
  let rejected = false;
  try {
    requireText('abc', 'xyz', 'fixture');
  } catch (error) {
    rejected = /fixture missing/.test(String(error.message));
  }
  if (!rejected) fail('missing-contract self-test did not reject');
  console.log('[checkRun216TransformControlsCoreContract] PASS: self-test');
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const vendor = read('src/3d/vendor/three/addons/controls/TransformControls.js');
  const vendorSha = gitBlobSha(vendor);
  if (vendorSha !== EXPECTED_VENDOR_SHA) fail(`Three.js r160 TransformControls SHA drift: ${vendorSha}`);

  const controller = text('src/3d/editor/EditorTransformControls.js');
  requireText(controller, "from 'three/addons/controls/TransformControls.js'", 'controller exact vendor import');
  requireText(controller, "key === 'w'", 'W translate binding');
  requireText(controller, "key === 'e'", 'E rotate binding');
  requireText(controller, "key === 'r'", 'R scale binding');
  requireText(controller, "transform.setMode('translate')", 'translate mode');
  requireText(controller, "transform.setMode('rotate')", 'rotate mode');
  requireText(controller, "transform.setMode('scale')", 'scale mode');
  requireText(controller, 'Math.PI / 12', '15 degree rotation snap');
  requireText(controller, 'const SCALE_SNAP = 0.1', 'scale snap');
  requireText(controller, 'state.snapSize', 'editor translation snap ownership');
  requireText(controller, "transform.addEventListener('dragging-changed'", 'Orbit drag lock event');
  requireText(controller, 'selectionObserver.disconnect()', 'selection observer cleanup');
  requireText(controller, 'transform.dispose()', 'TransformControls cleanup');
  requireText(controller, "listen(window, 'pagehide', dispose, { once: true })", 'pagehide cleanup');
  forbidText(controller, 'Math.random()', 'controller determinism');
  forbidText(controller, 'WORKAROUND', 'controller governance');
  forbidText(controller, 'FIXME', 'controller governance');
  forbidText(controller, 'HACK', 'controller governance');

  const editor = text('src/3d/editor/worldEditor.js');
  requireText(editor, 'window.__WESTEROS_WORLD_EDITOR__ = Object.freeze({', 'editor ownership bridge');
  requireText(editor, 'getSelectedObject: () => selectedObject', 'selection ownership bridge');
  requireText(editor, 'getEditorState: editorState', 'snap ownership bridge');
  requireText(editor, "import('./EditorTransformControls.js')", 'controller boot');
  requireText(editor, 'installEditorTransformControls(window.__WESTEROS_WORLD_EDITOR__)', 'controller install');

  const browserProof = text('scripts/checkRun216WorldEditorTransformControls.js');
  for (const marker of ['desktop-transform-near.png', 'desktop-transform-far.png', 'mobile-transform-controls.png']) {
    requireText(browserProof, marker, 'visual proof contract');
  }
  requireText(browserProof, "[['e','rotate'],['r','scale'],['w','translate']]", 'browser W/E/R proof');
  requireText(browserProof, 'snap.translationSnap === 1', 'browser 1m snap proof');
  requireText(browserProof, 'errors.length === 0', 'browser console cleanliness proof');

  const materializer = text('scripts/materializeRun216TransformControls.js');
  requireText(materializer, EXPECTED_VENDOR_SHA, 'materializer upstream pin');
  requireText(materializer, "flag: 'wx'", 'materializer non-overwrite policy');

  console.log(`[checkRun216TransformControlsCoreContract] PASS: exact r160 ${vendorSha}; controller + bridge + desktop/mobile proof contracts intact`);
}

try {
  main();
} catch (error) {
  console.error(`[checkRun216TransformControlsCoreContract] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
