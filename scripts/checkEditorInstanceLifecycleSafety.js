#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const source = path.join(root, 'src', '3d', 'editor', 'EditorInstanceLifecycleSafety.js');
  if (!fs.existsSync(source)) throw new Error('EditorInstanceLifecycleSafety.js missing');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-instance-lifecycle-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
    fs.copyFileSync(source, path.join(tempDir, 'EditorInstanceLifecycleSafety.js'));
    const api = await import(`${pathToFileURL(path.join(tempDir, 'EditorInstanceLifecycleSafety.js')).href}?run216=${Date.now()}`);

    const proxy = { id: 'proxy-a' };
    const success = { active: true, session: { proxy } };
    let removed = null;
    const returned = api.endEditorInstanceEditFailureSafe({ remove(value) { removed = value; } }, success, (session) => {
      const value = session.proxy;
      session.proxy = null;
      return value;
    });
    assert(returned === proxy && removed === proxy && success.active === false && success.session.proxy === null, 'normal finalization drift');

    const removeFailure = { active: true, session: { proxy: { id: 'proxy-b' } } };
    let removeThrew = false;
    try {
      api.endEditorInstanceEditFailureSafe({ remove() { throw new Error('scene remove failed'); } }, removeFailure, (session) => {
        const value = session.proxy;
        session.proxy = null;
        return value;
      });
    } catch (error) {
      removeThrew = /scene remove failed/.test(String(error.message));
    }
    assert(removeThrew && removeFailure.active === false && removeFailure.session.proxy === null, 'scene.remove failure must still deactivate coordinator');

    const endFailure = { active: true, session: { proxy: { id: 'proxy-c' } } };
    let removeCalls = 0;
    let endThrew = false;
    try {
      api.endEditorInstanceEditFailureSafe({ remove() { removeCalls += 1; } }, endFailure, () => { throw new Error('end session failed'); });
    } catch (error) {
      endThrew = /end session failed/.test(String(error.message));
    }
    assert(endThrew && endFailure.active === false && removeCalls === 0, 'endSession failure must deactivate without unsafe remove');

    assert(api.endEditorInstanceEditFailureSafe({ remove() {} }, null, () => null) === null, 'null coordinator should be a no-op');
    console.log('[checkEditorInstanceLifecycleSafety] PASS: normal cleanup and failure-safe coordinator deactivation verified');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[checkEditorInstanceLifecycleSafety] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
