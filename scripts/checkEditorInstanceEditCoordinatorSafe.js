#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const sourceDir = path.join(root, 'src', '3d', 'editor');
  const names = [
    'EditorInstanceEditCoordinatorSafe.js',
    'EditorInstanceEditCoordinator.js',
    'EditorInstanceLifecycleSafety.js',
    'EditorInstanceEditSession.js',
    'EditorInstanceEditOperations.js',
    'EditorInstancePickingModel.js',
    'EditorInstanceSelectionModel.js',
    'EditorInstanceTransformProxy.js',
    'EditorInstanceRenderAdapter.js',
    'EditorInstanceBoundsSafety.js'
  ];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-safe-coordinator-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
    for (const name of names) {
      const source = path.join(sourceDir, name);
      if (!fs.existsSync(source)) throw new Error(`safe coordinator dependency missing: ${name}`);
      fs.copyFileSync(source, path.join(tempDir, name));
    }
    const api = await import(`${pathToFileURL(path.join(tempDir, 'EditorInstanceEditCoordinatorSafe.js')).href}?run216=${Date.now()}`);
    assert(typeof api.beginEditorInstanceEditFromHits === 'function', 'begin API missing');
    assert(typeof api.commitEditorInstanceEdit === 'function', 'commit API missing');
    assert(typeof api.endEditorInstanceEditSafe === 'function', 'safe end API missing');

    const proxy = { id: 'proxy-safe' };
    const coordinator = { active: true, session: { proxy, selection: { id: 'selection' } } };
    let removed = null;
    const returned = api.endEditorInstanceEditSafe({ remove(value) { removed = value; } }, coordinator);
    assert(returned === proxy && removed === proxy, 'safe facade normal removal drift');
    assert(coordinator.active === false && coordinator.session.proxy === null && coordinator.session.selection === null, 'safe facade normal cleanup drift');

    const failing = { active: true, session: { proxy: { id: 'proxy-fail' }, selection: { id: 'selection' } } };
    let failed = false;
    try {
      api.endEditorInstanceEditSafe({ remove() { throw new Error('remove boom'); } }, failing);
    } catch (error) {
      failed = /remove boom/.test(String(error.message));
    }
    assert(failed, 'safe facade must rethrow scene removal failure');
    assert(failing.active === false && failing.session.proxy === null && failing.session.selection === null, 'safe facade must deactivate and clear ended session on removal failure');
    console.log('[checkEditorInstanceEditCoordinatorSafe] PASS: safe coordinator facade preserves APIs and failure-safe cleanup');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[checkEditorInstanceEditCoordinatorSafe] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
