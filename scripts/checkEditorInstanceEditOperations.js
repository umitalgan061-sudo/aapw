#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function assert(value, message) { if (!value) throw new Error(message); }

class VectorLike {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  fromArray(value) { [this.x, this.y, this.z] = value; return this; }
}
class EulerLike {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class QuaternionLike { setFromEuler(euler) { this.euler = euler; return this; } }
class MatrixLike {
  compose(position, quaternion, scale) {
    this.position = [position.x, position.y, position.z];
    this.rotation = [quaternion.euler.x, quaternion.euler.y, quaternion.euler.z];
    this.scale = [scale.x, scale.y, scale.z];
    return this;
  }
}
class ObjectLike {
  constructor() {
    this.userData = {};
    this.position = new VectorLike();
    this.rotation = new EulerLike();
    this.scale = new VectorLike();
  }
}

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const sourceDir = path.join(root, 'src', '3d', 'editor');
  const names = [
    'EditorInstanceEditOperations.js',
    'EditorInstanceTransformProxy.js',
    'EditorInstanceSelectionModel.js',
    'EditorInstanceRenderAdapter.js',
    'EditorInstanceBoundsSafety.js'
  ];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-instance-ops-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
    for (const name of names) {
      const source = path.join(sourceDir, name);
      if (!fs.existsSync(source)) throw new Error(`instance edit operations dependency missing: ${name}`);
      fs.copyFileSync(source, path.join(tempDir, name));
    }
    const api = await import(`${pathToFileURL(path.join(tempDir, 'EditorInstanceEditOperations.js')).href}?run216=${Date.now()}`);
    const THREE = { Object3D: ObjectLike, Vector3: VectorLike, Euler: EulerLike, Quaternion: QuaternionLike, Matrix4: MatrixLike };
    const object = {
      instanceMatrix: { needsUpdate: false },
      boundingSphere: { stale: true },
      boundingBox: null,
      setMatrixAt(index, matrix) { this.lastMatrix = { index, matrix }; },
      computeBoundingSphere() { this.boundingSphere = { stale: false }; }
    };
    const groups = [{ id: 'formation-a', assetId: 'soldier', object, instances: [{ id: 'formation-a-0', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }] }];
    const selection = { groupId: 'formation-a', assetId: 'soldier', instanceIndex: 0, instanceId: 'formation-a-0', transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } };
    const operations = api.createEditorInstanceEditOperations();
    assert(Object.isFrozen(operations), 'operations bundle must be frozen');
    const proxy = operations.createProxy(THREE, selection);
    proxy.position.fromArray([3, 2, 1]);
    const patch = operations.snapshotProxy(proxy);
    const update = operations.updateSelection(groups, selection.instanceId, patch);
    const matrix = operations.applyRender(THREE, update);
    assert(object.lastMatrix?.index === 0 && object.lastMatrix.matrix === matrix, 'matrix application drift');
    assert(object.instanceMatrix.needsUpdate === true, 'instanceMatrix.needsUpdate missing');
    assert(object.boundingSphere.stale === false, 'bounds refresh missing');
    assert(JSON.stringify(groups[0].instances[0].position) === '[3,2,1]', 'serialized update drift');
    console.log('[checkEditorInstanceEditOperations] PASS: proxy, selection, render and bounds-safe operation composition verified');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[checkEditorInstanceEditOperations] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
