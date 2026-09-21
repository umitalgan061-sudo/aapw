import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplicationRuntimeConfig, getQualityProfile, inferQualityTier, adaptBudget, scaleQuality } from '../../src/3d/modern/app/appConfig.ts';
import { CommandBus, InputCommandSystem, createDefaultBindings, mapToPlayerInput } from '../../src/3d/modern/app/inputCommandSystem.ts';
import { FrameScheduler } from '../../src/3d/modern/app/frameScheduler.ts';
import { PerformanceGovernor } from '../../src/3d/modern/app/performanceGovernor.ts';
import { AssetCatalog, assetDescriptor } from '../../src/3d/modern/app/assetCatalog.ts';
import { SaveSlotManager } from '../../src/3d/modern/app/saveSlotManager.ts';
import { NetworkSessionTimeline, classifyConnection } from '../../src/3d/modern/app/networkSession.ts';
import { WorldQueryService } from '../../src/3d/modern/app/worldQueryService.ts';
import { TelemetryPipeline } from '../../src/3d/modern/app/telemetryPipeline.ts';
import { AccessibilityProfileStore, DEFAULT_ACCESSIBILITY, createCssAccessibilityVariables } from '../../src/3d/modern/app/accessibilityProfile.ts';
import { RuntimeErrorBoundary } from '../../src/3d/modern/app/errorBoundary.ts';
import { ApplicationKernel } from '../../src/3d/modern/app/applicationKernel.ts';
import { defaultPlayerState } from '../../src/3d/modern/playerAuthority.ts';

class MemorySaveAdapter {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  read(key: string): string | null { return this.#values.get(key) ?? null; }
  write(key: string, value: string): void { this.#values.set(key, value); }
  remove(key: string): void { this.#values.delete(key); }
}

describe('application config', () => {
  it('creates a bounded deterministic runtime config', () => {
    const config = createApplicationRuntimeConfig({ worldSeed: 123, quality: 'high', fixedStepMs: 12 });
    expect(config.worldSeed).toBe(123);
    expect(config.fixedStepMs).toBe(12);
    expect(config.quality.tier).toBe('high');
    expect(config.frame.targetFrameMs).toBe(16.67);
    expect(config.security.maxPayloadBytes).toBeGreaterThan(0);
  });
  it('selects conservative quality on constrained devices', () => {
    expect(inferQualityTier({ coarsePointer: true, memoryGb: 4 })).toBe('battery');
    expect(inferQualityTier({ memoryGb: 6, cores: 4 })).toBe('performance');
    expect(inferQualityTier({ memoryGb: 32, cores: 16 })).toBe('ultra');
    expect(getQualityProfile('balanced').maxVisibleEntities).toBeGreaterThan(0);
  });
  it('adapts budgets without producing invalid values', () => {
    const base = createApplicationRuntimeConfig().initialBudget;
    const stressed = adaptBudget(base, { framePressure: 1, memoryPressure: 1, networkPressure: 1 });
    expect(stressed.cpuMs).toBeLessThan(base.cpuMs);
    expect(stressed.entities).toBeLessThan(base.entities);
    expect(stressed.memoryMb).toBeGreaterThanOrEqual(384);
    expect(scaleQuality(getQualityProfile('high'), 0.8).pixelRatioCap).toBeLessThanOrEqual(getQualityProfile('high').pixelRatioCap);
  });
});

describe('command input', () => {
  it('queues, consumes and bounds commands', () => {
    const bus = new CommandBus(32);
    for (let i = 0; i < 40; i += 1) bus.dispatch({ id: 'x-' + i, type: 'test', payload: i, source: 'system', issuedAtMs: i });
    expect(bus.pendingCount()).toBe(32);
    expect(bus.droppedCount()).toBe(8);
    expect(bus.consume('test')?.payload).toBe(8);
    expect(bus.pendingCount()).toBe(31);
  });
  it('maps keyboard actions into player authority input', () => {
    const input = new InputCommandSystem();
    input.bindMany(createDefaultBindings());
    input.setKey('KeyW', true);
    input.setKey('ShiftLeft', true);
    input.setKey('Space', true);
    input.setPointer(100, 100, 3, -4);
    const snapshot = input.sample(10);
    const player = mapToPlayerInput(snapshot);
    expect(player.moveZ).toBeLessThan(0);
    expect(player.sprint).toBe(true);
    expect(player.jumpPressed).toBe(true);
    expect(player.aimX).toBe(3);
  });
  it('distinguishes just pressed from held actions', () => {
    const input = new InputCommandSystem();
    input.bind({ action: 'jump', source: 'keyboard', code: 'Space' });
    input.setKey('Space', true);
    expect(input.sample(1).actions.jump?.justPressed).toBe(true);
    expect(input.sample(2).actions.jump?.justPressed).toBe(false);
    input.setKey('Space', false);
    expect(input.sample(3).actions.jump?.justReleased).toBe(true);
  });
});

describe('frame scheduler', () => {
  it('runs dependency-ordered services and advances fixed ticks', () => {
    let now = 0;
    const calls: string[] = [];
    const scheduler = new FrameScheduler({ now: () => now, policy: { fixedStepMs: 10, maxCatchUpSteps: 4 } });
    scheduler.register({ id: 'simulation', subsystem: 'simulation', priority: 'critical', dependencies: [], start: () => { calls.push('start-simulation'); }, update: () => { calls.push('simulation'); }, stop: () => { calls.push('stop-simulation'); } });
    scheduler.register({ id: 'render', subsystem: 'render', priority: 'normal', dependencies: ['simulation'], start: () => { calls.push('start-render'); }, update: () => { calls.push('render'); }, stop: () => { calls.push('stop-render'); } });
    const seed = { input: { axes: {}, buttons: {}, pointer: { x: 0, y: 0, dx: 0, dy: 0, locked: false }, actions: {} }, capabilities: { webgl2: false, webgpu: false, sharedArrayBuffer: false, offscreenCanvas: false, gamepad: false, touch: false, reducedMotion: false, saveStorage: false }, features: [], budget: createApplicationRuntimeConfig().initialBudget, commandBus: new CommandBus(), report: vi.fn() } as const;
    scheduler.start(seed);
    now = 16;
    const report = scheduler.step(seed);
    expect(calls.slice(0, 2)).toEqual(['start-simulation', 'start-render']);
    expect(calls).toContain('simulation');
    expect(report.frame).toBe(1);
    expect(report.simulationSteps).toBeGreaterThan(0);
  });
  it('rejects circular dependencies', async () => {
    const scheduler = new FrameScheduler({ now: () => 0 });
    const service = (id: string, dependency: string) => ({ id, subsystem: 'simulation' as const, priority: 'normal' as const, dependencies: [dependency], start: () => undefined, update: () => undefined, stop: () => undefined });
    scheduler.register(service('a', 'b'));
    scheduler.register(service('b', 'a'));
    const seed = { input: { axes: {}, buttons: {}, pointer: { x: 0, y: 0, dx: 0, dy: 0, locked: false }, actions: {} }, capabilities: { webgl2: false, webgpu: false, sharedArrayBuffer: false, offscreenCanvas: false, gamepad: false, touch: false, reducedMotion: false, saveStorage: false }, features: [], budget: createApplicationRuntimeConfig().initialBudget, commandBus: new CommandBus(), report: vi.fn() } as const;
    await expect(scheduler.start(seed)).rejects.toThrow('dependency cycle');
  });
});

describe('performance governor', () => {
  it('transitions from healthy to stressed under sustained frame pressure', () => {
    const config = createApplicationRuntimeConfig();
    const governor = new PerformanceGovernor(config.frame, 30);
    for (let i = 0; i < 12; i += 1) governor.push({ frameMs: 34, cpuMs: 20, renderMs: 18, memoryMb: 1500, timestampMs: i * 16 });
    const decision = governor.current();
    expect(decision.pressure).toBeGreaterThan(0);
    expect(decision.band).toBe('critical');
    expect(decision.recommendations.length).toBeGreaterThan(0);
  });
});

describe('asset catalog', () => {
  it('tracks readiness and resident bytes', () => {
    let now = 0;
    const catalog = new AssetCatalog({ maxBytes: 1024, now: () => now });
    catalog.declare(assetDescriptor({ id: 'hero', kind: 'model', url: '/hero.glb', priority: 10, critical: true }));
    now = 10;
    catalog.markLoading('hero');
    const ready = catalog.markReady('hero', 512);
    expect(ready?.state).toBe('ready');
    expect(catalog.residentBytes()).toBe(512);
    catalog.touch('hero');
    expect(catalog.utilization()).toBe(0.5);
  });
  it('evicts noncritical cold assets before critical ones', () => {
    const catalog = new AssetCatalog({ maxBytes: 1024, now: () => 100 });
    catalog.declare(assetDescriptor({ id: 'critical', kind: 'texture', url: '/a', priority: 100, critical: true }));
    catalog.markReady('critical', 512);
    catalog.declare(assetDescriptor({ id: 'cold', kind: 'texture', url: '/b', priority: 0, critical: false }));
    catalog.markReady('cold', 512);
    expect(catalog.selectEvictions(512).map((asset) => asset.id)).toEqual(['cold']);
  });
});

describe('save slots', () => {
  it('saves, lists, inspects and loads a valid runtime state', () => {
    const adapter = new MemorySaveAdapter();
    const saves = new SaveSlotManager({ adapter, prefix: 'test.save', now: () => 1000 });
    const player = defaultPlayerState('player-1');
    const result = saves.save('slot one', 'world-1', player, [], { music: true });
    expect(result.ok).toBe(true);
    expect(saves.list()).toContain('slot_one');
    expect(saves.inspect('slot_one')?.worldId).toBe('world-1');
    expect(saves.load('slot_one').ok).toBe(true);
  });
});

describe('network session', () => {
  it('maintains bounded peer, input and snapshot state', () => {
    const session = new NetworkSessionTimeline({ maxPeers: 2, maxInputs: 4, maxSnapshots: 2, now: () => 50 });
    expect(session.transition('connecting')).toBe(true);
    expect(session.transition('connected')).toBe(true);
    session.upsertPeer({ id: 'peer-1', role: 'client', lastSeenTick: 10, rttMs: 40, packetLoss: 0.01, interestRadius: 100, reliable: true });
    session.queueInput({ tick: 1, sequence: 1, payload: { move: 1 } });
    session.queueInput({ tick: 2, sequence: 2, payload: { move: 2 } });
    expect(session.consumeInputsThrough(1)).toHaveLength(1);
    session.recordSnapshot({ tick: 2, bytes: 100, entityCount: 4, digest: 'x' });
    expect(session.metrics().snapshots).toBe(1);
    expect(classifyConnection(500, 0.01)).toBe('degraded');
  });
});

describe('world queries', () => {
  it('returns deterministic sorted sphere and ray hits', () => {
    const world = new WorldQueryService();
    world.upsert({ id: 'b', position: { x: 3, y: 0, z: 0 }, radius: 1, tags: ['npc'], active: true, layer: 1 });
    world.upsert({ id: 'a', position: { x: 2, y: 0, z: 0 }, radius: 1, tags: ['npc'], active: true, layer: 1 });
    expect(world.sphere({ center: { x: 0, y: 0, z: 0 }, radius: 5, tag: 'npc' }).map((item) => item.id)).toEqual(['a', 'b']);
    expect(world.ray({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 10, tag: 'npc' })[0]?.id).toBe('a');
  });
});

describe('telemetry and accessibility', () => {
  it('bounds telemetry and computes histogram summary', () => {
    const telemetry = new TelemetryPipeline(16);
    for (let i = 0; i < 32; i += 1) telemetry.observe('frame', i);
    const snapshot = telemetry.snapshot();
    expect(snapshot.dropped).toBeGreaterThan(0);
    expect(Object.keys(snapshot.histograms).length).toBeGreaterThan(0);
  });
  it('normalizes accessibility choices and exposes CSS variables', () => {
    const store = new AccessibilityProfileStore({ textScale: 'xlarge', reducedMotion: true, cameraShake: 0.2 });
    const profile = store.update({ contrast: 'high', aimAssist: 1 });
    expect(profile.textScale).toBe('xlarge');
    expect(store.effectiveMotionScale()).toBe(0.25);
    expect(createCssAccessibilityVariables(profile)['--aapw-text-scale']).toBe('1.45');
    expect(DEFAULT_ACCESSIBILITY.subtitles).toBe(true);
  });
});

describe('error boundary', () => {
  it('captures recoverable errors and completes recovery attempts', () => {
    const boundary = new RuntimeErrorBoundary({ now: () => 100 });
    boundary.capture(new Error('boom'), { phase: 'running', subsystem: 'simulation', recoverable: true });
    expect(boundary.canRecover()).toBe(true);
    const attempt = boundary.beginRecovery('reset-simulation', 'recover test');
    expect(attempt?.strategy).toBe('reset-simulation');
    expect(boundary.completeRecovery(true)?.successful).toBe(true);
    expect(boundary.fatal()).toBe(false);
  });
});

describe('application kernel', () => {
  it('boots and advances a real modern orchestrator frame without browser renderer state', async () => {
    let now = 0;
    const kernel = new ApplicationKernel({ now: () => now, config: { worldSeed: 7, quality: 'performance' } });
    await kernel.boot();
    kernel.input.setKey('KeyW', true);
    now = 17;
    const frame = kernel.frame(16.67);
    expect(kernel.phase()).toBe('running');
    expect(frame.runtime.simulation.frame).toBe(1);
    expect(frame.runtime.simulation.player.id).toBe('player-1');
    expect(frame.telemetryDigest.length).toBeGreaterThan(0);
    const saved = kernel.save('smoke');
    expect(saved.ok).toBe(true);
    await kernel.stop();
    expect(kernel.phase()).toBe('stopped');
  });
});

describe('player contract regression', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('keeps player state structurally stable for modern consumers', () => {
    const state = defaultPlayerState('test');
    expect(state.transform).toHaveProperty('x');
    expect(state.stats.maxHealth).toBeGreaterThan(0);
    expect(state.stats.maxStamina).toBeGreaterThan(0);
    expect(state.revision).toBe(0);
  });
});

