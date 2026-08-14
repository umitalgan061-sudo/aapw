#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

async function loadModule(target) {
  const source = fs.readFileSync(target, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const selection = await loadModule(path.join(root, 'src/3d/editor/EditorInstanceSelectionModel.js'));
  const serializer = await loadModule(path.join(root, 'src/3d/editor/EditorSceneSerializer.js'));
  const groups = [{
    id: 'formation-marker-soldier-0001',
    assetId: 'marker-soldier',
    rows: 1,
    columns: 2,
    spacing: 1.5,
    instances: [
      { id: 'formation-marker-soldier-0001-0', position: [-0.75, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'formation-marker-soldier-0001-1', position: [0.75, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    ]
  }];

  const targetId = 'formation-marker-soldier-0001-1';
  selection.updateInstanceSelection(groups, targetId, {
    position: [4, 0, -3],
    rotation: [0, 1.25, 0],
    scale: [1.2, 1.2, 1.2]
  });

  const saved = serializer.serializeEditorScene([], groups, { gridVisible: true, snapEnabled: true, snapSize: 1 });
  const parsed = serializer.validateEditorScene(JSON.parse(JSON.stringify(saved)));
  const restored = selection.readInstanceSelection(parsed.instanceGroups, targetId);
  assert(restored?.instanceId === targetId, 'instance identity did not survive scene JSON round-trip');
  assert(restored.groupId === 'formation-marker-soldier-0001', 'group identity did not survive scene JSON round-trip');
  assert(JSON.stringify(restored.transform.position) === '[4,0,-3]', 'position did not survive scene JSON round-trip');
  assert(JSON.stringify(restored.transform.rotation) === '[0,1.25,0]', 'rotation did not survive scene JSON round-trip');
  assert(JSON.stringify(restored.transform.scale) === '[1.2,1.2,1.2]', 'scale did not survive scene JSON round-trip');
  assert(parsed.instanceGroups[0].rows === 1 && parsed.instanceGroups[0].columns === 2 && parsed.instanceGroups[0].spacing === 1.5, 'formation metadata drifted during round-trip');

  console.log('[checkEditorInstanceSelectionPersistence] PASS: edited instance identity, transform and formation metadata survive scene JSON round-trip');
}

main().catch((error) => {
  console.error(`[checkEditorInstanceSelectionPersistence] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
