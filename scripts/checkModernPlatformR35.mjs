import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const files = [
  'src/3d/nextgen/r35/contracts.ts',
  'src/3d/nextgen/r35/stateStore.ts',
  'src/3d/nextgen/r35/inputPipeline.ts',
  'src/3d/nextgen/r35/worldScheduler.ts',
  'src/3d/nextgen/r35/assetOrchestrator.ts',
  'src/3d/nextgen/r35/observability.ts',
  'src/3d/nextgen/r35/runtimeApplication.ts',
  'src/3d/nextgen/r35/runtimeRecovery.ts',
  'src/3d/nextgen/r35/commandBus.ts',
  'src/3d/nextgen/r35/saveCodec.ts',
  'src/3d/nextgen/r35/workerPool.ts',
  'src/3d/nextgen/r35/deterministicClock.ts',
  'src/3d/nextgen/r35/resourceBudget.ts',
  'src/3d/nextgen/r35/featureRegistry.ts',
  'src/3d/nextgen/r35/index.ts',
  'tests/modern/r35UnifiedRuntime.test.ts',
  'tests/modern/r35AssetInput.test.ts',
  'tests/modern/r35ObservabilityScheduler.test.ts',
  'tests/modern/r35ContractIntegrity.test.ts',
  'tests/modern/r35PlatformServices.test.ts',
  'tests/modern/r35AdditionalServices.test.ts'
];

const failures = [];
for (const relative of files) {
  try {
    await access(join(process.cwd(), relative));
  } catch {
    failures.push(relative + ': missing');
  }
}

const index = await readFile('src/3d/nextgen/index.ts', 'utf8');
if (!index.includes("./r35/index")) failures.push('src/3d/nextgen/index.ts: R35 barrel export missing');

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const key of ['check:r35', 'verify:modern:r35', 'typecheck:r35', 'test:r35']) {
  if (!packageJson.scripts?.[key]) failures.push('package.json: ' + key + ' script missing');
}

if (failures.length) {
  console.error('[modern-r35] FAIL');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}
console.log('[modern-r35] PASS ' + JSON.stringify({ files: files.length, version: 35 }));
