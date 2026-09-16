import { createTypedRuntimeSession, QualityHysteresisController, deriveRuntimeBudget, MigrationBoundaryTracker } from '../src/engine-ts/typedRuntimeComposition.ts';
import { DeterministicWorkerQueue, createDefaultWorkerHandlers, deterministicJobSeed, runDeterministicLodJob, runDeterministicVisibilityJob } from '../src/engine-ts/workerRuntime.ts';
import { AssetManifestRegistry, buildDependencyPrefetchPlan, planResidency } from '../src/engine-ts/assetPipeline.ts';
import { classifySourceModuleV5, buildTypedCutoverPlanV5, assertTypedCutoverPlanV5 } from '../src/3d/modern/typedMigrationV5.ts';

const assert = (condition, message) => { if (!condition) throw new Error(message); };

const sessionResult = createTypedRuntimeSession({ seed: 'typed-runtime-test', preference: 'auto', quality: 'high' });
assert(sessionResult.ok, 'typed runtime session must construct');
const session = sessionResult.value;
const initial = session.diagnostics();
assert(initial.schemaVersion === 2, 'runtime snapshot schema must be v2');
assert(initial.backend !== 'unavailable', 'headless fallback must still be represented as a usable runtime backend');
const frame = session.frame({ nowMs: 16.666, deltaSeconds: 1 / 60 });
assert(frame.ok, 'typed runtime frame must execute');
assert(frame.value.frameId >= 1, 'frame id must advance');
session.pause();
const paused = session.frame({ nowMs: 33.333, deltaSeconds: 1 / 60 });
assert(paused.ok && paused.value.paused, 'pause state must propagate into runtime report');
session.resume();
session.dispose();

const queue = new DeterministicWorkerQueue('seed-a', { maxJobsPerFrame: 4, maxMillisecondsPerFrame: 50 });
for (const handler of createDefaultWorkerHandlers()) queue.registerHandler(handler);
const visibility = runDeterministicVisibilityJob({ camera: { x: 0, y: 0, z: 0 }, maxDistance: 10, objects: [
  { id: 'near', x: 1, y: 0, z: 1, radius: 0.5, importance: 1 },
  { id: 'far', x: 100, y: 0, z: 0, radius: 1, importance: 100 },
  { id: 'edge', x: 10, y: 0, z: 0, radius: 0, importance: 0 },
] });
assert(visibility.visibleIds.includes('near'), 'near object must be visible');
assert(visibility.rejectedIds.includes('far'), 'far object must be rejected');
const lod = runDeterministicLodJob({ objects: [{ id: 'a', screenRadius: 10 }, { id: 'b', screenRadius: 1 }], thresholds: [8, 3] });
assert(lod.levels.a === 0 && lod.levels.b === 2, 'LOD threshold mapping must be deterministic');
const seedA = deterministicJobSeed('demo', 'seed-a');
const seedB = deterministicJobSeed('demo', 'seed-a');
assert(seedA === seedB, 'worker seed must be stable');
await queue.enqueue({ jobId: 'visibility-1', kind: 'visibility', priority: 4, submittedAtTick: 1, data: { camera: { x: 0, y: 0, z: 0 }, maxDistance: 10, objects: [] } });
const workerResults = await queue.runFrame({ nowTick: 2, nowMs: 33.333 });
assert(workerResults.length === 1 && workerResults[0].state === 'completed', 'queued worker job must complete');
queue.dispose();

const manifest = new AssetManifestRegistry();
for (const descriptor of [
  { id: 'root', url: '/root.glb', kind: 'model', bytes: 100, priority: 4, version: '1', dependencies: ['material', 'albedo'] },
  { id: 'material', url: '/material.bin', kind: 'data', bytes: 20, priority: 2, version: '1', dependencies: [] },
  { id: 'albedo', url: '/albedo.ktx2', kind: 'texture', bytes: 40, priority: 3, version: '1', dependencies: [] },
]) assert(manifest.register(descriptor).ok, `manifest registration failed for ${descriptor.id}`);
assert(manifest.validateGraph().length === 0, 'asset dependency graph must be valid');
const prefetch = buildDependencyPrefetchPlan(manifest, { roots: ['root'], maxDepth: 2, maxAssets: 8 });
assert(prefetch.includes('material') && prefetch.includes('albedo') && prefetch.at(-1) === 'root', 'dependency prefetch order must be dependency-first');
const residencyRecords = [
  { descriptor: manifest.get('root'), state: 'resident', lastUsedTick: 1, useCount: 1, loadedBytes: 100, value: {}, error: null },
  { descriptor: manifest.get('albedo'), state: 'resident', lastUsedTick: 10, useCount: 5, loadedBytes: 40, value: {}, error: null },
];
const residencyPlan = planResidency(residencyRecords, 80, new Set(['albedo']));
assert(residencyPlan.evictIds.includes('root'), 'least valuable unprotected asset must be evicted');

const boundary = new MigrationBoundaryTracker();
boundary.noteTypedFrame(1);
boundary.noteHandoff(1);
boundary.assertHealthy();
const modules = [
  classifySourceModuleV5({ path: 'src/engine-ts/modernEngine.ts', surface: 'world', criticality: 4, typedImportCount: 8 }),
  classifySourceModuleV5({ path: 'src/3d/game3d.js', surface: 'world', criticality: 4, legacyImportCount: 8 }),
  classifySourceModuleV5({ path: 'src/engine-ts/input.ts', surface: 'input', criticality: 4, typedImportCount: 4 }),
  classifySourceModuleV5({ path: 'src/3d/input.js', surface: 'input', criticality: 3, legacyImportCount: 2 }),
];
const plan = buildTypedCutoverPlanV5(modules);
assertTypedCutoverPlanV5(plan);
assert(plan.records.some(record => record.surface === 'input'), 'input migration record must exist');

const quality = new QualityHysteresisController('high');
for (let index = 0; index < 12; index += 1) quality.update(24, 16.6);
assert(quality.quality === 'medium' || quality.quality === 'high', 'quality controller must remain within expected band');
const budget = deriveRuntimeBudget(16.6, 0.5);
const budgetSum = budget.inputMs + budget.simulationMs + budget.aiMs + budget.streamingMs + budget.animationMs + budget.presentationMs + budget.renderMs + budget.postMs;
assert(Math.abs(budgetSum - budget.totalMs) < 0.000001, 'runtime budget must conserve total frame budget');

console.log(JSON.stringify({ schemaVersion: 1, runtimeFrame: frame.value.frameId, workerResults: workerResults.length, prefetchCount: prefetch.length, evictions: residencyPlan.evictIds.length, typedModules: plan.modules.filter(module => module.language === 'typescript').length, budgetMs: budget.totalMs }, null, 2));
