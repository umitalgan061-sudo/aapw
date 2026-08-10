#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const LIVE_IMPORT = 'EditorInstanceInteractionBootstrap.js';
const LEGACY_YIELD = 'window.__WESTEROS_EDITOR_INSTANCE_POINTER__?.ownsPointer?.(event)';
const POINTER_PUBLICATION = 'globalTarget.__WESTEROS_EDITOR_INSTANCE_POINTER__ = ownershipSurface';
const ACTIVE_OWNERSHIP = 'if (isActive()) return true;';

export function evaluateRun216InstanceLiveReadiness(worldEditorSource, bootstrapSource, ownershipSource) {
  const liveActivated = worldEditorSource.includes(LIVE_IMPORT);
  const legacyYields = worldEditorSource.includes(LEGACY_YIELD);
  assert.ok(bootstrapSource.includes(POINTER_PUBLICATION), 'bootstrap must publish pointer ownership surface');
  assert.ok(ownershipSource.includes(ACTIVE_OWNERSHIP), 'active instance edit must retain pointer ownership');
  if (liveActivated) {
    assert.ok(legacyYields, 'live instance interaction requires legacy worldEditor pointerdown yield guard');
  }
  return Object.freeze({ liveActivated, legacyYields, readyForLiveActivation: legacyYields });
}

function runSelfTest() {
  const bootstrap = POINTER_PUBLICATION;
  const ownership = ACTIVE_OWNERSHIP;
  assert.deepEqual(
    evaluateRun216InstanceLiveReadiness('legacy editor only', bootstrap, ownership),
    { liveActivated: false, legacyYields: false, readyForLiveActivation: false }
  );
  assert.throws(
    () => evaluateRun216InstanceLiveReadiness(`import('./${LIVE_IMPORT}')`, bootstrap, ownership),
    /requires legacy worldEditor pointerdown yield guard/
  );
  const safe = evaluateRun216InstanceLiveReadiness(`import('./${LIVE_IMPORT}'); ${LEGACY_YIELD}`, bootstrap, ownership);
  assert.equal(safe.liveActivated, true);
  assert.equal(safe.legacyYields, true);
  console.log('[checkRun216InstanceLiveReadiness] SELF-TEST PASS');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const worldEditor = fs.readFileSync(path.join(root, 'src', '3d', 'editor', 'worldEditor.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(root, 'src', '3d', 'editor', 'EditorInstanceInteractionBootstrap.js'), 'utf8');
  const ownership = fs.readFileSync(path.join(root, 'src', '3d', 'editor', 'EditorInstancePointerOwnership.js'), 'utf8');
  const result = evaluateRun216InstanceLiveReadiness(worldEditor, bootstrap, ownership);
  console.log(`[checkRun216InstanceLiveReadiness] PASS: liveActivated=${result.liveActivated} legacyYields=${result.legacyYields} readyForLiveActivation=${result.readyForLiveActivation}`);
}
