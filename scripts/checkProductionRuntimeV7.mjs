#!/usr/bin/env node
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const files = [
  'src/3d/modern/production-v7/types.ts',
  'src/3d/modern/production-v7/deterministic.ts',
  'src/3d/modern/production-v7/scheduler.ts',
  'src/3d/modern/production-v7/entityStore.ts',
  'src/3d/modern/production-v7/spatialIndex.ts',
  'src/3d/modern/production-v7/network.ts',
  'src/3d/modern/production-v7/assets.ts',
  'src/3d/modern/production-v7/persistence.ts',
  'src/3d/modern/production-v7/observability.ts',
  'src/3d/modern/production-v7/security.ts',
  'src/3d/modern/production-v7/renderPolicy.ts',
  'src/3d/modern/production-v7/recovery.ts',
  'src/3d/modern/production-v7/worldSimulation.ts',
  'src/3d/modern/production-v7/codec.ts',
  'src/3d/modern/production-v7/platform.ts',
  'src/3d/modern/production-v7/diagnostics.ts',
  'src/3d/modern/production-v7/facade.ts',
  'src/3d/modern/production-v7/validation.ts',
  'src/3d/modern/production-v7/commandProcessor.ts',
  'src/3d/modern/production-v7/compatibility.ts',
  'src/3d/modern/production-v7/benchmark.ts',
  'src/3d/modern/production-v7/interestManager.ts',
  'src/3d/modern/production-v7/worker.ts',
  'src/3d/modern/production-v7/worldState.ts',
  'src/3d/modern/production-v7/releaseGate.ts',
  'src/3d/modern/production-v7/frameOrchestrator.ts',
  'src/3d/modern/production-v7/migration.ts',
  'src/3d/modern/production-v7/bootstrap.ts',
  'src/3d/modern/production-v7/index.ts',
  'tests/modern/productionRuntimeV7.test.ts',
  'tests/modern/productionRuntimeV7.integration.test.ts',
  'tests/modern/productionRuntimeV7.determinism.test.ts',
  'tests/modern/productionRuntimeV7.expanded.test.ts',
  'tests/modern/productionRuntimeV7.release.test.ts',
  'tests/modern/productionRuntimeV7.frame.test.ts',
  'tests/modern/productionRuntimeV7.bootstrap.test.ts',
  'docs/PRODUCTION_RUNTIME_V7.md',
];

const failures = [];
for (const relative of files) {
  try {
    const source = await readFile(resolve(root, relative), 'utf8');
    if (!source.trim()) failures.push(relative + ': empty file');
    if (/\\bMath\\.random\\s*\\(/.test(source)) failures.push(relative + ': Math.random is forbidden in production-v7 deterministic surfaces');
    if (/\\beval\\s*\\(|\\bnew Function\\s*\\(/.test(source)) failures.push(relative + ': dynamic code execution is forbidden');
  } catch (error) {
    failures.push(relative + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

const index = await readFile(resolve(root, 'src/3d/modern/production-v7/index.ts'), 'utf8').catch(() => '');
for (const symbol of ['facade.ts', 'bootstrap.ts', 'releaseGate.ts', 'commandProcessor.ts', 'migration.ts']) {
  if (!index.includes('./' + symbol)) failures.push('index.ts missing export: ' + symbol);
}

const report = {
  ok: failures.length === 0,
  checked: files.length,
  failures,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\\n');
if (failures.length) process.exitCode = 1;
