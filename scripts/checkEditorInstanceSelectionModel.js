#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

async function loadModule(target) {
  const source = fs.readFileSync(target, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function main() {
  const target = path.resolve(process.argv[2] || 'src/3d/editor/EditorInstanceSelectionModel.js');
  const api = await loadModule(target);
  const groups = [
    { id: 'formation-a', assetId: 'marker-soldier', instances: [
      { id: 'formation-a-0', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'formation-a-1', position: [2, 0, 0], rotation: [0, 0.2, 0], scale: [1, 1, 1] }
    ]},
    { id: 'formation-b', assetId: 'marker-tree', instances: [
      { id: 'formation-b-0', position: [5, 0, 4], rotation: [0, 0, 0], scale: [2, 2, 2] }
    ]}
  ];

  const index = api.buildInstanceSelectionIndex(groups);
  assert(index.size === 3, `index size drift: ${index.size}`);
  const before = api.readInstanceSelection(groups, 'formation-a-1');
  assert(before?.groupId === 'formation-a' && before.instanceIndex === 1, 'stable instance lookup failed');
  before.transform.position[0] = 999;
  assert(groups[0].instances[1].position[0] === 2, 'read selection leaked mutable position reference');

  const updated = api.updateInstanceSelection(groups, 'formation-a-1', { position: [3, 0, 1] });
  assert(updated?.selection.instanceId === 'formation-a-1', 'update changed instance identity');
  assert(JSON.stringify(groups[0].instances[1].position) === '[3,0,1]', 'position update failed');
  assert(JSON.stringify(groups[0].instances[1].rotation) === '[0,0.2,0]', 'rotation was not preserved');
  assert(JSON.stringify(groups[0].instances[1].scale) === '[1,1,1]', 'scale was not preserved');
  assert(api.readInstanceSelection(groups, 'missing-id') === null, 'missing instance should resolve to null');

  const snapshot = JSON.stringify(groups[0].instances[0]);
  let invalidRejected = false;
  try { api.updateInstanceSelection(groups, 'formation-a-0', { scale: [1, 0, 1] }); } catch { invalidRejected = true; }
  assert(invalidRejected, 'non-positive scale was accepted');
  assert(JSON.stringify(groups[0].instances[0]) === snapshot, 'invalid patch partially mutated instance');

  let duplicateRejected = false;
  try {
    api.buildInstanceSelectionIndex([{ id: 'x', assetId: 'a', instances: [
      { id: 'dup', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] },
      { id: 'dup', position: [1,0,0], rotation: [0,0,0], scale: [1,1,1] }
    ]}]);
  } catch { duplicateRejected = true; }
  assert(duplicateRejected, 'duplicate instance ids were accepted');

  console.log('[checkEditorInstanceSelectionModel] PASS: stable identity, immutable reads, atomic transform updates and validation verified');
}

main().catch((error) => {
  console.error(`[checkEditorInstanceSelectionModel] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
