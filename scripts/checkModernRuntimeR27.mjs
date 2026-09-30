import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const requiredFiles = [
  'src/3d/modern/r27/index.ts',
  'src/3d/modern/r27/contracts.ts',
  'src/3d/modern/r27/deterministicScheduler.ts',
  'src/3d/modern/r27/ecs.ts',
  'src/3d/modern/r27/physics.ts',
  'src/3d/modern/r27/visibility.ts',
  'src/3d/modern/r27/ai.ts',
  'src/3d/modern/r27/inventory.ts',
  'src/3d/modern/r27/dialogue.ts',
  'src/3d/modern/r27/save.ts',
  'src/3d/modern/r27/network.ts',
  'src/3d/modern/r27/assetPipeline.ts',
  'src/3d/modern/r27/performance.ts',
  'src/3d/modern/r27/runtime.ts',
  'src/3d/modern/r27/migrationBoundary.ts',
  'src/3d/modern/r27/worldQueries.ts',
  'src/3d/modern/r27/renderAdapter.ts',
  'src/3d/modern/r27/security.ts',
  'src/3d/modern/r27/workerProtocol.ts',
  'tests/modern/r27/contractsAndScheduler.test.ts',
  'tests/modern/r27/ecsPhysicsWorld.test.ts',
  'tests/modern/r27/gameplaySystems.test.ts',
  'tests/modern/r27/platformBoundaries.test.ts',
  'tests/modern/r27/persistenceNetworkPerformance.test.ts',
  'tests/modern/r27/runtime.test.ts',
];

const failures = [];

for (const file of requiredFiles) {
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    failures.push('missing:' + relative(root, absolute));
    continue;
  }
  const source = readFileSync(absolute, 'utf8');
  if (source.includes('eval(') || source.includes('new Function(')) {
    failures.push('unsafe-primitive:' + file);
  }
  if (file.endsWith('.ts') && /(^|\n)\s*import .*node:crypto/.test(source)) {
    failures.push('browser-runtime-node-crypto:' + file);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const script of ['verify:modern:r27', 'test:modern:r27', 'check:modern:r27']) {
  if (!packageJson.scripts?.[script]) failures.push('missing-script:' + script);
}

const modernIndex = readFileSync(join(root, 'src/3d/modern/index.ts'), 'utf8');
if (!modernIndex.includes("'./r27/index.ts'")) failures.push('r27-not-exported');

if (failures.length > 0) {
  console.error('R27 verification failed');
  for (const failure of failures.sort()) console.error(failure);
  process.exit(1);
}

console.log('R27 verification passed: ' + requiredFiles.length + ' required surfaces checked.');
