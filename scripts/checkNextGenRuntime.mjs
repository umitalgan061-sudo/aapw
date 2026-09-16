import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const requiredFiles = [
  'src/3d/modern/nextgen/types.ts',
  'src/3d/modern/nextgen/ecs.ts',
  'src/3d/modern/nextgen/fixedStep.ts',
  'src/3d/modern/nextgen/scheduler.ts',
  'src/3d/modern/nextgen/commandBus.ts',
  'src/3d/modern/nextgen/input.ts',
  'src/3d/modern/nextgen/network.ts',
  'src/3d/modern/nextgen/worldQuery.ts',
  'src/3d/modern/nextgen/resourceCache.ts',
  'src/3d/modern/nextgen/runtimeKernel.ts',
  'src/3d/modern/nextgen/workerProtocol.ts',
  'src/3d/modern/nextgen/saveCodec.ts',
  'src/3d/modern/nextgen/stateMachine.ts',
  'src/3d/modern/nextgen/metrics.ts',
  'src/3d/modern/nextgen/legacyAdapter.ts',
  'src/3d/modern/nextgen/qualityProfile.ts',
  'src/3d/modern/nextgen/replay.ts',
  'src/3d/modern/nextgen/transaction.ts',
  'src/3d/modern/nextgen/math3d.ts',
  'src/3d/modern/nextgen/pathfinding.ts',
  'src/3d/modern/nextgen/validation.ts',
  'src/3d/modern/nextgen/index.ts',
];

const requiredTests = [
  'tests/modern/nextgenCore.test.ts',
  'tests/modern/nextgenNetwork.test.ts',
  'tests/modern/nextgenPersistence.test.ts',
  'tests/modern/nextgenSchedulerQuality.test.ts',
  'tests/modern/nextgenStateReplay.test.ts',
  'tests/modern/nextgenResourceAndMath.test.ts',
  'tests/modern/nextgenIntegration.test.ts',
  'tests/modern/nextgenValidation.test.ts',
  'tests/modern/nextgenWorkerInput.test.ts',
];

const missing = [...requiredFiles, ...requiredTests].filter((file) => !existsSync(resolve(root, file)));
if (missing.length) {
  console.error(`Missing NextGen runtime files:\n${missing.join('\n')}`);
  process.exit(1);
}

const index = readFileSync(resolve(root, 'src/3d/modern/index.ts'), 'utf8');
if (!index.includes("export * as nextgen from './nextgen/index.ts';")) {
  console.error('Public modern index does not expose the NextGen runtime namespace.');
  process.exit(1);
}

for (const file of requiredFiles.filter((entry) => entry.endsWith('.ts'))) {
  const source = readFileSync(resolve(root, file), 'utf8');
  if (source.includes('eval(') || source.includes('new Function(')) {
    console.error(`Unsafe dynamic code detected in ${file}`);
    process.exit(1);
  }
}

const testCount = requiredTests.length;
console.info(`NextGen runtime guard passed: ${requiredFiles.length} source surfaces, ${testCount} regression suites.`);
