#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createEditorLiveServer } = require('./editorLiveServer.js');

const ROOT = path.resolve(__dirname, '..');
const assert = (value, message) => { if (!value) throw new Error(message); };
const CANONICAL_FBX_DIRECTORY = '/assets/models/fbx_dosyaları/';

function playwrightModule() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

function isCanonicalDirectoryProbe(url) {
  try {
    return decodeURIComponent(new URL(url).pathname) === CANONICAL_FBX_DIRECTORY;
  } catch {
    return false;
  }
}

function staticContract() {
  const obsoleteEdit = path.join(ROOT, 'edit.html');
  const entry = fs.readFileSync(path.join(ROOT, 'src', '3d', 'editor', 'EditorLiveWorkspaceEntry.mjs'), 'utf8');
  const launcher = fs.readFileSync(path.join(ROOT, 'src', '3d', 'editor', 'EditorGamePreviewLauncher.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'scripts', 'editorLiveServer.js'), 'utf8');
  const canonicalEditor = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');

  assert(!fs.existsSync(obsoleteEdit), 'obsolete edit.html still exists');
  assert(launcher.includes("import('./EditorLiveWorkspaceEntry.mjs')"), 'canonical editor launcher does not activate integrated live workspace');
  for (const token of ['CANLI OYUN', 'DÜZENLEME', 'YAN YANA', './game3d.html?editorPreview=1', '/__editor/models', '/__editor/save', 'Koda Kaydet', 'FBX / GLB / GLTF ara', '__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__', 'waitForAuthoring', 'installFormationBridge', "host?.contentWindow || window", "host?.contentDocument || document"]) {
    assert(entry.includes(token), `workspace entry contract missing: ${token}`);
  }
  for (const token of ['/__editor/health', '/__editor/models', '/__editor/save', "MODEL_EXTENSIONS = new Set(['.fbx', '.glb', '.gltf'])"]) {
    assert(server.includes(token), `editorLiveServer contract missing: ${token}`);
  }
  assert(canonicalEditor.includes('./src/3d/editor/EditorGamePreviewLauncher.js'), 'canonical editor no longer loads preview/workspace launcher');
  assert(canonicalEditor.includes("new URL('./assets/models/fbx_dosyaları/', location.href)"), 'canonical FBX directory probe contract changed');
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
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  const canonicalDirectoryProbes = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    if (location?.url && isCanonicalDirectoryProbe(location.url) && message.text().includes('404')) {
      canonicalDirectoryProbes.push(`console:${location.url}`);
      return;
    }
    const suffix = location?.url ? ` @ ${location.url}${Number.isFinite(location.lineNumber) ? `:${location.lineNumber}` : ''}` : '';
    errors.push(`console: ${message.text()}${suffix}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (response.status() === 404 && isCanonicalDirectoryProbe(response.url())) {
      canonicalDirectoryProbes.push(`http:${response.url()}`);
      return;
    }
    errors.push(`http: ${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`));

  try {
    const removedResponse = await context.request.get(`${baseUrl}/edit.html`);
    assert(removedResponse.status() === 404, `edit.html should be removed, got HTTP ${removedResponse.status()}`);

    await page.goto(`${baseUrl}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.editorLiveWorkspace === 'ready' || Boolean(document.body.dataset.bootError), null, { timeout: 180000 });
    const outer = await page.evaluate(() => ({ ready: document.body.dataset.editorLiveWorkspace, bootError: document.body.dataset.bootError || '' }));
    assert(outer.ready === 'ready', `integrated editor workspace boot failed: ${outer.bootError}`);

    const proof = await page.evaluate(() => {
      const surface = window.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__;
      return {
        snapshot: surface?.getSnapshot?.(),
        buttons: [...document.querySelectorAll('#we-live-workspace-modes [data-mode]')].map((button) => button.textContent),
        catalogStatus: document.querySelector('#we-live-workspace-catalog-status')?.textContent || '',
        saveButton: document.getElementById('we-save-to-code')?.textContent || '',
        liveIframeSrc: document.getElementById('we-live-game-preview-v2')?.getAttribute('src') || '',
        canonicalEditorReady: Boolean(window.__WESTEROS_WORLD_EDITOR__?.scene),
        wrapperIframePresent: Boolean(document.getElementById('we-live-host')),
      };
    });

    assert(proof.canonicalEditorReady, 'canonical editor did not load');
    assert(proof.snapshot?.canonicalEditorLoaded === true, 'workspace does not reuse canonical editor');
    assert(proof.snapshot?.currentMode === 'edit', `canonical editor should default to edit mode: ${proof.snapshot?.currentMode}`);
    assert(proof.snapshot?.gamePreviewLoaded === true, 'game3d live preview iframe missing');
    assert(proof.snapshot?.catalogCount > 0, `model catalog empty: ${JSON.stringify(proof.snapshot)}`);
    assert(proof.buttons.join('|') === 'DÜZENLEME|CANLI OYUN|YAN YANA', `mode buttons drifted: ${proof.buttons.join('|')}`);
    assert(proof.saveButton === 'Koda Kaydet', `save bridge button missing: ${proof.saveButton}`);
    assert(proof.liveIframeSrc.includes('game3d.html?editorPreview=1'), `live iframe source drifted: ${proof.liveIframeSrc}`);
    assert(proof.wrapperIframePresent === false, 'editor.html unexpectedly reintroduced the obsolete wrapper iframe');

    for (const mode of ['live', 'split', 'edit']) {
      const result = await page.evaluate((nextMode) => {
        const surface = window.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__;
        surface?.setMode?.(nextMode);
        const canvas = document.getElementById('we-canvas');
        const preview = document.getElementById('we-live-game-preview-v2');
        return {
          snapshot: surface?.getSnapshot?.(),
          canvasWidth: getComputedStyle(canvas).width,
          previewDisplay: getComputedStyle(preview).display,
        };
      }, mode);
      assert(result.snapshot?.currentMode === mode, `mode switch failed: ${mode}`);
      if (mode === 'live') assert(result.previewDisplay !== 'none', 'live mode did not reveal game preview');
      if (mode === 'edit') assert(result.previewDisplay === 'none', 'edit mode did not hide game preview');
    }

    assert(errors.length === 0, `unexpected console/network/page errors: ${errors.join(' | ')}`);
    console.log(`[checkEditorLiveWorkspaceEntry] PROOF ${JSON.stringify({ ...proof, editHtmlStatus: 404, canonicalDirectoryProbeEvents: canonicalDirectoryProbes.length })}`);
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
