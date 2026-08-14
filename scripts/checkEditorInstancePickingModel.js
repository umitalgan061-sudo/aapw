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
  const target = path.resolve(process.argv[2] || 'src/3d/editor/EditorInstancePickingModel.js');
  const api = await loadModule(target);
  const meshA = { name: 'formation mesh A' };
  const meshB = { name: 'formation mesh B' };
  const unrelated = { name: 'ordinary mesh' };
  const groups = [
    { id: 'formation-a', assetId: 'marker-soldier', object: meshA, instances: [
      { id: 'formation-a-0' }, { id: 'formation-a-1' }
    ]},
    { id: 'formation-b', assetId: 'marker-tree', object: meshB, instances: [
      { id: 'formation-b-0' }
    ]}
  ];

  const picked = api.resolveEditorInstancePick(groups, { object: meshA, instanceId: 1 });
  assert(picked?.groupId === 'formation-a', 'group identity drift');
  assert(picked.instanceId === 'formation-a-1' && picked.instanceIndex === 1, 'instance index/id mapping drift');
  assert(picked.record === groups[0] && picked.instance === groups[0].instances[1], 'selection lost live record references');
  assert(api.resolveEditorInstancePick(groups, { object: unrelated, instanceId: 0 }) === null, 'unrelated mesh was accepted');
  assert(api.resolveEditorInstancePick(groups, { object: meshA }) === null, 'missing instanceId was accepted');
  assert(api.resolveEditorInstancePick(groups, { object: meshA, instanceId: 9 }) === null, 'out-of-range instanceId was accepted');

  const nearest = api.resolveNearestEditorInstancePick(groups, [
    { object: unrelated },
    { object: meshB, instanceId: 0 },
    { object: meshA, instanceId: 0 }
  ]);
  assert(nearest?.instanceId === 'formation-b-0', 'nearest valid instance hit was not selected deterministically');

  console.log('[checkEditorInstancePickingModel] PASS: raycaster instanceId resolves to stable group/instance identity deterministically');
}

main().catch((error) => {
  console.error(`[checkEditorInstancePickingModel] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
