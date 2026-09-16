import type { AdaptiveQualityState, DeviceCapabilities, Disposable, EntityStore, FrameId, FrameMetrics, ModernRuntime, RendererSelection, RuntimeEventMap, RuntimeOptions, RuntimePhase, RuntimeSnapshot, RuntimeSystem, SystemContext, TimestampMs, WorldRevision } from './types';
import { DEFAULT_ADAPTIVE_QUALITY, asFrameId, asTimestampMs, asWorldRevision } from './types';
import { EventBus, XorShift32 } from './eventBus';
import { FrameScheduler, FixedStepClock } from './frameScheduler';
import { ModernEntityStore } from './ecs';
import { AssetRegistry } from './assetRegistry';
import { SaveStore, gameplaySnapshot } from './saveStore';
import { RendererKernel } from './rendererKernel';

export interface RuntimeEnvironment {
  readonly capabilities: DeviceCapabilities;
  readonly now: () => number;
  readonly canvas?: HTMLCanvasElement | OffscreenCanvas;
}

export interface ModernRuntimeDependencies {
  readonly environment?: Partial<RuntimeEnvironment>;
  readonly entityStore?: EntityStore;
  readonly renderer?: RendererKernel;
  readonly assets?: AssetRegistry;
}

const PHASE_GRAPH: Record<RuntimePhase, readonly RuntimePhase[]> = {
  boot: ['loading', 'stopped'],
  loading: ['ready', 'degraded', 'stopping'],
  ready: ['running', 'degraded', 'stopping'],
  running: ['paused', 'degraded', 'stopping'],
  paused: ['running', 'stopping'],
  degraded: ['running', 'paused', 'stopping'],
  stopping: ['stopped'],
  stopped: [],
};

/**
 * TypeScript-first runtime orchestrator. It is deliberately renderer-agnostic:
 * simulation state, scheduling, persistence and rendering budgets are separated
 * so a future WASM/worker simulation backend can replace individual systems.
 */
export class ModernGameRuntime implements ModernRuntime, Disposable {
  private readonly seed: number;
  private readonly options: Required<Pick<RuntimeOptions, 'schedulerBudgetMs' | 'enablePersistence' | 'enableAdaptiveQuality'>>;
  private readonly now: () => number;
  private readonly events: EventBus;
  private readonly scheduler: FrameScheduler;
  private readonly fixedClock = new FixedStepClock({ stepSeconds: 1 / 60, maxCatchUpSteps: 5 });
  private readonly random: XorShift32;
  private readonly world: EntityStore;
  private readonly renderer: RendererKernel;
  private readonly assets: AssetRegistry;
  private readonly persistence: SaveStore;
  private readonly systems: RuntimeSystem[] = [];
  private phaseState: RuntimePhase = 'boot';
  private frameState: FrameId = asFrameId(0);
  private worldRevision: WorldRevision = asWorldRevision(0);
  private previousFrameTime: number | null = null;
  private playtimeSeconds = 0;
  private disposed = false;
  private lastMetrics: FrameMetrics = this.zeroMetrics();

  public constructor(options: RuntimeOptions = {}, dependencies: ModernRuntimeDependencies = {}) {
    this.seed = options.seed >>> 0;
    this.options = {
      schedulerBudgetMs: options.schedulerBudgetMs ?? 4,
      enablePersistence: options.enablePersistence ?? true,
      enableAdaptiveQuality: options.enableAdaptiveQuality ?? true,
    };
    const environment = dependencies.environment;
    this.now = environment?.now ?? (() => performance.now());
    this.events = new EventBus({ captureErrors: true });
    this.scheduler = new FrameScheduler({ budgetMs: this.options.schedulerBudgetMs, now: this.now });
    this.random = new XorShift32(this.seed || 1);
    this.world = dependencies.entityStore ?? new ModernEntityStore({ seed: this.seed });
    this.assets = dependencies.assets ?? new AssetRegistry({ byteBudget: 512 * 1024 * 1024, entryBudget: 2048, now: () => asTimestampMs(this.now()) }, {
      onState: (state) => { this.events.emit('asset:state', state); },
    });
    this.renderer = dependencies.renderer ?? new RendererKernel({ capabilities: environment?.capabilities });
    this.persistence = new SaveStore({ namespace: 'westeros3d-modern', schemaVersion: 1, maxBytes: 5 * 1024 * 1024 });
    this.registerDefaultSystems();
  }

  public get phase(): RuntimePhase { return this.phaseState; }
  public get frameId(): FrameId { return this.frameState; }
  public get worldStore(): EntityStore { return this.world; }
  public get assetRegistry(): AssetRegistry { return this.assets; }
  public get eventBus(): EventBus { return this.events; }
  public get rendererKernel(): RendererKernel { return this.renderer; }

  public on<K extends keyof RuntimeEventMap>(name: K, handler: (payload: RuntimeEventMap[K]) => void): Disposable {
    return this.events.on(name, handler);
  }

  public async start(): Promise<void> {
    this.ensureActive();
    this.transition('loading');
    try {
      this.renderer.chooseBackend();
      if (this.options.enablePersistence) await this.persistence.recoverStaging();
      this.transition('ready');
      this.transition('running');
      this.previousFrameTime = this.now();
    } catch (cause) {
      this.transition('degraded');
      this.events.emit('runtime:error', { code: 'RUNTIME_START_FAILED', message: 'runtime started in degraded mode', recoverable: true, cause });
    }
  }

  public pause(): void {
    if (this.phaseState === 'running' || this.phaseState === 'degraded') this.transition('paused');
  }

  public resume(): void {
    if (this.phaseState === 'paused') {
      this.previousFrameTime = this.now();
      this.transition('running');
    }
  }

  public async stop(): Promise<void> {
    if (this.phaseState === 'stopped' || this.phaseState === 'stopping') return;
    if (this.phaseState !== 'boot') this.transition('stopping');
    await this.flushSave();
    this.transition('stopped');
  }

  public async tick(timestamp = this.now()): Promise<FrameMetrics> {
    this.ensureActive();
    if (this.phaseState === 'boot') await this.start();
    if (this.phaseState !== 'running' && this.phaseState !== 'degraded') return this.lastMetrics;
    const previous = this.previousFrameTime ?? timestamp;
    const deltaMs = Math.min(100, Math.max(0, timestamp - previous));
    this.previousFrameTime = timestamp;
    this.playtimeSeconds += deltaMs / 1000;
    this.frameState = asFrameId(this.frameState + 1);
    this.events.emit('frame:begin', { frameId: this.frameState, timestamp: asTimestampMs(timestamp), deltaMs });
    const cpuStart = this.now();
    const fixed = this.fixedClock.consume(timestamp, (stepSeconds) => this.simulateStep(stepSeconds));
    this.scheduler.beginFrame(timestamp);
    await this.scheduler.runFrame();
    const cpuMs = Math.max(0, this.now() - cpuStart);
    const gpuMs = this.lastMetrics.gpuMs;
    const stats = this.assets.stats();
    const quality = this.renderer.updateAdaptiveQuality({ cpuMs, gpuMs });
    const metrics: FrameMetrics = {
      frameId: this.frameState,
      timestamp: asTimestampMs(timestamp),
      deltaMs,
      cpuMs,
      gpuMs,
      drawCalls: this.lastMetrics.drawCalls,
      triangles: this.lastMetrics.triangles,
      visibleObjects: this.world.entityCount(),
      activeAnimations: this.world.query({ with: ['animation'], activeOnly: true }).count,
      residentBytes: stats.residentBytes,
      droppedTasks: this.scheduler.stats().deferred,
    };
    this.worldRevision = this.world.revisionNumber();
    this.lastMetrics = metrics;
    this.events.emit('frame:end', metrics);
    if (quality !== undefined && quality.tier !== DEFAULT_ADAPTIVE_QUALITY.tier) this.events.emit('quality:change', quality);
    if (fixed.droppedSeconds > 0) this.events.emit('runtime:error', { code: 'SIMULATION_CATCHUP_DROPPED', message: `dropped ${fixed.droppedSeconds.toFixed(3)} simulation seconds`, recoverable: true });
    return metrics;
  }

  public async save(saveId = 'autosave' as any): Promise<boolean> {
    this.ensureActive();
    if (!this.options.enablePersistence) return false;
    const payload = gameplaySnapshot({ capture: () => this.world.snapshot(), restore: (snapshot) => this.world.restore(snapshot) }, this.playtimeSeconds);
    const result = await this.persistence.write(saveId, payload, saveId === 'autosave' ? 'Autosave' : 'Manual save');
    if (!result.ok) {
      this.events.emit('save:error', result.error);
      return false;
    }
    this.events.emit('save:write', result.value);
    return true;
  }

  public async load(saveId = 'autosave' as any): Promise<boolean> {
    this.ensureActive();
    if (!this.options.enablePersistence) return false;
    const result = await this.persistence.read(saveId);
    if (!result.ok) {
      this.events.emit('save:error', result.error);
      return false;
    }
    const data = result.value as any;
    if (!data?.world) return false;
    this.world.restore(data.world);
    this.playtimeSeconds = Math.max(0, Number(data.playtimeSeconds ?? 0));
    this.worldRevision = this.world.revisionNumber();
    return true;
  }

  public snapshot(): RuntimeSnapshot {
    return {
      phase: this.phaseState,
      frameId: this.frameState,
      world: this.world.snapshot(),
      renderer: this.renderer.selectionState(),
      quality: this.renderer.qualityState(),
      assets: this.assets.stats(),
      scheduler: this.scheduler.stats(),
    };
  }

  public registerSystem(system: RuntimeSystem): Disposable {
    if (this.systems.some((candidate) => candidate.name === system.name)) throw new Error(`SYSTEM_REDEFINED:${system.name}`);
    this.systems.push(system);
    this.systems.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return { dispose: () => this.unregisterSystem(system.name) };
  }

  public unregisterSystem(name: string): boolean {
    const index = this.systems.findIndex((system) => system.name === name);
    if (index < 0) return false;
    const [system] = this.systems.splice(index, 1);
    system?.dispose();
    return true;
  }

  private simulateStep(stepSeconds: number): void {
    const frame = this.lastMetrics;
    const context: SystemContext = {
      frame,
      worldRevision: this.worldRevision,
      random: () => this.random.next(),
      events: { emit: (name, payload) => { this.events.emit(name, payload); } },
    };
    for (const system of this.systems) {
      try {
        const result = system.update(context);
        if (result instanceof Promise) {
          this.scheduler.enqueue({ id: `system:${system.name}:${this.frameState}`, priority: 'high', budgetMs: 0.5, run: async () => { await result; } });
        }
      } catch (cause) {
        this.events.emit('runtime:error', { code: 'SYSTEM_UPDATE_FAILED', message: `${system.name} failed during fixed-step update`, recoverable: true, cause });
      }
    }
    const animations = this.world.query({ with: ['animation'], activeOnly: true }).ids;
    if (stepSeconds > 0 && animations.length > 0) {
      this.scheduler.enqueue({ id: `animation:${this.frameState}`, priority: 'normal', budgetMs: 0.25, run: () => { void animations.length; } });
    }
  }

  private registerDefaultSystems(): void {
    this.registerSystem({ name: 'world-heartbeat', priority: 100, update: () => {} , dispose: () => {} });
    this.registerSystem({ name: 'streaming-maintenance', priority: 900, update: () => { void this.assets.stats(); }, dispose: () => {} });
  }

  private async flushSave(): Promise<void> {
    if (this.options.enablePersistence && this.phaseState !== 'boot') await this.save();
  }

  private transition(next: RuntimePhase): void {
    const allowed = PHASE_GRAPH[this.phaseState];
    if (!allowed.includes(next)) throw new Error(`INVALID_PHASE_TRANSITION:${this.phaseState}->${next}`);
    const from = this.phaseState;
    this.phaseState = next;
    this.events.emit('phase:change', { from, to: next });
  }

  private zeroMetrics(): FrameMetrics {
    return { frameId: asFrameId(0), timestamp: asTimestampMs(0), deltaMs: 0, cpuMs: 0, gpuMs: null, drawCalls: 0, triangles: 0, visibleObjects: 0, activeAnimations: 0, residentBytes: 0, droppedTasks: 0 };
  }

  private ensureActive(): void { if (this.disposed) throw new Error('RUNTIME_DISPOSED'); }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const system of [...this.systems]) system.dispose();
    this.systems.length = 0;
    this.scheduler.dispose();
    this.assets.dispose();
    this.renderer.dispose();
    this.persistence.dispose();
    this.events.dispose();
    this.world.clear();
  }
}

export const detectDeviceCapabilities = (): DeviceCapabilities => {
  const nav = globalThis.navigator as Navigator & { deviceMemory?: number; gpu?: unknown } | undefined;
  const webgl2 = (() => {
    try {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      return Boolean(canvas?.getContext('webgl2'));
    } catch { return false; }
  })();
  return {
    webgpu: Boolean(nav?.gpu),
    webgl2,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    deviceMemoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: Math.max(1, nav?.hardwareConcurrency ?? 4),
    maxTextureSize: null,
    maxSamples: null,
    powerPreference: 'default',
  };
};
