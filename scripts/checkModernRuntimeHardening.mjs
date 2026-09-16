import assert from 'node:assert/strict';
import { createAdaptiveQualityController, createQualityDecisionTable, validateQualityProfile } from '../src/3d/runtime/adaptiveQualityController.js';
import { createDeterministicRuntimeScheduler, partitionElapsed, validateSchedulerSnapshot } from '../src/3d/runtime/deterministicRuntimeScheduler.js';
import { createInputCommandBuffer, createMoveCommand, createActionCommand, validateInputCommand } from '../src/3d/runtime/inputCommandBuffer.js';
import { createMemoryPersistenceAdapter, createVersionedPersistenceLedger, createSaveThrottler } from '../src/3d/runtime/versionedPersistenceLedger.js';
import { createRuntimeTelemetryHub, summarizeFrameHistory, classifyFrameBudget } from '../src/3d/runtime/runtimeTelemetryHub.js';
import { createRuntimeHealthMonitor, combineHealthLevels } from '../src/3d/runtime/runtimeHealthMonitor.js';
import { createAssetResidencyCache, classifyResidencyPressure, createResidencyBudgetByQuality } from '../src/3d/runtime/assetResidencyCache.js';
import { createRuntimeFeatureFlagRegistry, createDefaultRuntimeFlags } from '../src/3d/runtime/runtimeFeatureFlagRegistry.js';
import { classifyPlatformProfile, capabilityWarnings, createCapabilityMatrix, canPersistSafely } from '../src/3d/runtime/platformCapabilityProbe.js';
import { createRuntimeSnapshot, stableStringify, compareVersions } from '../src/3d/runtime/modernRuntimeContract.js';

const failures = [];
const checks = [];
function check(name, callback) {
  try {
    callback();
    checks.push({ name, status: 'pass' });
  } catch (error) {
    failures.push({ name, error });
    checks.push({ name, status: 'fail', message: error?.message || String(error) });
  }
}

async function checkAsync(name, callback) {
  try {
    await callback();
    checks.push({ name, status: 'pass' });
  } catch (error) {
    failures.push({ name, error });
    checks.push({ name, status: 'fail', message: error?.message || String(error) });
  }
}

check('contract.snapshot-normalization', () => {
  const snapshot = createRuntimeSnapshot({
    sessionId: 'acceptance',
    phase: 'present',
    visibility: 'visible',
    timestampMs: 42,
    frame: { deltaMs: 16, fps: 62, cpuMs: 3, gpuMs: 2 },
    world: { tick: 7, entityCount: 100 },
    quality: { tier: 'high', scale: 1.25 },
  });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.phase, 'present');
  assert.equal(snapshot.quality.tier, 'high');
  assert.equal(snapshot.world.tick, 7);
});

check('contract.stable-stringify', () => {
  const a = stableStringify({ z: 1, a: { y: 2, x: 3 } });
  const b = stableStringify({ a: { x: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
});

check('contract.version-compare', () => {
  assert(compareVersions('1.2.0', '1.1.9') > 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert(compareVersions('2.0', '10.0') < 0);
});

check('quality.profiles', () => {
  const table = createQualityDecisionTable();
  assert.equal(table.length, 5);
  assert.equal(table[0].tier, 'minimal');
  assert.equal(table[4].tier, 'ultra');
  for (const row of table) assert(validateQualityProfile(row.profile).valid);
});

check('quality.pressure-down', () => {
  const controller = createAdaptiveQualityController({ initialTier: 'high', capabilities: { webgl: true, hardwareConcurrency: 8, devicePixelRatio: 1 } });
  controller.force('high', 0, 'test');
  for (let i = 0; i < 80; i += 1) controller.sample({ timestampMs: i * 100, deltaMs: 35, cpuMs: 20, gpuMs: 16 });
  assert.notEqual(controller.tier, 'ultra');
  assert(['low', 'medium', 'high'].includes(controller.tier));
});

check('quality.recovery-up', () => {
  const controller = createAdaptiveQualityController({ initialTier: 'low', capabilities: { webgl: true, hardwareConcurrency: 8, devicePixelRatio: 1 } });
  controller.force('low', 0, 'test');
  for (let i = 0; i < 80; i += 1) controller.sample({ timestampMs: i * 100, deltaMs: 8, cpuMs: 1, gpuMs: 1 });
  assert.notEqual(controller.tier, 'minimal');
});

check('quality.lock', () => {
  const controller = createAdaptiveQualityController({ initialTier: 'medium', locked: true });
  const before = controller.tier;
  for (let i = 0; i < 100; i += 1) controller.sample({ timestampMs: i * 200, deltaMs: 50, cpuMs: 50, gpuMs: 50 });
  assert.equal(controller.tier, before);
});

check('scheduler.fixed-step', () => {
  const scheduler = createDeterministicRuntimeScheduler({ fixedStepMs: 10, maxCatchupMs: 100, maxStepsPerFrame: 8 });
  let ticks = 0;
  scheduler.frame(35, { simulate() { ticks += 1; } });
  assert.equal(ticks, 3);
  assert.equal(scheduler.tick, 3);
  assert(scheduler.snapshot().accumulatorMs >= 0);
});

check('scheduler.spiral-guard', () => {
  const scheduler = createDeterministicRuntimeScheduler({ fixedStepMs: 10, maxCatchupMs: 500, maxStepsPerFrame: 2 });
  const result = scheduler.frame(100, { simulate() {} });
  assert.equal(result.steps, 2);
  assert.equal(result.spiralGuard, true);
});

check('scheduler.seek-forward', () => {
  const scheduler = createDeterministicRuntimeScheduler({ fixedStepMs: 20 });
  let count = 0;
  const result = scheduler.seek(100, { simulate() { count += 1; } });
  assert.equal(count, 5);
  assert.equal(result.tick, 5);
});

check('scheduler.partition', () => {
  const result = partitionElapsed(105, 16.666, 6);
  assert.equal(result.chunks.length, 6);
  assert(result.remainderMs > 0);
});

check('scheduler.snapshot-contract', () => {
  const scheduler = createDeterministicRuntimeScheduler();
  const validation = validateSchedulerSnapshot(scheduler.snapshot());
  assert.equal(validation.valid, true);
});

check('input.semantic-buffer', () => {
  const input = createInputCommandBuffer({ capacity: 64, deadzone: 0.1 });
  input.push(createMoveCommand(0.8, -0.4, { tick: 1 }));
  input.push(createActionCommand('primary', 'pressed', { tick: 1 }));
  input.push(createActionCommand('primary', 'released', { tick: 2 }));
  const commands = input.drainUntil(1, { includeHeld: false });
  assert.equal(commands.length, 2);
  assert.equal(commands[0].tick, 1);
});

check('input.held-state', () => {
  const input = createInputCommandBuffer();
  input.push({ action: 'primary', phase: 'pressed', tick: 1, value: 1 });
  const commands = input.drainUntil(1, { includeHeld: true });
  assert(commands.some((command) => command.action === 'primary'));
  assert.equal(input.isHeld('primary'), true);
});

check('input.release-all', () => {
  const input = createInputCommandBuffer();
  input.push({ action: 'primary', phase: 'pressed', tick: 1 });
  input.push({ action: 'move', phase: 'held', tick: 1, vector: { x: 1, y: 0 } });
  const released = input.releaseAll(2, 20);
  assert.equal(released.length, 2);
  assert.equal(input.isHeld('primary'), false);
});

check('input.command-validation', () => {
  assert.equal(validateInputCommand(createActionCommand('dodge')).valid, true);
  assert.equal(validateInputCommand({ action: '', phase: '???', value: NaN }).valid, false);
});

checkAsync('persistence.round-trip', async () => {
  const adapter = createMemoryPersistenceAdapter();
  const ledger = createVersionedPersistenceLedger({ adapter, schemaVersion: 2 });
  ledger.registerMigration(1, (payload) => ({ ...payload, migrated: true }));
  const first = await ledger.save({ score: 10, migrated: true }, { tick: 12, timestampMs: 100 });
  assert.equal(first.revision, 1);
  const loaded = await ledger.load();
  assert.equal(loaded.found, true);
  assert.equal(loaded.payload.score, 10);
});

checkAsync('persistence.corruption-recovery', async () => {
  const adapter = createMemoryPersistenceAdapter({ 'aapw.save.a': '{broken' });
  const ledger = createVersionedPersistenceLedger({ adapter });
  const loaded = await ledger.load();
  assert.equal(loaded.found, false);
  const inspection = await ledger.inspect();
  assert.equal(inspection.corruptions >= 1, true);
});

checkAsync('persistence.throttle', async () => {
  let saves = 0;
  const throttler = createSaveThrottler(async () => { saves += 1; }, { intervalMs: 1000 });
  await throttler.request({ a: 1 }, 0, true);
  const queued = await throttler.request({ a: 2 }, 100);
  assert.equal(queued.queued, true);
  assert.equal(saves, 1);
});

check('telemetry.metrics', () => {
  const telemetry = createRuntimeTelemetryHub({ sessionId: 'test', historySize: 16 });
  telemetry.increment('frames', 1);
  telemetry.gauge('fps', 60);
  telemetry.observe('frame', 12);
  telemetry.observe('frame', 20);
  telemetry.event('test', { ok: true }, 42);
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.metrics.frames.value, 1);
  assert.equal(snapshot.metrics.frame.count, 2);
  assert.equal(snapshot.history.length, 1);
});

check('telemetry.frame-classification', () => {
  assert.equal(classifyFrameBudget(12, 16), 'healthy');
  assert.equal(classifyFrameBudget(18, 16), 'over-budget');
  assert.equal(classifyFrameBudget(50, 16), 'critical');
});

check('telemetry.summary', () => {
  const summary = summarizeFrameHistory([10, 12, 14, 16, 30]);
  assert.equal(summary.count, 5);
  assert(summary.p99 >= summary.p95);
});

check('health.degradation', () => {
  const monitor = createRuntimeHealthMonitor({ frameBudgetMs: 16 });
  for (let i = 0; i < 20; i += 1) monitor.sample({ deltaMs: 40, simulationMs: 10, presentationMs: 10, timestampMs: i * 16 });
  assert(['degraded', 'critical'].includes(monitor.health));
  assert.equal(monitor.recommend().action, 'reduce-quality');
});

check('health.recovery', () => {
  const monitor = createRuntimeHealthMonitor({ frameBudgetMs: 16 });
  for (let i = 0; i < 20; i += 1) monitor.sample({ deltaMs: 40, timestampMs: i * 16 });
  for (let i = 0; i < 200; i += 1) monitor.sample({ deltaMs: 10, timestampMs: 320 + i * 16 });
  assert(monitor.summary().recoveries >= 1);
});

check('health.combine', () => {
  assert.equal(combineHealthLevels('healthy', 'watch'), 'watch');
  assert.equal(combineHealthLevels('watch', 'critical'), 'critical');
});

check('residency.eviction', () => {
  const cache = createAssetResidencyCache({ capacityMb: 100, maxItems: 3 });
  cache.set('a', {}, { weightMb: 40, type: 'texture' }, 1);
  cache.set('b', {}, { weightMb: 30, type: 'mesh' }, 2);
  cache.set('c', {}, { weightMb: 20, type: 'audio' }, 3);
  cache.get('a', 4);
  cache.set('d', {}, { weightMb: 30, type: 'mesh' }, 5);
  assert(cache.size <= 3);
  assert(cache.usedMb <= 100);
});

check('residency.pinning', () => {
  const cache = createAssetResidencyCache({ capacityMb: 50, maxItems: 8 });
  cache.set('critical', {}, { weightMb: 30, pinned: true }, 1);
  cache.set('other', {}, { weightMb: 15 }, 2);
  const plan = cache.planEvictions(35);
  assert(plan.every((item) => item.key !== 'critical'));
});

check('residency.classification', () => {
  assert.equal(classifyResidencyPressure(20, 100), 'healthy');
  assert.equal(classifyResidencyPressure(90, 100), 'pressure');
  assert.equal(classifyResidencyPressure(98, 100), 'critical');
  assert(createResidencyBudgetByQuality('ultra') > createResidencyBudgetByQuality('low'));
});

check('flags.defaults', () => {
  const registry = createRuntimeFeatureFlagRegistry();
  registry.defineMany(createDefaultRuntimeFlags());
  assert.equal(registry.isEnabled('runtime.fixed-step'), true);
  assert.equal(registry.isEnabled('renderer.webgpu-experiment'), false);
  registry.setOverride('renderer.webgpu-experiment', true, 'test');
  assert.equal(registry.isEnabled('renderer.webgpu-experiment'), true);
});

check('flags.validation', () => {
  const registry = createRuntimeFeatureFlagRegistry();
  registry.define('quality-level', { type: 'enum', default: 'medium', allowed: ['low', 'medium', 'high'] });
  assert.throws(() => registry.setOverride('quality-level', 'ultra'));
  assert.equal(registry.validateAll().valid, true);
});

check('flags.audience-fail-safe', () => {
  const registry = createRuntimeFeatureFlagRegistry();
  registry.define('experiment', { type: 'boolean', default: true });
  registry.setAudience('experiment', () => { throw new Error('boom'); });
  assert.equal(registry.isEnabled('experiment', {}), false);
});

check('platform.classification', () => {
  assert.equal(classifyPlatformProfile({ capabilities: { webgl: false, webgpu: false } }), 'compatibility');
  assert.equal(classifyPlatformProfile({ capabilities: { webgl: true, hardwareConcurrency: 2 }, network: { saveData: true } }), 'constrained');
  assert.equal(classifyPlatformProfile({ capabilities: { webgpu: true, hardwareConcurrency: 12, devicePixelRatio: 1 }, memory: { deviceMemoryGb: 16 } }), 'performance');
});

check('platform.warning-surface', () => {
  const warnings = capabilityWarnings({ capabilities: { webgl: false, webgpu: false, indexedDb: false, serviceWorker: false, prefersReducedMotion: true }, network: { saveData: true } });
  assert(warnings.length >= 4);
  assert.equal(canPersistSafely({ indexedDb: false, localStorage: true }), true);
  assert.equal(createCapabilityMatrix({ capabilities: { webgpu: true, webgl: true } }).length >= 5, true);
});

check('cross-system.scheduler-input', () => {
  const scheduler = createDeterministicRuntimeScheduler({ fixedStepMs: 10 });
  const input = createInputCommandBuffer();
  let consumed = 0;
  input.push({ action: 'primary', phase: 'pressed', tick: 1 });
  scheduler.frame(25, {
    simulate(context) {
      input.setTick(context.tick);
      consumed += input.drainUntil(context.tick, { includeHeld: false }).length;
    },
  });
  assert.equal(consumed, 1);
});

check('cross-system-quality-health', () => {
  const quality = createAdaptiveQualityController({ initialTier: 'high' });
  const health = createRuntimeHealthMonitor();
  for (let i = 0; i < 30; i += 1) {
    const deltaMs = i < 20 ? 35 : 10;
    health.sample({ deltaMs, simulationMs: deltaMs * 0.3, presentationMs: deltaMs * 0.2, timestampMs: i * 100 });
    quality.sample({ deltaMs, cpuMs: deltaMs * 0.3, gpuMs: deltaMs * 0.2, timestampMs: i * 100 });
  }
  assert(quality.diagnostics().sampleCount === 30);
  assert(health.summary().frame.averageMs > 0);
});

check('determinism.scheduler-repeat', () => {
  const run = () => {
    const scheduler = createDeterministicRuntimeScheduler({ fixedStepMs: 16 });
    const ticks = [];
    scheduler.frame(16, { simulate(context) { ticks.push(context.tick); } });
    scheduler.frame(16, { simulate(context) { ticks.push(context.tick); } });
    scheduler.frame(32, { simulate(context) { ticks.push(context.tick); } });
    return JSON.stringify({ ticks, snapshot: scheduler.snapshot() });
  };
  assert.equal(run(), run());
});

check('determinism.quality-repeat', () => {
  const run = () => {
    const quality = createAdaptiveQualityController({ initialTier: 'medium', capabilities: { webgl: true, hardwareConcurrency: 8 } });
    const records = [];
    for (let i = 0; i < 80; i += 1) records.push(quality.sample({ timestampMs: i * 100, deltaMs: i < 30 ? 19 : 14, cpuMs: i < 30 ? 9 : 4, gpuMs: 3 }).tier);
    return JSON.stringify(records);
  };
  assert.equal(run(), run());
});

check('memory.bounds', () => {
  const telemetry = createRuntimeTelemetryHub({ historySize: 8, maxPayloadBytes: 512 });
  for (let i = 0; i < 100; i += 1) telemetry.event('large', { text: 'x'.repeat(5000), i }, i);
  assert(telemetry.snapshot().history.length <= 8);
});

const report = {
  valid: failures.length === 0,
  checks: checks.length,
  passed: checks.filter((checkItem) => checkItem.status === 'pass').length,
  failed: failures.length,
  failures: failures.map((failure) => ({ name: failure.name, message: failure.error?.message || String(failure.error) })),
};

console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 1;
