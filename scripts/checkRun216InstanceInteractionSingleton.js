#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'src', '3d', 'editor', 'EditorInstanceInteractionSingleton.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(source.includes("import { installEditorInstanceInteraction } from './EditorInstanceInteractionInstaller.js';"), 'singleton must delegate to the verified installer');
assert(source.includes('const activeByCanvas = new WeakMap();'), 'canvas ownership must use WeakMap');
assert(source.includes('if (current && current.disposed === false) return current.surface;'), 'duplicate install must reuse the active surface');
assert(source.includes('const pipeline = installEditorInstanceInteraction(options);'), 'first install must create exactly one interaction pipeline');
assert(source.includes('if (disposed) return;'), 'dispose must be idempotent');
assert(source.includes('pipeline.dispose();'), 'dispose must release the underlying pipeline');
assert(source.includes('if (active?.surface === surface) activeByCanvas.delete(canvas);'), 'dispose must release canvas ownership only for the active surface');
assert(source.includes('get: () => disposed'), 'registry state must track disposal live');
assert(source.includes('getSnapshot'), 'singleton must expose lifecycle state for diagnostics');
assert(!source.includes('window.__WESTEROS'), 'singleton foundation must not wire itself into live editor globals');
assert(!source.includes('addEventListener('), 'singleton wrapper must not add a second listener layer');

console.log('[checkRun216InstanceInteractionSingleton] PASS: canvas-singleton ownership, idempotent disposal and no-live-wiring contract verified');
