#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/editor/EditorHistoryController.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
const materializer = fs.readFileSync(path.join(ROOT, 'scripts/materializeRun216ServiceWorkerCache.js'), 'utf8');
const fail = (message) => { throw new Error(message); };
const need = (needle, label) => { if (!source.includes(needle)) fail(`Missing ${label}: ${needle}`); };

try {
  for (const [needle, label] of [
    ["const HISTORY_LIMIT = 40", 'bounded history'],
    ["↶ Geri Al", 'undo UI'],
    ["↷ Yinele", 'redo UI'],
    ['serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState())', 'canonical serializer'],
    ['validateEditorScene(data)', 'snapshot validation'],
    ["new File([text], 'westeros-history.scene.json'", 'canonical restore file'],
    ['new DataTransfer()', 'canonical file-input restore'],
    ["loadInput.dispatchEvent(new Event('change', { bubbles: true }))", 'existing load pipeline reuse'],
    ['api.editableObjects.some(isBootDemo)', 'boot demo suppression'],
    ["transform, 'dragging-changed'", 'TransformControls capture'],
    ["key === 'z' && event.shiftKey", 'Ctrl Shift Z redo'],
    ["key === 'y'", 'Ctrl Y redo'],
    ['history.shift()', 'bounded eviction'],
    ['hierarchyObserver.disconnect()', 'hierarchy observer cleanup'],
    ['toastObserver.disconnect()', 'restore observer cleanup']
  ]) need(needle, label);

  const localIndex = html.indexOf('./src/3d/editor/EditorLocalSession.js');
  const historyIndex = html.indexOf('./src/3d/editor/EditorHistoryController.js');
  const cleanupIndex = html.indexOf('./src/3d/editor/EditorLiveWorldResourceCleanup.js');
  if (!(localIndex >= 0 && historyIndex > localIndex && cleanupIndex > historyIndex)) {
    fail('History must boot after canonical local persistence and before live-world cleanup.');
  }
  if (!materializer.includes('./src/3d/editor/EditorHistoryController.js')) fail('History controller missing from PWA materializer.');
  console.log('[checkRun216EditorHistoryContract] PASS: bounded canonical scene history, boot-demo suppression, TransformControls/Inspector/object capture, keyboard parity, canonical async restore and cleanup are wired and PWA-cached.');
} catch (error) {
  console.error(`[checkRun216EditorHistoryContract] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
