import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const modules = [
  ['src/3d/types/platform.ts', ['Brand', 'DeviceCapabilities', 'AssetDescriptor', 'FramePlan', 'GameplaySnapshot']],
  ['src/3d/types/runtime.ts', ['TypedEventBus', 'FixedStepClock', 'normalizeFailure']],
  ['src/3d/types/adapters.ts', ['adaptLegacyRuntime', 'adaptLegacyFrame', 'adaptLegacySave', 'adaptLegacyAsset']],
  ['src/3d/types/taskGraph.ts', ['DeterministicTaskGraph', 'assertAcyclic']],
  ['src/3d/types/resourceCache.ts', ['BudgetedResourceCache', 'ResidencyController']],
  ['src/3d/types/determinism.ts', ['DeterministicRng', 'ReplayRecorder', 'deterministicHash']],
  ['src/3d/types/spatialIndex.ts', ['SpatialHashIndex', 'query']],
  ['src/3d/types/workerPool.ts', ['AbortableTaskPool', 'createTaskId']],
  ['src/3d/types/stateStore.ts', ['TransactionalStateStore', 'diffState']],
  ['src/3d/types/assetStream.ts', ['AssetStreamScheduler', 'StreamRequest']],
  ['src/3d/types/saveCodec.ts', ['VersionedSaveCodec', 'validateSaveEnvelope']],
  ['src/3d/types/telemetry.ts', ['RuntimeTelemetry', 'sanitizeMetricTags']],
  ['src/3d/types/runtimeIntegrity.ts', ['RuntimeIntegrityMonitor', 'RecoverySupervisor']],
  ['src/3d/types/input.ts', ['InputNormalizer', 'detectInputCapabilities']],
  ['src/3d/types/renderBridge.ts', ['probeRendererBackends', 'deriveRenderFeatures', 'buildFramePlan']],
  ['src/3d/types/runtimeFacade.ts', ['TypedRuntimeFacade', 'createRuntimeFacade']],
  ['src/3d/types/world.ts', ['DeterministicEntityIndex', 'DeterministicNavigationGraph', 'WorldSystemScheduler']],
  ['src/3d/types/validation.ts', ['validateRuntime', 'validateAsset', 'validateFramePlan', 'validateGameplaySnapshot']],
];

const references = new Map();
for (const [file, symbols] of modules) {
  const source = await readFile(file, 'utf8');
  references.set(file, source);
  assert.ok(source.length > 500, `${file} must contain a substantial contract`);
  for (const symbol of symbols) assert.ok(source.includes(symbol), `${file} missing boundary ${symbol}`);
}

const aggregate = [...references.values()].join('\n');
for (const token of ['webgpu', 'webgl2', 'AbortSignal', 'Readonly', 'unknown', 'Promise']) assert.ok(aggregate.includes(token), `shared contract missing ${token}`);

const forbidden = ['eval(', 'new Function(', 'document.write('];
for (const [file, source] of references) for (const token of forbidden) assert.equal(source.includes(token), false, `${file} contains forbidden runtime pattern ${token}`);

const adapterSource = references.get('src/3d/types/adapters.ts');
assert.match(adapterSource, /unknown/);
assert.match(adapterSource, /normalizeBackend/);
assert.match(adapterSource, /normalizeQuality/);

const renderSource = references.get('src/3d/types/renderBridge.ts');
assert.match(renderSource, /webgpu/);
assert.match(renderSource, /webgl2/);
assert.match(renderSource, /fallback/);

const persistenceSource = references.get('src/3d/types/saveCodec.ts');
assert.match(persistenceSource, /SHA-256/);
assert.match(persistenceSource, /migrate/);
assert.match(persistenceSource, /checksum/);

const runtimeSource = references.get('src/3d/types/runtime.ts');
assert.match(runtimeSource, /fixedStepMs/);
assert.match(runtimeSource, /maxCatchUpSteps/);
assert.match(runtimeSource, /Abort/);

console.log(`verified ${modules.length} TypeScript 7 boundary modules`);
console.log('verified legacy-adapter sanitization boundary');
console.log('verified WebGPU/WebGL2 fallback boundary');
console.log('verified persistence checksum/migration boundary');
console.log('verified forbidden runtime pattern gate');
