#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEditorLiveServer, scanModels, saveSceneRevision } = require('./editorLiveServer.js');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'westeros-editor-live-'));
  fs.mkdirSync(path.join(root, 'assets/models/characters'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/models/creatures/dragon/textures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/models/characters/knight.glb'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(root, 'assets/models/creatures/dragon/dragon.fbx'), Buffer.from([4, 5, 6, 7]));
  fs.writeFileSync(path.join(root, 'editor.html'), '<!doctype html><title>editor</title>');

  const models = scanModels(root);
  assert.strictEqual(models.length, 2);
  assert(models.some((model) => model.format === 'glb' && model.category === 'characters'));
  const dragon = models.find((model) => model.format === 'fbx');
  assert.strictEqual(dragon.resourcePath, 'assets/models/creatures/dragon/textures/');

  const scene = { schemaVersion: 1, world: { name: 'Westeros' }, editor: {}, objects: [], instanceGroups: [] };
  const first = saveSceneRevision(root, scene);
  const second = saveSceneRevision(root, scene);
  assert.strictEqual(first.revision, second.revision);
  assert.strictEqual(first.createdRevision, true);
  assert.strictEqual(second.createdRevision, false);
  assert.strictEqual(first.appendedJournal, true);
  assert.strictEqual(second.appendedJournal, false);
  assert.strictEqual(fs.readFileSync(path.join(root, first.journalFile), 'utf8').trim().split('\n').length, 1);

  const server = createEditorLiveServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/__editor/health`, { headers: { Origin: 'http://127.0.0.1:5500' } });
    assert.strictEqual(healthResponse.status, 200);
    assert.strictEqual(healthResponse.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5500');
    const catalog = await (await fetch(`http://127.0.0.1:${port}/__editor/models`)).json();
    assert.strictEqual(catalog.count, 2);
    const save = await (await fetch(`http://127.0.0.1:${port}/__editor/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene: { ...scene, objects: [{ id: 'x', name: 'X', asset: 'a', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] } }),
    })).json();
    assert.strictEqual(save.ok, true);
    const html = await (await fetch(`http://127.0.0.1:${port}/editor.html`)).text();
    assert(html.includes('<title>editor</title>'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('[checkRun216EditorLiveWorkspace] PASS: model scan + deterministic additive scene revisions + localhost CORS + API/static serving');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
