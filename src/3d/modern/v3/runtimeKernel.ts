import type { QualityTier, Tick, WorldId } from '../../types/platform.js';
import { FixedStepClock } from '../../types/runtime.js';
import {
  DEFAULT_V3_BUDGET,
  V3_FIXED_STEP_MS,
  V3_MAX_CATCH_UP_STEPS,
  V3_MAX_DELTA_MS,
  type V3Action,
  type V3CameraState,
  type V3Clock,
  type V3FrameBudget,
  type V3Health,
  type V3Listener,
  type V3RenderPacket,
  type V3RuntimeConfig,
  type V3RuntimeController,
  type V3RuntimeDependencies,
  type V3RuntimeEventMap,
  type V3RuntimeSnapshot,
  type V3Viewport,
  cloneCamera,
  cloneViewport,
  makeTick,
  finiteNumber,
  clamp,
} from './runtimeContracts.js';

const EMPTY_CAMERA: V3CameraState = Object.freeze({
  position: Object.freeze({ x: 0, y: 80, z: 120 }),
  target: Object.freeze({ x: 0, y: 0, z: 0 }),
  fov: 60,
  near: 0.1,
  far: 30_000,
  dpr: 1,
});
const EMPTY_VIEWPORT: V3Viewport = Object.freeze({ width: 1, height: 1, dpr: 1 });
const EMPTY_HEALTH: V3Health = Object.freeze({ frameMs: 0, simulationMs: 0, presentationMs: 0, memoryBytes: 0, memoryBudgetBytes: 512 * 1024 * 1024, droppedFrames: 0, tickDriftMs: 0, recoveryStage: 'healthy', legacyCalls: 0 });

export interface V3RuntimeMetrics {
  frameMs: number;
  simulationMs: number;
  presentationMs: number;
  memoryBytes: number;
  memoryBudgetBytes: number;
  droppedFrames: number;
  tickDriftMs: number;
  legacyCalls: number;
}

export interface V3RuntimeKernelOptions {
  readonly config: V3RuntimeConfig;
  readonly dependencies?: V3RuntimeDependencies;
  readonly budget?: V3FrameBudget;
}

class InternalClock implements V3Clock {
  readonly #clock: FixedStepClock;
  #snapshot = { nowMs: 0, tick: makeTick(0), deltaMs: 0, accumulatorMs: 0, alpha: 0 };
  constructor() { this.#clock = new FixedStepClock({ fixedStepMs: V3_FIXED_STEP_MS, maxDeltaMs: V3_MAX_DELTA_MS, maxCatchUpSteps: V3_MAX_CATCH_UP_STEPS }); }
  reset(nowMs: number, tick = makeTick(0)): void { this.#clock.reset(nowMs, tick); this.#snapshot = { nowMs, tick, deltaMs: 0, accumulatorMs: 0, alpha: 0 }; }
  advance(nowMs: number, step: (deltaMs: number, tick: Tick) => void) {
    const result = this.#clock.advance(nowMs, step);
    this.#snapshot = { nowMs: result.nowMs, tick: result.tick, deltaMs: result.deltaMs, accumulatorMs: result.accumulatorMs, alpha: clamp(result.accumulatorMs / V3_FIXED_STEP_MS, 0, 1) };
    return this.#snapshot;
  }
  snapshot() { return this.#snapshot; }
}

export class V3RuntimeKernel implements V3RuntimeController {
  readonly #config: V3RuntimeConfig;
  readonly #budget: V3FrameBudget;
  readonly #clock: V3Clock;
  readonly #now: () => number;
  readonly #frameSource: NonNullable<V3RuntimeDependencies['frameSource']> | undefined;
  readonly #legacy: V3RuntimeDependencies['legacy'] | undefined;
  readonly #listeners = new Map<keyof V3RuntimeEventMap, Set<(payload: unknown) => void>>();
  readonly #actions = new Map<string, V3Action>();
  #frame = 0;
  #running = false;
  #paused = false;
  #disposed = false;
  #recoveryStage: V3RuntimeSnapshot['recoveryStage'] = 'healthy';
  #camera = EMPTY_CAMERA;
  #viewport = EMPTY_VIEWPORT;
  #lastTickAt = 0;
  #simulationTimeMs = 0;
  #health: V3RuntimeMetrics = { ...EMPTY_HEALTH };
  #lastPacket: V3RenderPacket = Object.freeze({ frame: 0, backend: 'webgl2', quality: 'safe', viewport: EMPTY_VIEWPORT, camera: EMPTY_CAMERA, visibleIds: [], shadowIds: [], estimatedGpuMs: 0, uploadBytes: 0 });
  #worldId: WorldId;
  #quality: QualityTier;
  #backend: 'webgpu' | 'webgl2';

  constructor(options: V3RuntimeKernelOptions) {
    this.#config = Object.freeze({ ...options.config });
    this.#budget = Object.freeze({ ...DEFAULT_V3_BUDGET, ...(options.budget ?? {}) });
    this.#clock = options.dependencies?.clock ?? new InternalClock();
    this.#now = options.dependencies?.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.#frameSource = options.dependencies?.frameSource;
    this.#legacy = options.dependencies?.legacy;
    this.#worldId = options.config.worldId;
    this.#quality = options.config.quality;
    this.#backend = options.config.backend;
    this.#health = { ...EMPTY_HEALTH, memoryBudgetBytes: 512 * 1024 * 1024 };
    this.emit('runtime/created', { config: this.#config });
  }

  on<K extends keyof V3RuntimeEventMap>(name: K, listener: V3Listener<K>): () => void {
    const set = this.#listeners.get(name) ?? new Set<(payload: unknown) => void>();
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    this.#listeners.set(name, set);
    return () => set.delete(wrapped);
  }

  emit<K extends keyof V3RuntimeEventMap>(name: K, payload: V3RuntimeEventMap[K]): void {
    const listeners = this.#listeners.get(name);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }

  async start(): Promise<boolean> {
    this.assertAlive();
    if (this.#running) return true;
    if (this.#legacy && this.#config.enableLegacyAdapter) {
      const started = await this.#legacy.invoke('load', () => this.#legacy?.load());
      if (!started) { this.enterRecovery('legacy-load-failed'); return false; }
    }
    const now = this.#now();
    this.#clock.reset(now, makeTick(0));
    this.#lastTickAt = now;
    this.#running = true;
    this.#paused = false;
    this.emit('runtime/started', { at: now });
    return true;
  }

  pause(reason = 'manual'): void {
    this.assertAlive();
    if (!this.#running) return;
    this.#paused = true;
    this.emit('runtime/paused', { reason });
  }

  resume(reason = 'manual'): void {
    this.assertAlive();
    if (!this.#running) return;
    this.#paused = false;
    this.#lastTickAt = this.#now();
    this.emit('runtime/resumed', { reason });
  }

  async stop(reason = 'manual'): Promise<void> {
    if (this.#disposed) return;
    this.#running = false;
    this.#paused = false;
    if (this.#legacy?.isLoaded()) await this.#legacy.invoke('unload', () => this.#legacy?.unload());
    this.emit('runtime/stopped', { reason });
  }

  tick(nowMs = this.#now()): V3RuntimeSnapshot {
    this.assertAlive();
    if (!this.#running) throw new Error('V3 runtime is not running');
    const before = this.#now();
    this.#viewport = cloneViewport(this.#frameSource?.viewport() ?? this.#viewport);
    this.#camera = cloneCamera(this.#frameSource?.camera() ?? this.#camera);
    if (this.#paused) return this.snapshot();
    let steps = 0;
    const clock = this.#clock.advance(nowMs, (deltaMs, tick) => {
      steps += 1;
      this.#frame += 1;
      this.#simulationTimeMs += deltaMs;
      this.#lastTickAt = nowMs;
      this.emit('runtime/tick', { frame: this.#frame, tick, deltaMs });
      this.#applyActions();
    });
    const after = this.#now();
    const frameMs = Math.max(0, after - before);
    const simulationMs = Math.min(frameMs, steps * this.#budget.simulationMs);
    const presentationMs = Math.max(0, frameMs - simulationMs);
    this.#health = {
      ...this.#health,
      frameMs,
      simulationMs,
      presentationMs,
      tickDriftMs: Math.max(0, clock.accumulatorMs - this.#budget.totalMs),
      droppedFrames: this.#health.droppedFrames + (clock.deltaMs > this.#budget.totalMs * 2 ? 1 : 0),
    };
    this.#lastPacket = this.buildPacket();
    this.emit('render/frame', this.#lastPacket);
    return this.snapshot();
  }

  dispatch(action: V3Action): boolean {
    this.assertAlive();
    if (!action.action.trim()) return false;
    this.#actions.set(action.action, action);
    this.emit('input/action', action);
    return true;
  }

  snapshot(): V3RuntimeSnapshot {
    return Object.freeze({
      schema: 'aapw.runtime.v3', schemaVersion: 1,
      frame: this.#frame, tick: makeTick(Number(this.#clock.snapshot().tick)), simulationTimeMs: this.#simulationTimeMs,
      host: this.#config.host, backend: this.#backend, quality: this.#quality, running: this.#running, paused: this.#paused,
      recoveryStage: this.#recoveryStage, camera: this.#camera, viewport: this.#viewport, health: this.health(), digest: this.digest(),
    });
  }

  renderPacket(): V3RenderPacket { return this.#lastPacket; }
  health(): V3Health { return Object.freeze({ ...this.#health, recoveryStage: this.#recoveryStage }); }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    await this.stop('dispose');
    this.#disposed = true;
    this.#listeners.clear();
    this.#actions.clear();
  }

  setQuality(quality: QualityTier, reason = 'manual'): void {
    this.assertAlive();
    const previous = this.#quality;
    this.#quality = quality;
    if (previous !== quality) this.emit('runtime/quality', { previous, next: quality, reason });
  }

  setBackend(backend: 'webgpu' | 'webgl2'): void { this.assertAlive(); this.#backend = backend; }

  private buildPacket(): V3RenderPacket {
    const rawVisible = this.#actions.size > 0 ? [...this.#actions.keys()] : [];
    const visibleIds = Object.freeze(rawVisible.filter((id) => id.length <= 128).sort());
    return Object.freeze({ frame: this.#frame, backend: this.#backend, quality: this.#quality, viewport: this.#viewport, camera: this.#camera, visibleIds, shadowIds: visibleIds.slice(0, Math.min(64, visibleIds.length)), estimatedGpuMs: finiteNumber(this.#health.frameMs) * 0.55, uploadBytes: this.#actions.size * 64 });
  }

  private applyActions(): void {
    if (this.#actions.size === 0) return;
    const staleBefore = this.#frame - 12;
    for (const [key, action] of this.#actions) if (action.frame < staleBefore && action.phase === 'released') this.#actions.delete(key);
  }

  private enterRecovery(reason: string): void {
    const from = this.#recoveryStage;
    this.#recoveryStage = from === 'recovering' ? 'failed' : 'recovering';
    this.emit('runtime/recovery', { from, to: this.#recoveryStage, reason });
    this.emit('runtime/error', { code: 'V3_RECOVERY', message: reason, recoverable: this.#recoveryStage !== 'failed' });
  }

  private digest(): string {
    const source = `${this.#worldId}:${this.#frame}:${Number(this.#clock.snapshot().tick)}:${this.#backend}:${this.#quality}:${Math.round(this.#simulationTimeMs)}`;
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private assertAlive(): void { if (this.#disposed) throw new Error('V3 runtime disposed'); }
}

export const createV3RuntimeKernel = (options: V3RuntimeKernelOptions): V3RuntimeKernel => new V3RuntimeKernel(options);
