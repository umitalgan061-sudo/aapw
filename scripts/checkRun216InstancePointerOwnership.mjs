#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const sourcePath = path.join(ROOT, 'src', '3d', 'editor', 'EditorInstancePointerOwnership.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-pointer-ownership-'));
const modulePath = path.join(dir, 'EditorInstancePointerOwnership.mjs');
fs.copyFileSync(sourcePath, modulePath);
const { createEditorInstancePointerOwnership } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

let active = false;
let hitCalls = 0;
let hits = [];
const ownership = createEditorInstancePointerOwnership({
  getHits: () => { hitCalls += 1; return hits; },
  isActive: () => active
});
const primary = { button: 0, ctrlKey: false, metaKey: false, altKey: false };

assert.equal(ownership.ownsPointer(primary), false, 'empty inactive pointer must stay with legacy selection');
assert.equal(hitCalls, 1);
hits = [{ instanceId: 2 }];
assert.equal(ownership.ownsPointer(primary), true, 'instance hit must be owned by instance interaction');
active = true;
hits = [];
const beforeActive = hitCalls;
assert.equal(ownership.ownsPointer(primary), true, 'active instance edit must retain pointer ownership for gizmo/background pointerdown');
assert.equal(hitCalls, beforeActive, 'active edit must not require a second raycast');
assert.equal(ownership.ownsPointer({ ...primary, button: 2 }), false, 'right click must remain available');
assert.equal(ownership.ownsPointer({ ...primary, ctrlKey: true }), false, 'modified pointer must remain available');
assert.throws(() => createEditorInstancePointerOwnership({ getHits: null }), /getHits function is required/);
console.log('[checkRun216InstancePointerOwnership] PASS');
