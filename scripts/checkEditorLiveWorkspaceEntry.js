#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createEditorLiveServer } = require('./editorLiveServer.js');

const ROOT = path.resolve(__dirname, '..');
const assert = (value, message) => { if (!value) throw new Error(message); };

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

function staticContract() {
  const edit = fs.readFileSync(path.join(ROOT, 'edit.html'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'scripts', 'editorLiveServer.js'), 'utf8');
  for (const token of [
    './editor.html?liveWorkspace=1',
    'CANLI OYUN',
    'DÜZENLEME',
    'YAN YANA',
    './game3d.html?editorPreview=1',
    '/__editor/models',
    '/__editor/save',
    'Koda Kaydet',
    'FBX / GLB / GLTF ara',
    '__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__',
  ]) assert(edit.includes(token), `edit.html contract missing: ${token}`);
  for (const token of ['/__editor/health', '/__editor/models', '/__editor/save', "MODEL_EXTENSIONS = new Set(['.fbx', '.glb', '.gltf'])"]) {
    assert(server.includes(token), `editorLiveServer contract missing: ${token}`);
  }
  return true;
}

async function browserContract() {
  const playwright = playwrightModule();
  if (!playwright) throw new Error('Playwright unavailable');
  const server = createEditorLiveServer({ root: ROOT });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(`http://127.0.0.1:${port}/edit.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 180000 });
    const proof = await page.evaluate(() => {
      const frame = document.getElementById('we-live-host');
      const win = frame?.contentWindow;
      const doc = frame?.contentDocument;
      const surface = win?.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__;
      const snapshot = surface?.getSnapshot?.();
      const buttons = [...(doc?.querySelectorAll('#we-live-workspace-modes [data-mode]') || [])].map((button) => button.textContent);
      return {
        snapshot,
        buttons,
        catalogStatus: doc?.querySelector('#we-live-workspace-catalog-status')?.textContent || '',
        saveButton: doc?.getElementById('we-save-to-code')?.textContent || '',
        liveIframeSrc: doc?.getElementById('we-live-game-preview-v2')?.getAttribute('src') || '',
        editorReady: Boolean(win?.__WESTEROS_WORLD_EDITOR__?.scene),
        authoringReady: Boolean(win?.__WESTEROS_EDITOR_LIVE_AUTHORING__?.placeAssetAtTarget),
      };
    });
    assert(proof.editorReady, 'canonical editor did not load');
    assert(proof.authoringReady, 'live authoring surface did not load');
    assert(proof.snapshot?.canonicalEditorLoaded === true, 'workspace does not own canonical editor');
    assert(proof.snapshot?.currentMode === 'live', `default mode is not live: ${proof.snapshot?.currentMode}`);
    assert(proof.snapshot?.gamePreviewLoaded === true, 'game3d live preview iframe missing');
    assert(proof.snapshot?.catalogCount > 0, `model catalog empty: ${JSON.stringify(proof.snapshot)}`);
    assert(proof.buttons.join('|') === 'DÜZENLEME|CANLI OYUN|YAN YANA', `mode buttons drifted: ${proof.buttons.join('|')}`);
    assert(proof.saveButton === 'Koda Kaydet', `save bridge button missing: ${proof.saveButton}`);
    assert(proof.liveIframeSrc.includes('game3d.html?editorPreview=1'), `live iframe source drifted: ${proof.liveIframeSrc}`);

    for (const mode of ['edit', 'split', 'live']) {
      const result = await page.evaluate((nextMode) => {
        const win = document.getElementById('we-live-host')?.contentWindow;
        const surface = win?.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__;
        surface?.setMode?.(nextMode);
        return surface?.getSnapshot?.();
      }, mode);
      assert(result?.currentMode === mode, `mode switch failed: ${mode}`);
    }
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    console.log(`[checkEditorLiveWorkspaceEntry] PROOF ${JSON.stringify(proof)}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  staticContract();
  if (process.argv.includes('--browser')) await browserContract();
  console.log('[checkEditorLiveWorkspaceEntry] PASS');
}

main().catch((error) => {
  console.error(`[checkEditorLiveWorkspaceEntry] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
