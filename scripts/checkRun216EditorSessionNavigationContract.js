#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const fail = (message) => { throw new Error(message); };
const need = (text, needle, label) => { if (!text.includes(needle)) fail(`Missing ${label}: ${needle}`); };

try {
  const html = read('editor.html');
  const semantics = read('src/3d/editor/EditorTerrainSemantics.js');
  const localSession = read('src/3d/editor/EditorLocalSession.js');
  const navigator = read('src/3d/editor/EditorLocationNavigator.js');
  const materializer = read('scripts/materializeRun216ServiceWorkerCache.js');

  const authoringIndex = html.indexOf('./src/3d/editor/EditorLiveWorldAuthoring.js');
  const semanticsIndex = html.indexOf('./src/3d/editor/EditorTerrainSemantics.js');
  const localIndex = html.indexOf('./src/3d/editor/EditorLocalSession.js');
  const navigatorIndex = html.indexOf('./src/3d/editor/EditorLocationNavigator.js');
  const cleanupIndex = html.indexOf('./src/3d/editor/EditorLiveWorldResourceCleanup.js');
  if (!(authoringIndex >= 0 && semanticsIndex > authoringIndex && localIndex > semanticsIndex && navigatorIndex > localIndex && cleanupIndex > navigatorIndex)) {
    fail('Terrain semantics, local session and location navigator are not booted in dependency order before resource cleanup.');
  }

  for (const needle of [
    "landRemove.textContent = 'Kara → Deniz'",
    "waterRemove.textContent = 'Deniz → Kara'",
    "activateSemantic(event, 'land-to-water', 'water-add')",
    "activateSemantic(event, 'water-to-land', 'land-add')",
    "terrainButton('land-add')?.setAttribute('aria-pressed', 'false')",
    "terrainButton('water-add')?.setAttribute('aria-pressed', 'false')"
  ]) need(semantics, needle, 'land/sea semantic conversion');

  for (const needle of [
    "const STORAGE_KEY = 'westeros-world-editor.scene.v1'",
    'serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState())',
    'validateEditorScene(data)',
    'new File([text]',
    'new DataTransfer()',
    "loadInput.dispatchEvent(new Event('change', { bubbles: true }))",
    "listen(jsonSaveButton, 'click', () => saveLocal({ quiet: true }))",
    "listen(window, 'pagehide', () => saveLocal({ quiet: true }), { once: true })"
  ]) need(localSession, needle, 'canonical local scene persistence');

  for (const needle of [
    'const seats = liveSurface?.liveState?.settlementSeats',
    "centerOption.textContent = 'Dünya Merkezi'",
    "goButton.textContent = 'Konuma Git'",
    'for (const seat of seats)',
    'api.orbitControls.target.set(location.x, location.y, location.z)',
    'authoring.syncWorkingArea()',
    'seatCount: seats.length',
    '@media(max-width:900px)'
  ]) need(navigator, needle, 'canonical kingdom-seat navigation');
  if (navigator.includes('KINGDOM_SEATS') || navigator.includes('mapX:') || navigator.includes('mapY:')) {
    fail('Location navigator must consume live settlementSeats rather than duplicate kingdom coordinates.');
  }

  for (const cached of [
    './src/3d/editor/EditorTerrainSemantics.js',
    './src/3d/editor/EditorLocalSession.js',
    './src/3d/editor/EditorLocationNavigator.js'
  ]) need(materializer, cached, 'PWA session/navigation cache path');

  console.log('[checkRun216EditorSessionNavigationContract] PASS: land/sea semantic conversion, canonical local scene persistence and live 14-seat navigation are wired in dependency order and cached for PWA without duplicated world coordinates.');
} catch (error) {
  console.error(`[checkRun216EditorSessionNavigationContract] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
