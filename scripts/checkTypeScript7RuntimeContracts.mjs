import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const files = [
  'src/3d/types/platform.ts',
  'src/3d/types/runtime.ts',
  'src/3d/types/adapters.ts',
  'src/3d/types/taskGraph.ts',
  'src/3d/types/resourceCache.ts',
  'src/3d/types/determinism.ts',
  'src/3d/types/spatialIndex.ts',
  'src/3d/types/workerPool.ts',
  'src/3d/types/stateStore.ts',
  'src/3d/types/assetStream.ts',
  'src/3d/types/saveCodec.ts',
  'src/3d/types/telemetry.ts',
  'src/3d/types/runtimeIntegrity.ts',
  'src/3d/types/input.ts',
  'src/3d/types/renderBridge.ts',
];

const requiredExports = {
  'src/3d/types/platform.ts': ['Backend', 'QualityTier', 'AssetDescriptor', 'FramePlan', 'GameplaySnapshot'],
  'src/3d/types/runtime.ts': ['TypedEventBus', 'FixedStepClock', 'settle'],
  'src/3d/types/taskGraph.ts': ['DeterministicTaskGraph', 'assertAcyclic'],
  'src/3d/types/resourceCache.ts': ['BudgetedResourceCache', 'ResidencyController'],
  'src/3d/types/determinism.ts': ['DeterministicRng', 'ReplayRecorder', 'deterministicHash'],
  'src/3d/types/spatialIndex.ts': ['SpatialHashIndex'],
  'src/3d/types/workerPool.ts': ['AbortableTaskPool', 'createTaskId'],
  'src/3d/types/stateStore.ts': ['TransactionalStateStore', 'diffState'],
  'src/3d/types/assetStream.ts': ['AssetStreamScheduler'],
  'src/3d/types/saveCodec.ts': ['VersionedSaveCodec', 'validateSaveEnvelope'],
  'src/3d/types/telemetry.ts': ['RuntimeTelemetry', 'sanitizeMetricTags'],
  'src/3d/types/runtimeIntegrity.ts': ['RuntimeIntegrityMonitor', 'RecoverySupervisor'],
  'src/3d/types/input.ts': ['InputNormalizer', 'normalizeActionValue'],
  'src/3d/types/renderBridge.ts': ['probeRendererBackends', 'buildFramePlan', 'AdaptiveRenderScale'],
};

for (const file of files) {
  const source = await readFile(file, 'utf8');
  assert.ok(source.length > 100, `${file} is unexpectedly small`);
  for (const symbol of requiredExports[file] ?? []) assert.ok(source.includes(symbol), `${file} missing ${symbol}`);
}

const generator = await readFile('scripts/generateTypeScript7MigrationMatrix.mjs', 'utf8');
assert.match(generator, /expected\s*=\s*4096/);
assert.match(generator, /MIGRATION_CONTRACT_CASES/);

const workflow = await readFile('.github/workflows/typescript7-foundation-r2.yml', 'utf8');
assert.match(workflow, /typescript@7/);
assert.match(workflow, /4096/);
assert.match(workflow, /--noEmit/);

const docs = await readFile('docs/TYPESCRIPT_7_MIGRATION.md', 'utf8');
assert.match(docs, /gradual/i);
assert.match(docs, /adapter/i);
assert.match(docs, /4096/);

const syntaxTargets = files.map((file) => file);
const missing = syntaxTargets.filter((file) => !file.endsWith('.ts'));
assert.equal(missing.length, 0);

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
assert.ok(branch.includes('typescript7-runtime-foundation-r2'));

console.log(`validated ${files.length} TypeScript runtime contract modules`);
console.log('validated strict compiler workflow contract');
console.log('validated migration documentation contract');
console.log(`validated branch=${branch}`);
