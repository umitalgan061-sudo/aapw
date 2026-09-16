import { createWorldBus, type WorldBus } from '../events/typedEventBus.ts';
import { AdaptiveQualityController, type PressureSample, type QualityPolicy } from '../performance/adaptiveQuality.ts';
import { FixedStepClock } from './deterministicClock.ts';
import { freeze, revision, type FrameContext, type RuntimeHealth, type RuntimeSnapshot, type WorldState } from '../domain/contracts.ts';

export interface RuntimeSystem {
  readonly name: string;
  readonly priority?: number;
  readonly beforeFrame?: (context: FrameContext) => void;
  readonly update: (context: FrameContext) => void;
  readonly afterFrame?: (context: FrameContext) => void;
  readonly dispose?: () => void;
}

export interface RuntimeKernelOptions {
  readonly fixedStepMs?: number;
  readonly maxDeltaMs?: number;
  readonly maxSystems?: number;
  readonly onError?: (error: unknown, system: string) => void;
}

export interface RuntimeKernelHooks {
  readonly getWorld: () => WorldState;
  readonly getInput: () => FrameContext['input'];
  readonly samplePressure?: () => PressureSample;
  readonly publishQuality?: (policy: QualityPolicy) => void;
}

export interface RuntimeKernelMetrics {
  readonly frame: number;
  readonly elapsedMs: number;
  readonly frameTimeMs: number;
  readonly updates: number;
  readonly skippedSystems: number;
  readonly systems: number;
  readonly qualityLevel: number;
  readonly warnings: number;
}

export class RuntimeKernel {
  readonly bus: WorldBus;
  readonly #clock: FixedStepClock;
  readonly #quality: AdaptiveQualityController;
  readonly #hooks: RuntimeKernelHooks;
  readonly #maxSystems: number;
  readonly #onError?: RuntimeKernelOptions['onError'];
  readonly #systems: RuntimeSystem[] = [];
  #frame = 0;
  #elapsedMs = 0;
  #lastFrameMs = 0;
  #updates = 0;
  #skippedSystems = 0;
  #warnings = 0;
  #running = false;
  #disposed = false;
  #abortController = new AbortController();

  constructor(hooks: RuntimeKernelHooks, options: RuntimeKernelOptions = {}) {
    this.#hooks = hooks;
    this.#maxSystems = Math.max(1, Math.floor(options.maxSystems ?? 128));
    this.#onError = options.onError;
    this.bus = createWorldBus({ onError: (error) => { this.#warnings += 1; this.#onError?.(error, 'event-bus'); } });
    this.#clock = new FixedStepClock({ stepMs: options.fixedStepMs ?? 1000 / 60, maxDeltaMs: options.maxDeltaMs ?? 200 });
    this.#quality = new AdaptiveQualityController();
  }

  register(system: RuntimeSystem): () => void {
    if (this.#disposed) return () => undefined;
    if (this.#systems.length >= this.#maxSystems) throw new Error('Runtime system capacity exceeded.');
    if (this.#systems.some((item) => item.name === system.name)) throw new Error(`Duplicate runtime system: ${system.name}`);
    this.#systems.push(system);
    this.#systems.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name));
    return () => {
      const index = this.#systems.indexOf(system);
      if (index === -1) return;
      this.#systems.splice(index, 1);
      system.dispose?.();
    };
  }

  start(): void {
    if (this.#disposed) throw new Error('Runtime kernel is disposed.');
    this.#running = true;
    this.bus.emit('world:ready', { revision: Number(this.#hooks.getWorld().revision) });
  }

  stop(reason = 'manual'): void {
    if (!this.#running) return;
    this.#running = false;
    this.bus.emit('world:pause', { reason });
  }

  resume(reason = 'manual'): void {
    if (this.#disposed) return;
    this.#running = true;
    this.bus.emit('world:resume', { reason });
  }

  tick(deltaMs: number): RuntimeSnapshot {
    if (this.#disposed) return this.snapshot();
    const start = performance.now();
    const sample = this.#clock.sample(deltaMs);
    if (!this.#running) {
      this.#lastFrameMs = performance.now() - start;
      return this.snapshot();
    }
    this.#frame += 1;
    this.#elapsedMs += sample.deltaMs;
    const input = this.#hooks.getInput();
    const world = this.#hooks.getWorld();
    const context: FrameContext = freeze({ frame: this.#frame, dt: sample.stepMs / 1000, elapsed: this.#elapsedMs / 1000, input, worldRevision: revision(Number(world.revision)) });
    for (let step = 0; step < Math.max(1, sample.steps); step += 1) {
      this.#runSystems(context);
      this.#updates += 1;
    }
    const frameTimeMs = performance.now() - start;
    this.#lastFrameMs = frameTimeMs;
    if (this.#hooks.samplePressure) {
      const policy = this.#quality.update(this.#hooks.samplePressure());
      this.#hooks.publishQuality?.(policy);
    }
    this.bus.emit('world:frame', { frame: this.#frame, dt: context.dt });
    return this.snapshot();
  }

  snapshot(): RuntimeSnapshot {
    const metrics = this.metrics();
    const fps = metrics.frameTimeMs > 0 ? 1000 / metrics.frameTimeMs : 0;
    const quality = this.#quality.metrics();
    const health: RuntimeHealth = freeze({
      fps: Number(Math.min(240, fps).toFixed(2)),
      frameTimeMs: Number(metrics.frameTimeMs.toFixed(3)),
      heapUsedMb: typeof performance !== 'undefined' && 'memory' in performance ? Number(((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576) || null : null,
      cpuPressure: quality.pressure,
      gpuPressure: quality.pressure,
      degraded: quality.level < 4,
      degradationLevel: quality.level,
    });
    return freeze({ runtimeRevision: revision(this.#frame), frame: this.#frame, worldRevision: this.#hooks.getWorld().revision, health, activeFeatures: this.#systems.map((system) => system.name), warnings: [`quality:${quality.level}`] });
  }

  metrics(): RuntimeKernelMetrics {
    return freeze({
      frame: this.#frame,
      elapsedMs: this.#elapsedMs,
      frameTimeMs: this.#lastFrameMs,
      updates: this.#updates,
      skippedSystems: this.#skippedSystems,
      systems: this.#systems.length,
      qualityLevel: this.#quality.level,
      warnings: this.#warnings,
    });
  }

  signal(): AbortSignal { return this.#abortController.signal; }
  quality(): AdaptiveQualityController { return this.#quality; }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#running = false;
    this.#abortController.abort();
    for (const system of [...this.#systems]) system.dispose?.();
    this.#systems.length = 0;
    this.bus.dispose();
  }

  #runSystems(context: FrameContext): void {
    for (const system of this.#systems) {
      try {
        system.beforeFrame?.(context);
        system.update(context);
        system.afterFrame?.(context);
      } catch (error) {
        this.#skippedSystems += 1;
        this.#warnings += 1;
        this.#onError?.(error, system.name);
        this.bus.emit('runtime:error', { code: 'SYSTEM_UPDATE_FAILED', message: `${system.name}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
}
