import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const requiredModules = [
  'runtimeKernel.ts', 'deterministicMath.ts', 'playerPrediction.ts', 'inputCommandBufferV3.ts', 'runtimeCommandJournalV3.ts',
  'combatSimulation.ts', 'aiSimulation.ts', 'navigationRuntimeV3.ts', 'assetStreamingV3.ts', 'networkProtocolV3.ts',
  'runtimeTelemetryV3.ts', 'saveSystemV3.ts', 'workerProtocolV3.ts', 'runtimeSecurityV3.ts', 'runtimeContractsV3.ts',
  'runtimeConfigV3.ts', 'performanceGovernorV3.ts', 'renderQualityV3.ts', 'fixedStepControllerV3.ts', 'runtimeLoopV3.ts',
  'worldAuthorityV3.ts', 'runtimeFacadeV3.ts', 'legacyInteropV3.ts', 'cameraRuntimeV3.ts', 'index.ts',
];
const requiredTests = [
  'nextgenRuntimeV3.test.ts', 'nextgenDeterminismStress.test.ts', 'runtimeContractsV3.test.ts', 'runtimeFacadeIntegration.test.ts',
  'runtimeLoopV3.test.ts', 'worldAuthorityV3.test.ts', 'performanceGovernorV3.test.ts', 'renderQualityV3.test.ts',
  'inputAndJournalV3.test.ts', 'cameraRuntimeV3.test.ts',
];

async function read(path) { return readFile(resolve(root, path), 'utf8'); }

async function assertFiles(paths) {
  for (const path of paths) {
    try { await read(path); }
    catch (error) { throw new Error(`required nextgen file missing: ${path} (${error instanceof Error ? error.message : String(error)})`); }
  }
}

function assertNoUnsafeRuntimePrimitives(content, path) {
  const forbidden = [/\beval\s*\(/, /\bnew\s+Function\s*\(/, /__getPlayerStateForInterop/];
  for (const pattern of forbidden) if (pattern.test(content)) throw new Error(`unsafe/obsolete runtime primitive found in ${path}: ${pattern}`);
}

function assertExportSurface(content) {
  for (const moduleName of requiredModules.filter((name) => name !== 'index.ts')) {
    const stem = `./${moduleName.replace(/\.ts$/, '')}`;
    if (!content.includes(stem)) throw new Error(`nextgen index does not export ${stem}`);
  }
}

const index = await read('src/3d/nextgen/index.ts');
assertExportSurface(index);
await assertFiles(requiredModules.map((name) => `src/3d/nextgen/${name}`));
await assertFiles(requiredTests.map((name) => `tests/nextgen/${name}`));

for (const moduleName of requiredModules) {
  if (moduleName === 'index.ts') continue;
  const path = `src/3d/nextgen/${moduleName}`;
  const content = await read(path);
  assertNoUnsafeRuntimePrimitives(content, path);
  if (/\bDate\.now\s*\(/.test(content)) throw new Error(`wall-clock dependency found in deterministic nextgen module: ${path}`);
}

const packageJson = JSON.parse(await read('package.json'));
if (packageJson.type !== 'module') throw new Error('nextgen requires native ESM package mode');
if (!packageJson.engines?.node || !packageJson.engines.node.includes('24')) throw new Error('nextgen requires Node 24+ runtime declaration');
if (!packageJson.scripts?.typecheck || !packageJson.scripts?.test || !packageJson.scripts?.['verify:nextgen']) throw new Error('package scripts must expose nextgen verification gates');

console.log(`[nextgen] verified ${requiredModules.length} runtime modules and ${requiredTests.length} test suites.`);
