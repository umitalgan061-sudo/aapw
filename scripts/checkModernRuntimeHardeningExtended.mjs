import assert from 'node:assert/strict';
import { createModernRuntime, createRuntimeAcceptanceReport } from '../src/3d/runtime/modernRuntimeFacade.js';
import { createRuntimeRecoveryCoordinator, chooseRecoveryReason, validateRecoveryIntent } from '../src/3d/runtime/runtimeRecoveryCoordinator.js';
import { createRuntimeFeatureFlagRegistry, createDefaultRuntimeFlags } from '../src/3d/runtime/runtimeFeatureFlagRegistry.js';
import { createAssetResidencyCache } from '../src/3d/runtime/assetResidencyCache.js';
import { createRuntimeTelemetryHub } from '../src/3d/runtime/runtimeTelemetryHub.js';

const failures = [];
const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (error) {
    failures.push({ name, error });
    results.push({ name, passed: false, error: error?.message || String(error) });
  }
}

await run('recovery.context-loss-escalates', async () => {
  const recovery = createRuntimeRecoveryCoordinator({ cooldownMs: 1 });
  const first = recovery.record('renderer-context-lost', 10);
  const second = recovery.record('renderer-context-lost', 20);
  assert.equal(first.accepted, true);
  assert.equal(second.level, 'hard');
  assert.equal(validateRecoveryIntent(second).valid, true);
});

await run('recovery.cooldown-is-enforced', async () => {
  const recovery = createRuntimeRecoveryCoordinator({ cooldownMs: 1000 });
  const first = recovery.record('frame-stall', 10);
  const second = recovery.record('frame-stall', 50);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert(second.cooldownRemainingMs > 0);
});

await run('recovery.maintenance-resets-stale-state', async () => {
  const recovery = createRuntimeRecoveryCoordinator({ cooldownMs: 100, resetAfterMs: 200 });
  recovery.record('memory-pressure', 10);
  const state = recovery.maintenance(500);
  assert.equal(state.active, false);
  assert.deepEqual(state.reasons, []);
});

await run('recovery.reason-selection', async () => {
  assert.equal(chooseRecoveryReason({ contextLost: true }), 'renderer-context-lost');
  assert.equal(chooseRecoveryReason({ assetFailure: true, memoryPressure: true }), 'asset-load-failed');
  assert.equal(chooseRecoveryReason({ frameStall: true }), 'frame-stall');
  assert.equal(chooseRecoveryReason({}), 'unknown');
});

await run('facade.acceptance-surface', async () => {
  const runtime = await createModernRuntime({
    platform: { webgl: true, webgpu: false },
    scheduler: { fixedStepMs: 10 },
  });
  const report = createRuntimeAcceptanceReport(runtime);
  assert.equal(report.valid, true);
  runtime.shutdown();
});

await run('facade.hook-safety', async () => {
  const runtime = await createModernRuntime({ platform: { webgl: true, webgpu: false } });
  let starts = 0;
  runtime.attachHooks({ onStart() { starts += 1; } });
  await runtime.start();
  await runtime.stop();
  assert.equal(starts, 1);
  runtime.shutdown();
});

await run('facade.input-passthrough', async () => {
  const runtime = await createModernRuntime({ platform: { webgl: true, webgpu: false } });
  const command = runtime.ingestInput({ action: 'dodge', phase: 'pressed', tick: 1, value: 1 });
  assert.equal(command.action, 'dodge');
  assert.equal(runtime.input.length, 1);
  runtime.shutdown();
});

await run('flags.full-default-surface', async () => {
  const registry = createRuntimeFeatureFlagRegistry();
  registry.defineMany(createDefaultRuntimeFlags());
  const snapshot = registry.snapshot();
  assert(snapshot.revision > 0);
  assert(Object.keys(snapshot.flags).length >= 10);
});

await run('residency.explicit-eviction-does-not-dispose', async () => {
  let disposed = false;
  const cache = createAssetResidencyCache({ capacityMb: 20, maxItems: 2 });
  cache.set('asset', { dispose() { disposed = true; } }, { weightMb: 12 }, 1);
  cache.set('other', {}, { weightMb: 7 }, 2);
  const plan = cache.planEvictions(10);
  cache.executeEvictions(plan);
  assert.equal(disposed, false);
});

await run('telemetry.payload-bounded', async () => {
  const telemetry = createRuntimeTelemetryHub({ maxPayloadBytes: 512, historySize: 4 });
  telemetry.event('huge', { nested: { text: 'x'.repeat(10000) } }, 1);
  const json = telemetry.exportJson();
  assert(json.length < 4096);
});

await run('telemetry.subscriber-failure-is-contained', async () => {
  const telemetry = createRuntimeTelemetryHub({ historySize: 4 });
  telemetry.subscribe(() => { throw new Error('listener failed'); });
  assert.doesNotThrow(() => telemetry.event('safe', {}, 1));
});

await run('runtime.shutdown-is-idempotent', async () => {
  const runtime = await createModernRuntime({ platform: { webgl: true, webgpu: false } });
  assert.doesNotThrow(() => runtime.shutdown());
  assert.doesNotThrow(() => runtime.shutdown());
});

const report = {
  valid: failures.length === 0,
  checks: results.length,
  passed: results.filter((item) => item.passed).length,
  failed: failures.length,
  failures: failures.map((item) => ({ name: item.name, message: item.error?.message || String(item.error) })),
};
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 1;
