#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const source = path.join(root, 'src', '3d', 'editor', 'EditorInstancePointerController.js');
  if (!fs.existsSync(source)) throw new Error('EditorInstancePointerController.js missing');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-instance-pointer-controller-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
    fs.copyFileSync(source, path.join(tempDir, 'EditorInstancePointerController.js'));
    const api = await import(`${pathToFileURL(path.join(tempDir, 'EditorInstancePointerController.js')).href}?run216=${Date.now()}`);
    assert(typeof api.createEditorInstancePointerController === 'function', 'pointer controller factory missing');

    const listeners = new Map();
    const canvas = {
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); }
    };

    let starts = 0;
    let blocked = false;
    let hits = [{ instanceId: 'formation:0' }];
    let lastEvent = null;
    const controller = api.createEditorInstancePointerController({
      canvas,
      getHits() { return hits; },
      begin(value, event) {
        starts += 1;
        assert(value === hits, 'pointer controller must preserve hit ordering and identity');
        lastEvent = event;
      },
      isBlocked() { return blocked; }
    });

    const fire = (patch = {}) => listeners.get('pointerdown')({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      pointerType: 'mouse',
      ...patch
    });

    fire();
    assert(starts === 1 && lastEvent.pointerType === 'mouse', 'primary pointer must start instance edit');
    fire({ button: 2 });
    fire({ ctrlKey: true });
    fire({ metaKey: true });
    fire({ altKey: true });
    assert(starts === 1, 'secondary or modified pointer must be ignored');

    blocked = true;
    fire();
    assert(starts === 1, 'blocked pointer state must not start instance edit');
    blocked = false;
    hits = [];
    fire();
    assert(starts === 1, 'empty raycast hits must be a no-op');

    hits = [{ instanceId: 'formation:1' }];
    fire({ pointerType: 'touch' });
    assert(starts === 2 && lastEvent.pointerType === 'touch', 'touch primary pointer must share deterministic begin path');

    controller.dispose();
    assert(controller.isDisposed(), 'dispose state missing');
    assert(listeners.size === 0, 'dispose must remove pointer listener');
    console.log('[checkEditorInstancePointerController] PASS: primary mouse/touch routing, modifier/block guards, empty-hit no-op and dispose cleanup verified');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[checkEditorInstancePointerController] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
