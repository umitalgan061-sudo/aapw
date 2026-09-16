import type { Disposable, FrameContext, Result, Tick } from './coreTypes.ts';
import { SIM_TIME_MS, TICK, clamp, err, ok } from './coreTypes.ts';
import { DeterministicScheduler, FixedStepClock, RuntimeMetrics, TypedEventBus } from './runtimeContracts.ts';
import { InputMapper } from './input.ts';
import { AssetRegistry, AssetStreamDirector, ResidencyController } from './assets.ts';
import { buildRenderPolicy, detectCapabilities, type RenderPolicy, type RenderQuality } from './renderBridge.ts';
import { WorldState, WorldSystemPipeline, type WorldSnapshot } from './world.ts';
import { SaveRepository, validateGameplaySnapshot, type GameplaySnapshot, type SaveSlot } from './persistence.ts';

export interface ModernEngineOptions {
  readonly seed?: string | number;
  readonly render?: {
    readonly quality?: RenderQuality;
    readonly preference?: 'auto' | 'webgpu' | 'webgl2';
    readonly gpuBudgetMs?: number;
  };
  readonly saveStorage?: StorageLike;
  readonly strictDeterminism?: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EngineFrameReport {
  readonly frameId: number;
  readonly tick: Tick;
  readonly simulationTimeMs: number;
  readonly renderPolicy: RenderPolicy;
  readonly scheduler: ReturnType<DeterministicScheduler['runFrame']>;
  readonly assetsResident: number;
  readonly assetsResidentBytes: number;
  readonly worldEntities: number;
}

const browserStorage = (): StorageLike | undefined => typeof localStorage !== 'undefined' ? localStorage : undefined;

export class ModernEngine implements Disposable {
  readonly events = new TypedEventBus();
  readonly scheduler = new DeterministicScheduler();
  readonly clock = new FixedStepClock();
  readonly metrics = new RuntimeMetrics();
  readonly input = new InputMapper();
  readonly assets = new AssetRegistry();
  readonly stream = new AssetStreamDirector();
  readonly world: WorldState;
  readonly worldSystems = new WorldSystemPipeline();
  readonly saves: SaveRepository<GameplaySnapshot>;
  readonly renderPolicy: RenderPolicy;
  private frameIdValue = 0;
  private initialized = false;
  private disposed = false;
  private lastFrameMs = 0;

  constructor(options: ModernEngineOptions = {}) {
    this.world = new WorldState(options.seed ?? 'aapw-modern-2026', this.events);
    const capabilities = detectCapabilities();
    const policy = buildRenderPolicy(capabilities, options.render);
    if (!policy.ok) throw new Error(policy.error);
    this.renderPolicy = policy.value;
    this.saves = new SaveRepository<GameplaySnapshot>(options.saveStorage ? storageAdapter(options.saveStorage) : undefined, { namespace: 'aapw:gameplay', maxPayloadBytes: 2_000_000 });
    this.clock.reset(0);
    this.installCoreSystems();
  }

  initialize(now = 0): void {
    if (this.disposed) throw new Error('engine disposed');
    if (this.initialized) return;
    this.initialized = true;
    this.clock.reset(now);
    this.lastFrameMs = now;
  }

  step(now: number): EngineFrameReport {
    if (this.disposed) throw new Error('engine disposed');
    if (!this.initialized) this.initialize(now);
    const inputFrame = this.input.advanceFrame(now);
    const clockSnapshot = this.clock.advance(now, (deltaSeconds, tick) => {
      const context: FrameContext = Object.freeze({
        tick,
        simulationTimeMs: SIM_TIME_MS(this.world.time.day * 86_400_000 + this.world.time.minuteOfDay * 60_000),
        deltaSeconds,
        interpolationAlpha: clockSnapshotSafeAlpha(this.clock),
        frameId: this.frameIdValue,
        budgetMs: this.renderPolicy.quality === 'ultra' ? 13 : 16.6,
        deadlineMs: now + 16.6,
      });
      this.events.emit('runtime/frame-begin', { context });
      this.scheduler.runFrame(context);
      this.events.emit('runtime/frame-end', { context, elapsedMs: deltaSeconds * 1000 });
    });
    this.frameIdValue += 1;
    const context: FrameContext = Object.freeze({ tick: clockSnapshot.tick, simulationTimeMs: clockSnapshot.simulationTimeMs, deltaSeconds: clockSnapshot.deltaSeconds, interpolationAlpha: clamp(clockSnapshot.accumulatorMs / (clockSnapshot.deltaSeconds * 1000), 0, 1), frameId: this.frameIdValue, budgetMs: 16.6, deadlineMs: now + 16.6 });
    const scheduler = this.scheduler.runFrame(context);
    this.metrics.increment('engine.frames', 1, clockSnapshot.tick);
    this.metrics.set('engine.input.actions', inputFrame.actions.size, clockSnapshot.tick);
    const usage = new ResidencyController(this.assets).usage();
    this.lastFrameMs = now;
    return Object.freeze({ frameId: this.frameIdValue, tick: clockSnapshot.tick, simulationTimeMs: clockSnapshot.simulationTimeMs, renderPolicy: this.renderPolicy, scheduler, assetsResident: usage.assets, assetsResidentBytes: usage.bytes, worldEntities: this.world.entities.length });
  }

  save(slot: SaveSlot, snapshot: GameplaySnapshot): Result<void, string> {
    if (!validateGameplaySnapshot(snapshot)) return err('invalid gameplay snapshot');
    const tick = TICK(this.world.revision);
    const saved = this.saves.save(slot, snapshot, { createdAtTick: tick, updatedAtTick: tick, playtimeSeconds: Math.max(0, this.world.time.day * 86_400 + this.world.time.minuteOfDay * 60), worldSeed: this.world.seed, phase: this.world.time.phase });
    if (!saved.ok) return err(saved.error);
    this.events.emit('save/committed', { slot, revision: saved.value.metadata.revision, checksum: saved.value.metadata.checksum });
    return ok(undefined);
  }

  load(slot: SaveSlot): Result<GameplaySnapshot, string> {
    const result = this.saves.load(slot);
    if (!result.ok) return result;
    if (!validateGameplaySnapshot(result.value.payload)) return err('save payload failed gameplay validation');
    this.events.emit('save/recovered', { slot, revision: result.value.metadata.revision, source: 'primary' });
    return ok(result.value.payload);
  }

  exportDiagnostics(): Readonly<Record<string, unknown>> {
    const assetUsage = new ResidencyController(this.assets).usage();
    return Object.freeze({
      engineVersion: '2026.09-modern-ts',
      initialized: this.initialized,
      disposed: this.disposed,
      frameId: this.frameIdValue,
      lastFrameMs: this.lastFrameMs,
      tick: this.world.revision,
      render: this.renderPolicy,
      world: { seed: this.world.seed, phase: this.world.time.phase, day: this.world.time.day, entities: this.world.entities.length },
      assets: assetUsage,
      metrics: this.metrics.snapshot(),
      scheduler: { tasks: this.schedulerSize() },
      saveRevision: this.saves.revision,
    });
  }

  snapshotWorld(): WorldSnapshot { return this.world.snapshot(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.assets.dispose();
    this.stream.clear();
    this.worldSystems.remove('core:world');
    this.events.clear();
    this.metrics.set('engine.disposed', 1, TICK(this.world.revision));
  }

  private schedulerSize(): number { return Number((this.scheduler as unknown as { tasks?: Map<string, unknown> }).tasks?.size ?? 0); }

  private installCoreSystems(): void {
    this.scheduler.register({ id: 'core:world', system: 'core-world' as never, phase: 'simulation', priority: 100, budgetWeight: 2, run: context => this.worldSystems.update(this.world, context) });
    this.worldSystems.add({ id: 'world:clock', order: 0, update: (world, context) => world.advance(context.deltaSeconds) });
  }
}

const storageAdapter = (storage: StorageLike) => ({ read: (key: string) => storage.getItem(key), write: (key: string, value: string) => storage.setItem(key, value), remove: (key: string) => storage.removeItem(key) });

const clockSnapshotSafeAlpha = (clock: FixedStepClock): number => {
  const snapshot = clock.snapshot();
  return clamp(snapshot.accumulatorMs / Math.max(1, snapshot.deltaSeconds * 1000), 0, 1);
};

export interface EngineRuntimeHandle {
  readonly engine: ModernEngine;
  frame(now: number): EngineFrameReport;
  shutdown(): void;
}

export const createModernEngine = (options: ModernEngineOptions = {}): Result<EngineRuntimeHandle, string> => {
  try {
    const engine = new ModernEngine(options);
    engine.initialize(typeof performance !== 'undefined' ? performance.now() : Date.now());
    return ok({ engine, frame: now => engine.step(now), shutdown: () => engine.dispose() });
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : 'modern engine initialization failed');
  }
};

export const assertModernEngineReady = (engine: ModernEngine): void => {
  const diagnostics = engine.exportDiagnostics();
  if (diagnostics.disposed) throw new Error('modern engine unexpectedly disposed');
  if (engine.renderPolicy.backend === 'unavailable') throw new Error('no render backend available');
  if (engine.renderPolicy.maxVisibleObjects < 500) throw new Error('render visibility budget is implausibly low');
};
