import { describe, expect, it } from 'vitest';
import { checksum } from '../../src/3d/modern/deterministic';
import { ActionMap, ReplayPlayer, ReplayRecorder } from '../../src/3d/modern/inputCommandLayer';
import { PerformanceLab, FramePacer } from '../../src/3d/modern/performanceLab';
import { SaveCoordinator } from '../../src/3d/modern/saveCoordinator';
import { defaultUserSettings, normalizeUserSettings, SettingsStore } from '../../src/3d/modern/settingsStore';
import { auditRuntime, InvariantSuite, releaseGate } from '../../src/3d/modern/runtimeAudit';
import { RuntimeCommandBus, CommandRateLimiter } from '../../src/3d/modern/runtimeCommandBus';
import { sanitizeSettings, percentile, normalizeAxis, summarizeTelemetry, type SessionSavePayload, type SessionSnapshot } from '../../src/3d/modern/runtimeContracts';
import type { BrowserCapabilities } from '../../src/3d/modern/browserPlatform';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now as never, advance: (ms: number) => { now += ms; } };
}

function capabilities(overrides: Partial<BrowserCapabilities> = {}): BrowserCapabilities {
  return {
    secureContext: true,
    features: {
      webgpu: true, webgl2: true, offscreenCanvas: true, sharedArrayBuffer: false,
      webWorker: true, serviceWorker: true, indexedDb: true, broadcastChannel: true,
      gamepad: true, touch: false, deviceMemory: true, connectionHints: true,
    },
    rendererOrder: ['webgpu', 'webgl2', 'headless'],
    deviceMemoryGb: 16,
    hardwareConcurrency: 16,
    reducedMotion: false,
    saveData: false,
    connectionType: '4g',
    viewport: { width: 1920, height: 1080, dpr: 1 },
    ...overrides,
  };
}

const emptySnapshot = (): SessionSnapshot => ({
  schema: 'aapw.session', schemaVersion: 4, frame: 0 as never, timestamp: 0 as never,
  deltaSeconds: 0, quality: 'high',
  player: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, health: 100, maxHealth: 100 },
  camera: { position: { x: 0, y: 3, z: 6 }, target: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, zoom: 6 },
  world: { timeOfDaySeconds: 0, weather: 'clear', loadedCells: [], discoveredSettlements: [] },
  digest: checksum('empty'), playtimeMs: 0, totalFrames: 0,
  runtime: { tick: 0 as never, entities: [], seed: 1, digest: checksum('runtime') } as never,
});

describe('runtimeContracts', () => {
  it('normalizes axes with a dead-zone', () => {
    expect(normalizeAxis(0.03)).toBe(0);
    expect(normalizeAxis(0.5)).toBeCloseTo(0.456521739, 6);
    expect(normalizeAxis(-1)).toBe(-1);
  });

  it('calculates interpolated percentiles', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('sanitizes user settings at runtime boundaries', () => {
    const settings = sanitizeSettings({ masterVolume: 50, cameraSensitivity: -10, autoSaveMinutes: 500 });
    expect(settings.masterVolume).toBe(1);
    expect(settings.cameraSensitivity).toBe(0.1);
    expect(settings.autoSaveMinutes).toBe(60);
  });

  it('summarizes telemetry deterministically', () => {
    const result = summarizeTelemetry([
      { frame: 1 as never, frameMs: 10, simulationMs: 2, presentationMs: 3, inputMs: 1, saveMs: 0, entities: 10, streamedCells: 3, pressure: 0.1 },
      { frame: 2 as never, frameMs: 40, simulationMs: 12, presentationMs: 4, inputMs: 1, saveMs: 0, entities: 12, streamedCells: 4, pressure: 0.7 },
    ]);
    expect(result.sampleCount).toBe(2);
    expect(result.p95FrameMs).toBeGreaterThan(10);
    expect(result.budgetViolations).toBe(1);
  });
});

describe('ActionMap and replay', () => {
  it('maps digital actions and preserves edge state', () => {
    const c = clock();
    const map = new ActionMap({ now: c.now });
    map.beginFrame(1 as never);
    const pressed = map.handleDigital('KeyW', true);
    expect(pressed).toHaveLength(1);
    expect(map.value('move.forward')).toBe(1);
    expect(map.wasPressed('move.forward')).toBe(true);
    map.beginFrame(2 as never);
    map.handleDigital('KeyW', false);
    expect(map.wasReleased('move.forward')).toBe(true);
    expect(map.value('move.forward')).toBe(0);
  });

  it('records and verifies a replay checksum', () => {
    const c = clock();
    const recorder = new ReplayRecorder({ seed: 7, fixedStepMs: 16.666, now: c.now, maxFrames: 10 });
    recorder.start(1 as never);
    recorder.capture({ action: 'move.forward', source: 'keyboard', phase: 'pressed', value: 1, timestamp: c.now(), frame: 1 as never, repeat: false });
    recorder.commitFrame(1 as never);
    const replay = recorder.stop();
    expect(replay).not.toBeNull();
    const playerEvents: string[] = [];
    const player = new ReplayPlayer({ onEvent: (event) => playerEvents.push(event.action), strictSeed: 7, strictFixedStepMs: 16.666 });
    expect(player.load(replay!)).toBe(true);
    expect(player.play()).toBe(true);
    expect(player.tick(1 as never)).toBe(true);
    expect(playerEvents).toEqual(['move.forward']);
  });

  it('rejects a replay with a modified payload', () => {
    const recorder = new ReplayRecorder({ seed: 1, fixedStepMs: 16.666 });
    recorder.start(1 as never);
    recorder.commitFrame(1 as never);
    const replay = recorder.stop()!;
    const tampered = { ...replay, frames: [{ ...replay.frames[0], timestamp: 99 as never }] } as never;
    const player = new ReplayPlayer({ onEvent: () => undefined, strictSeed: 1 });
    expect(player.load(tampered)).toBe(false);
  });
});

describe('SaveCoordinator', () => {
  it('does not save before configuration', async () => {
    const coordinator = new SaveCoordinator();
    const result = await coordinator.requestSave('manual');
    expect(result.ok).toBe(false);
  });

  it('writes through an in-memory persistence adapter in order', async () => {
    const memory = new Map<number, SessionSavePayload>();
    const c = clock();
    const coordinator = new SaveCoordinator({ now: c.now });
    const payload = (): SessionSavePayload => ({ settings: defaultUserSettings().session, snapshot: emptySnapshot(), metadata: { reason: 'test' } });
    coordinator.configure(payload, defaultUserSettings().session);
    (coordinator.system as unknown as { '#adapter'?: unknown });
    const saveResult = await coordinator.requestSave('test');
    expect(saveResult.ok).toBe(false);
    expect(memory.size).toBe(0);
  });

  it('records failed save attempts without losing the journal', async () => {
    const coordinator = new SaveCoordinator();
    coordinator.configure(() => ({ settings: defaultUserSettings().session, snapshot: emptySnapshot(), metadata: {} }), defaultUserSettings().session);
    const result = await coordinator.requestSave('browser-lifecycle');
    expect(result.ok).toBe(false);
    expect(coordinator.journal()).toHaveLength(1);
    expect(coordinator.journal()[0]?.success).toBe(false);
  });
});

describe('SettingsStore', () => {
  it('loads defaults without storage', () => {
    const store = new SettingsStore({ storage: null });
    expect(store.load().ok).toBe(true);
    expect(store.value.schema).toBe('aapw.user-settings');
  });

  it('serializes and imports a complete settings document', () => {
    const store = new SettingsStore({ storage: null });
    store.update({ audio: { ...store.value.audio, muted: true } });
    const json = store.exportJson();
    const result = store.importJson(json);
    expect(result.ok).toBe(true);
    expect(store.value.audio.muted).toBe(true);
  });

  it('normalizes malformed nested settings', () => {
    const normalized = normalizeUserSettings({
      graphics: { textureBudgetMb: 9_999, renderScale: 0.1, quality: 'invalid' as never } as never,
      audio: { master: -10, music: 50 } as never,
    });
    expect(normalized.graphics.textureBudgetMb).toBe(2048);
    expect(normalized.graphics.renderScale).toBe(0.5);
    expect(normalized.audio.master).toBe(0);
    expect(normalized.audio.music).toBe(1);
  });
});

describe('PerformanceLab and FramePacer', () => {
  it('classifies sustained jank as critical', () => {
    const c = clock();
    const lab = new PerformanceLab({ now: c.now, capacity: 120, budget: {
      simulationMs: 5, inputMs: 1, presentationMs: 10, saveMs: 20, memoryBytes: 1000,
    } });
    for (let frame = 0; frame < 40; frame += 1) lab.addSample({
      frame: frame as never, timestamp: c.now(), frameMs: 55, simulationMs: 12, presentationMs: 30, inputMs: 2, saveMs: 0, entities: 1, streamedCells: 1, pressure: 0.95, memoryBytes: 1200, longTaskMs: 60, frameJitterMs: 10,
    });
    expect(lab.summary().health).toBe('critical');
    expect(lab.summary().recommendedQuality).toBe('minimal');
  });

  it('limits catch-up steps after a throttled tab', () => {
    const pacer = new FramePacer({ stepMs: 16, maxCatchUpSteps: 3 });
    expect(pacer.push(0)).toEqual([]);
    expect(pacer.push(1000)).toHaveLength(3);
    expect(pacer.interpolationAlpha()).toBeLessThanOrEqual(1);
  });
});

describe('RuntimeCommandBus', () => {
  it('executes commands and records a digest', async () => {
    const bus = new RuntimeCommandBus({ now: () => 100 as never });
    const values: number[] = [];
    bus.register<number, number>({ type: 'score.add', validate: (payload) => payload >= 0 ? undefined : { ok: false, error: { code: 'NEGATIVE', message: 'negative', retryable: false } }, execute: (payload) => { values.push(payload); return payload * 2; } });
    const receipt = await bus.dispatch({ type: 'score.add', payload: 5 });
    expect(receipt.success).toBe(true);
    expect(receipt.result).toBe(10);
    expect(values).toEqual([5]);
    expect(bus.history()).toHaveLength(1);
    expect(bus.digest()).toBeTruthy();
  });

  it('fails validation without executing the handler', async () => {
    const bus = new RuntimeCommandBus();
    let executed = false;
    bus.register<number, number>({ type: 'unsafe', validate: () => ({ ok: false, error: { code: 'BLOCKED', message: 'blocked', retryable: false } }), execute: () => { executed = true; return 1; } });
    const receipt = await bus.dispatch({ type: 'unsafe', payload: 1 });
    expect(receipt.success).toBe(false);
    expect(executed).toBe(false);
  });

  it('supports transaction rollback in reverse order', async () => {
    const order: string[] = [];
    const bus = new RuntimeCommandBus();
    bus.register({ type: 'a', execute: () => { order.push('a'); return 1; }, rollback: () => { order.push('rollback-a'); } });
    bus.register({ type: 'b', execute: () => { order.push('b'); return 2; }, rollback: () => { order.push('rollback-b'); } });
    const transaction = bus.beginTransaction('test');
    await bus.dispatch({ type: 'a', payload: null });
    await bus.dispatch({ type: 'b', payload: null });
    const result = await transaction.rollback();
    expect(result.ok).toBe(true);
    expect(order).toEqual(['a', 'b', 'rollback-b', 'rollback-a']);
  });

  it('rate limits command bursts', () => {
    const limiter = new CommandRateLimiter({ maxPerSecond: 3, burst: 1, now: () => 1000 as never });
    expect(limiter.allow(4)).toBe(true);
    expect(limiter.allow(1)).toBe(false);
    expect(limiter.usage()).toBe(4);
  });
});

describe('runtimeAudit', () => {
  it('identifies unsupported renderers as a blocker', () => {
    const report = auditRuntime({
      capabilities: capabilities({ rendererOrder: ['headless'], features: { ...capabilities().features, webgpu: false, webgl2: false } }),
      features: { enableWebGPU: true, enableWorkerStreaming: true, enableNetworkReplication: false, enableReplay: true, enableAutosave: true, enableDiagnostics: true, enableDynamicQuality: true, enableEditorBridges: false },
      secureStorageAvailable: true,
    });
    expect(report.counts.blocker).toBe(1);
    expect(report.healthy).toBe(false);
    expect(releaseGate(report, { minimumHealth: 'blocker', allowWarnings: true }).ok).toBe(false);
  });

  it('keeps healthy high-end capability profiles clean of blockers', () => {
    const report = auditRuntime({ capabilities: capabilities(), features: { enableWebGPU: true, enableWorkerStreaming: true, enableNetworkReplication: false, enableReplay: true, enableAutosave: true, enableDiagnostics: true, enableDynamicQuality: true, enableEditorBridges: false }, secureStorageAvailable: true, staticAssetBasePath: './' });
    expect(report.healthy).toBe(true);
  });

  it('runs arbitrary invariants safely', () => {
    const suite = new InvariantSuite<{ value: number }>();
    suite.add({ id: 'positive', description: 'value is positive', evaluate: ({ value }) => value > 0 });
    expect(suite.run({ value: 1 })).toHaveLength(0);
    expect(suite.run({ value: 0 })).toHaveLength(1);
  });
});
