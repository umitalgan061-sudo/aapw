#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Run216 suite compatibility: the extended foundation passes the repository root as argv[2].
// Preserve standalone file-path invocation while resolving a directory argument to this check's canonical module.
if (process.argv[2] && fs.existsSync(process.argv[2]) && fs.statSync(process.argv[2]).isDirectory()) {
  process.argv[2] = path.join(process.argv[2], 'src/3d/editor/EditorInstanceBoundsSafety.js');
}

async function loadModule(target) {
  const source = fs.readFileSync(target, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
  const target = path.resolve(process.argv[2] || 'src/3d/editor/EditorInstanceBoundsSafety.js');
  const api = await loadModule(target);
  const calls = [];
  const object = {
    boundingSphere: { stale: true },
    boundingBox: { stale: true },
    computeBoundingSphere() { calls.push('sphere'); this.boundingSphere = { stale: false }; },
    computeBoundingBox() { calls.push('box'); this.boundingBox = { stale: false }; }
  };
  const record = { object };
  const updateResult = { record, instanceIndex: 2 };
  const renderResult = { matrix: true };
  const result = api.applyBoundsSafeInstanceRender({}, updateResult, (_THREE, update) => {
    calls.push(`render:${update.instanceIndex}`);
    return renderResult;
  });
  assert(result === renderResult, 'render return value drift');
  assert(JSON.stringify(calls) === JSON.stringify(['render:2', 'sphere', 'box']), `bounds refresh order drift ${JSON.stringify(calls)}`);
  assert(object.boundingSphere.stale === false && object.boundingBox.stale === false, 'stale bounds were not refreshed');

  calls.length = 0;
  object.boundingBox = null;
  api.refreshEditorInstanceMeshBounds(record);
  assert(JSON.stringify(calls) === JSON.stringify(['sphere']), 'null boundingBox should not force box allocation');

  let rejected = false;
  try { api.applyBoundsSafeInstanceRender({}, updateResult, null); } catch { rejected = true; }
  assert(rejected, 'missing applyRender must be rejected');

  console.log('[checkEditorInstanceBoundsSafety] PASS: stale InstancedMesh sphere/box refresh and render ordering verified');
}

main().catch((error) => {
  console.error(`[checkEditorInstanceBoundsSafety] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
