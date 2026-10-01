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
  'src/3d/nextgen/r35/index.ts',
  'tests/modern/r35UnifiedRuntime.test.ts',
  'tests/modern/r35AssetInput.test.ts',
  'tests/modern/r35ObservabilityScheduler.test.ts'
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
if (!index.includes(\"./r35/index\")) failures.push('src/3d/nextgen/index.ts: R35 barrel export missing');

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (!packageJson.scripts?.['check:r35']) failures.push('package.json: check:r35 script missing');

if (failures.length) {
  console.error('[modern-r35] FAIL');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}
console.log('[modern-r35] PASS ' + JSON.stringify({ files: files.length, version: 35 }));
