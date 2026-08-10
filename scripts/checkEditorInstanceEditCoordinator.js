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
    this.parent = null;
  }
}

async function main() {
  const root = path.resolve(process.argv[2] || '.');
  const sourceDir = path.join(root, 'src', '3d', 'editor');
  const names = [
    'EditorInstanceEditCoordinator.js',
    'EditorInstancePickingModel.js',
    'EditorInstanceSelectionModel.js',
    'EditorInstanceEditSession.js',
    'EditorInstanceEditOperations.js',
    'EditorInstanceTransformProxy.js',
    'EditorInstanceRenderAdapter.js',
    'EditorInstanceBoundsSafety.js'
  ];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-instance-coordinator-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
    for (const name of names) {
      const source = path.join(sourceDir, name);
      if (!fs.existsSync(source)) throw new Error(`instance coordinator dependency missing: ${name}`);
      fs.copyFileSync(source, path.join(tempDir, name));
    }
    const api = await import(`${pathToFileURL(path.join(tempDir, 'EditorInstanceEditCoordinator.js')).href}?run216=${Date.now()}`);
    const THREE = { Object3D: ObjectLike, Vector3: VectorLike, Euler: EulerLike, Quaternion: QuaternionLike, Matrix4: MatrixLike };
    const mesh = {
      instanceMatrix: { needsUpdate: false },
      boundingSphere: null,
      boundingBox: null,
      setMatrixAt(index, matrix) { this.lastMatrix = { index, matrix }; },
      computeBoundingSphere() { this.boundingSphere = { fresh: true }; }
    };
    const groups = [{ id: 'formation-a', assetId: 'soldier', object: mesh, instances: [{ id: 'formation-a-0', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }] }];
    const scene = {
      children: [],
      add(object) { this.children.push(object); object.parent = this; },
      remove(object) { this.children = this.children.filter((entry) => entry !== object); object.parent = null; }
    };
    assert(api.beginEditorInstanceEditFromHits(THREE, scene, groups, []) === null, 'empty hits should not start a session');
    const coordinator = api.beginEditorInstanceEditFromHits(THREE, scene, groups, [{ object: mesh, instanceId: 0 }]);
    assert(coordinator?.active && scene.children[0] === coordinator.session.proxy, 'proxy scene ownership failed');
    coordinator.session.proxy.position.fromArray([8, 0, -3]);
    const selection = api.commitEditorInstanceEdit(THREE, groups, coordinator);
    assert(JSON.stringify(selection.transform.position) === '[8,0,-3]', 'coordinator commit position drift');
    assert(mesh.instanceMatrix.needsUpdate === true && mesh.boundingSphere.fresh === true, 'coordinator render/bounds update missing');
    const proxy = api.endEditorInstanceEdit(scene, coordinator);
    assert(proxy && coordinator.active === false && scene.children.length === 0 && coordinator.session.proxy === null, 'coordinator cleanup failed');
    console.log('[checkEditorInstanceEditCoordinator] PASS: picking, proxy scene ownership, transactional commit and cleanup verified');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[checkEditorInstanceEditCoordinator] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
