#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'service-worker.js');
const ARRAY_MARKER = 'const GAME3D_SHELL_FILES = [\n';
const ENTRY = "    './src/3d/editor/EditorFallbackMaterialPalette.js',\n";

const before = fs.readFileSync(TARGET, 'utf8');
if (before.includes(ENTRY.trim())) {
  console.log('[materializeRun259FallbackPaletteServiceWorkerCache] PASS: cache entry already present');
  process.exit(0);
}
const markerIndex = before.indexOf(ARRAY_MARKER);
if (markerIndex < 0) throw new Error('GAME3D_SHELL_FILES array marker not found');
const insertAt = markerIndex + ARRAY_MARKER.length;
const after = before.slice(0, insertAt) + ENTRY + before.slice(insertAt);
fs.writeFileSync(TARGET, after);
const persisted = fs.readFileSync(TARGET, 'utf8');
if (persisted.slice(0, insertAt) !== before.slice(0, insertAt)) throw new Error('Bytes before insertion changed');
if (persisted.slice(insertAt + ENTRY.length) !== before.slice(insertAt)) throw new Error('Existing bytes after insertion changed');
if (!persisted.includes(ENTRY.trim())) throw new Error('Run259 cache entry missing after materialization');
console.log('[materializeRun259FallbackPaletteServiceWorkerCache] PASS: one additive GAME3D_SHELL_FILES entry inserted');
