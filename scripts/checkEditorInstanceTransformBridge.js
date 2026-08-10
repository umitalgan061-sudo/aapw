#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const source = path.join(root, 'src', '3d', 'editor', 'EditorInstanceTransformBridge.js');
  if (!fs.existsSync(source)) throw new Error('EditorInstanceTransformBridge.js missing');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-instance-transform-bridge-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
    fs.copyFileSync(source, path.join(tempDir, 'EditorInstanceTransformBridge.js'));
    const api = await import(`${pathToFileURL(path.join(tempDir, 'EditorInstanceTransformBridge.js')).href}?run216=${Date.now()}`);
    assert(typeof api.createEditorInstanceTransformBridge === 'function', 'bridge factory missing');

    const listeners = new Map();
    const transform = {
      object: null,
      attach(value) { this.object = value; },
      detach() { this.object = null; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); }
    };

    let beginCount = 0;
    let commitCount = 0;
    let endCount = 0;
    const proxies = [{ id: 'proxy-a' }, { id: 'proxy-b' }];
    const ended = [];
    const bridge = api.createEditorInstanceTransformBridge({
      transformSurface: { transform },
      beginEdit(hit) {
        if (!hit) return null;
        return { active: true, session: { proxy: proxies[beginCount++] } };
      },
      commitEdit(coordinator) {
        commitCount += 1;
        return coordinator.session.proxy.id;
      },
      endEdit(coordinator) {
        endCount += 1;
        coordinator.active = false;
        ended.push(coordinator.session.proxy.id);
        return coordinator.session.proxy;
      }
    });

    assert(bridge.begin(null) === null, 'empty begin must be a no-op');
    const first = bridge.begin('hit-a');
    assert(first.session.proxy === proxies[0] && transform.object === proxies[0], 'first proxy attach drift');
    listeners.get('objectChange')();
    assert(commitCount === 1, 'objectChange must commit the active instance proxy');

    bridge.begin('hit-b');
    assert(endCount === 1 && ended[0] === 'proxy-a', 'replacement must end the previous coordinator');
    assert(transform.object === proxies[1], 'replacement proxy attach drift');

    transform.object = { id: 'foreign-object' };
    listeners.get('objectChange')();
    assert(commitCount === 1, 'foreign TransformControls object must not commit instance state');

    transform.object = proxies[1];
    assert(bridge.commit() === 'proxy-b' && commitCount === 2, 'explicit commit drift');
    const snapshot = bridge.getSnapshot();
    assert(snapshot.active && snapshot.attached && !snapshot.disposed, 'active bridge snapshot drift');

    bridge.dispose();
    assert(endCount === 2 && ended[1] === 'proxy-b', 'dispose must end the active coordinator');
    assert(transform.object === null, 'dispose must detach the active instance proxy');
    assert(listeners.size === 0, 'dispose must remove TransformControls listeners');

    let rejected = false;
    try { bridge.begin('late-hit'); } catch (error) { rejected = /disposed/.test(String(error.message)); }
    assert(rejected, 'disposed bridge must reject new edit sessions');
    console.log('[checkEditorInstanceTransformBridge] PASS: attach, commit, replacement, foreign-object guard and dispose lifecycle verified');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[checkEditorInstanceTransformBridge] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
