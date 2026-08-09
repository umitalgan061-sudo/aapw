#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

async function loadModule(target) {
  const source = fs.readFileSync(target, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function assert(value, message) { if (!value) throw new Error(message); }

class VectorLike {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  fromArray(value) { [this.x, this.y, this.z] = value; return this; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Object3D {
  constructor() {
    this.name = '';
    this.userData = {};
    this.position = new VectorLike();
    this.rotation = new VectorLike();
    this.scale = new VectorLike(1, 1, 1);
  }
}
const THREE = { Object3D };

async function main() {
  const target = path.resolve(process.argv[2] || 'src/3d/editor/EditorInstanceTransformProxy.js');
  const api = await loadModule(target);
  const selection = {
    groupId: 'formation-a', assetId: 'marker-soldier', instanceIndex: 2, instanceId: 'formation-a-2',
    transform: { position: [4, 1, -2], rotation: [0.1, 0.5, -0.2], scale: [1.1, 1.2, 1.3] }
  };
  const proxy = api.createEditorInstanceTransformProxy(THREE, selection);
  assert(proxy.userData.editorInstanceProxy === true, 'proxy marker missing');
  assert(proxy.userData.editorInstanceId === 'formation-a-2', 'instance identity missing from proxy');
  assert(proxy.userData.editorInstanceGroupId === 'formation-a' && proxy.userData.editorInstanceIndex === 2, 'group/index identity missing from proxy');
  assert(proxy.name === 'Instance formation-a-2', 'proxy name drift');
  assert(JSON.stringify(api.snapshotEditorInstanceTransformProxy(proxy).position) === '[4,1,-2]', 'proxy position snapshot drift');

  proxy.position.set(7, 0, 3);
  proxy.rotation.set(0, 1, 0);
  proxy.scale.set(2, 2, 2);
  const edited = api.snapshotEditorInstanceTransformProxy(proxy);
  assert(JSON.stringify(edited) === JSON.stringify({ position: [7,0,3], rotation: [0,1,0], scale: [2,2,2] }), 'edited proxy snapshot drift');

  console.log('[checkEditorInstanceTransformProxy] PASS: stable instance identity and editable Object3D proxy transform verified');
}

main().catch((error) => {
  console.error(`[checkEditorInstanceTransformProxy] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
