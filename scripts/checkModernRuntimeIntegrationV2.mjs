#!/usr/bin/env node
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const required = [
  'src/3d/modern/playerAuthority.ts',
  'src/3d/modern/combatAuthority.ts',
  'src/3d/modern/animationAuthority.ts',
  'src/3d/modern/aiAuthority.ts',
  'src/3d/modern/worldChunkRuntime.ts',
  'src/3d/modern/worldSpatialIndex.ts',
  'src/3d/modern/navigationRuntime.ts',
  'src/3d/modern/networkRuntimeV2.ts',
  'src/3d/modern/runtimePersistenceV2.ts',
  'src/3d/modern/runtimeDiagnosticsV2.ts',
  'src/3d/modern/runtimeOrchestratorV2.ts',
  'src/3d/modern/runtimeIntegrationV2.ts',
  'src/3d/modern/renderIntegrationV2.ts',
  'src/3d/modern/runtimeBenchmarksV2.ts',
  'tests/modern/runtimeIntegrationV2.test.ts',
];
for (const path of required) {
  try { await readFile(join(root, path), 'utf8'); }
  catch { failures.push(`Missing required modern runtime file: ${path}`); }
}
const files = await Promise.all(required.filter((path) => path.endsWith('.ts')).map(async (path) => [path, await readFile(join(root, path), 'utf8')]));
for (const [path, source] of files) {
  if (/\bMath\.random\s*\(/.test(source)) failures.push(`${path}: nondeterministic Math.random is forbidden.`);
  if (/\bDate\.now\s*\(/.test(source) && !path.endsWith('worldChunkRuntime.ts') && !path.endsWith('runtimePersistenceV2.ts')) failures.push(`${path}: uncontrolled wall-clock access is forbidden.`);
  if (/\bsetInterval\s*\(/.test(source)) failures.push(`${path}: unbounded interval ownership is forbidden.`);
}
console.log(JSON.stringify({ ok: failures.length === 0, checked: required.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
