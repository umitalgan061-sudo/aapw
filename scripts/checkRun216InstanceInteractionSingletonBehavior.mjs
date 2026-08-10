#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCE_PATH = path.join(ROOT, 'src', '3d', 'editor', 'EditorInstanceInteractionSingleton.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-singleton-'));
const fixturePath = path.join(tempDir, 'EditorInstanceInteractionSingleton.fixture.mjs');

function assert(value, message) {
  if (!value) throw new Error(message);
}

const fixture = source.replace(
  "import { installEditorInstanceInteraction } from './EditorInstanceInteractionInstaller.js';",
  `function installEditorInstanceInteraction() {\n  globalThis.__run216InstallCount = (globalThis.__run216InstallCount || 0) + 1;\n  const installId = globalThis.__run216InstallCount;\n  return Object.freeze({\n    begin() {},\n    commit() {},\n    end() {},\n    getSnapshot() { return Object.freeze({ installId }); },\n    dispose() { globalThis.__run216DisposeCount = (globalThis.__run216DisposeCount || 0) + 1; }\n  });\n}`
);

assert(fixture !== source, 'installer import replacement failed');
fs.writeFileSync(fixturePath, fixture, 'utf8');

globalThis.__run216InstallCount = 0;
globalThis.__run216DisposeCount = 0;

try {
  const module = await import(`${pathToFileURL(fixturePath).href}?run216=${Date.now()}`);
  const canvas = {};

  const first = module.installEditorInstanceInteractionOnce({ canvas });
  const duplicate = module.installEditorInstanceInteractionOnce({ canvas });
  assert(first === duplicate, 'duplicate install on the same canvas must reuse the active surface');
  assert(globalThis.__run216InstallCount === 1, `duplicate install created ${globalThis.__run216InstallCount} pipelines`);
  assert(first.getSnapshot().disposed === false, 'active singleton snapshot must not report disposed');

  first.dispose();
  first.dispose();
  assert(globalThis.__run216DisposeCount === 1, `idempotent dispose invoked pipeline dispose ${globalThis.__run216DisposeCount} times`);
  assert(first.getSnapshot().disposed === true, 'disposed singleton snapshot must report disposed');

  const second = module.installEditorInstanceInteractionOnce({ canvas });
  assert(second !== first, 'install after disposal must create a fresh surface');
  assert(globalThis.__run216InstallCount === 2, `reinstall expected 2 total pipelines, got ${globalThis.__run216InstallCount}`);
  assert(second.getSnapshot().pipeline.installId === 2, 'reinstall must expose the fresh pipeline snapshot');
  second.dispose();
  assert(globalThis.__run216DisposeCount === 2, 'fresh surface dispose must release its own pipeline exactly once');

  console.log('[checkRun216InstanceInteractionSingletonBehavior] PASS: duplicate install reuse, idempotent dispose and post-dispose reinstall verified');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete globalThis.__run216InstallCount;
  delete globalThis.__run216DisposeCount;
}
