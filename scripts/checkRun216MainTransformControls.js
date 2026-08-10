#!/usr/bin/env node
'use strict';

const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

const editor = read('src/3d/editor/worldEditor.js');
const scale = read('src/3d/editor/EditorScaleInputController.js');
const transform = read('src/3d/editor/EditorTransformControls.js');
const vendor = read('src/3d/vendor/three/addons/controls/TransformControls.js');
const sw = read('service-worker.js');

for (const needle of [
  'window.__WESTEROS_WORLD_EDITOR__ = Object.freeze({',
  "import('./EditorTransformControls.js')",
  'getSelectedObject: () => selectedObject',
  'orbitControls: controls'
]) requireText(editor, needle, 'editor bridge');

for (const needle of [
  'const MIN_EDITOR_SCALE = 0.001;',
  "listen(input, 'change', applyPreciseScale, true);",
  'event.stopImmediatePropagation();',
  'Math.max(MIN_EDITOR_SCALE, value)'
]) requireText(scale, needle, 'precise scale controller');

for (const needle of [
  "import { TransformControls } from 'three/addons/controls/TransformControls.js';",
  "transform.setMode('translate');",
  "transform.setSpace('world');",
  "transform.addEventListener('dragging-changed', onDraggingChanged);",
  'installEditorScaleInputController(api);'
]) requireText(transform, needle, 'TransformControls integration');

requireText(vendor, 'class TransformControls extends Object3D', 'vendored TransformControls');

for (const path of [
  './src/3d/editor/EditorScaleInputController.js',
  './src/3d/editor/EditorTransformControls.js',
  './src/3d/vendor/three/addons/controls/TransformControls.js'
]) requireText(sw, path, 'PWA shell');

console.log('PASS Run216 main TransformControls: bridge, 0.001 scale, controls, vendor and PWA contracts are present.');
