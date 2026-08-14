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

class Vector3 {
  constructor() { this.values = [0, 0, 0]; }
  fromArray(value) { this.values = [...value]; return this; }
}
class Euler {
  constructor(x, y, z) { this.values = [x, y, z]; }
}
class Quaternion {
  constructor() { this.euler = null; }
  setFromEuler(euler) { this.euler = [...euler.values]; return this; }
}
class Matrix4 {
  compose(position, quaternion, scale) {
    this.snapshot = { position: [...position.values], rotation: [...quaternion.euler], scale: [...scale.values] };
    return this;
  }
}
const THREE = { Vector3, Euler, Quaternion, Matrix4 };

async function main() {
  const target = path.resolve(process.argv[2] || 'src/3d/editor/EditorInstanceRenderAdapter.js');
  const api = await loadModule(target);
  const calls = [];
  const record = {
    instances: [
      { id: 'formation-a-0', position: [3, 1, -4], rotation: [0.1, 0.2, 0.3], scale: [1.2, 1.3, 1.4] }
    ],
    object: {
      instanceMatrix: { needsUpdate: false },
      setMatrixAt(index, matrix) { calls.push({ index, snapshot: matrix.snapshot }); }
    }
  };

  const matrix = api.applyInstanceTransformToMesh(THREE, record, 0);
  assert(matrix?.snapshot, 'matrix compose result missing');
  assert(calls.length === 1 && calls[0].index === 0, 'setMatrixAt index/call count drift');
  assert(JSON.stringify(calls[0].snapshot.position) === '[3,1,-4]', 'position did not reach matrix compose');
  assert(JSON.stringify(calls[0].snapshot.rotation) === '[0.1,0.2,0.3]', 'rotation did not reach quaternion compose');
  assert(JSON.stringify(calls[0].snapshot.scale) === '[1.2,1.3,1.4]', 'scale did not reach matrix compose');
  assert(record.object.instanceMatrix.needsUpdate === true, 'instanceMatrix.needsUpdate was not raised');

  calls.length = 0;
  record.object.instanceMatrix.needsUpdate = false;
  const viaSelection = api.applyUpdatedInstanceSelectionToMesh(THREE, { record, instanceIndex: 0 });
  assert(viaSelection?.snapshot && calls.length === 1, 'selection update adapter did not apply render matrix');
  assert(api.applyUpdatedInstanceSelectionToMesh(THREE, null) === null, 'null selection update should be a no-op');

  let boundsRejected = false;
  try { api.applyInstanceTransformToMesh(THREE, record, 1); } catch { boundsRejected = true; }
  assert(boundsRejected, 'out-of-range instance index was accepted');

  console.log('[checkEditorInstanceRenderAdapter] PASS: serialized transform reaches setMatrixAt deterministically and marks instanceMatrix dirty');
}

main().catch((error) => {
  console.error(`[checkEditorInstanceRenderAdapter] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
