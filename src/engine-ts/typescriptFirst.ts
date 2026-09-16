import type { CapabilitySnapshot, EngineResult, EventEnvelope, FrameCommand, RuntimeHealth, TimeSample } from './types.js';
import { ENTITY_ID, EVENT_NAME, FRAME_ID, SEQUENCE, TICK_ID } from './types.js';
import { RuntimeKernel } from './runtime.js';

/** Canonical application-layer phase names. */
export const APP_PHASES = Object.freeze([
  'boot', 'loading', 'world', 'simulation', 'render', 'ui', 'shutdown',
] as const);
export type AppPhase = (typeof APP_PHASES)[number];

export interface AppClockState {
  readonly frame: number;
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
}

export interface AppFrameStats {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
}

export interface AppFault {
  readonly id: string;
  readonly phase: AppPhase;
  readonly severity: 'warning' | 'error' | 'fatal';
  readonly code: string;
  readonly message: string;
  readonly frame: number;
  readonly recoverable: boolean;
}

export interface AppWorldSnapshot {
  readonly revision: number;
  readonly seed: number;
  readonly phase: AppPhase;
  readonly clock: AppClockState;
  readonly stats: AppFrameStats;
  readonly health: RuntimeHealth;
}

export interface LegacyModuleHandle {
  readonly name: string;
  readonly namespace: string;
  readonly loaded: boolean;
  readonly dispose?: () => void;
}

export interface TypeScriptFirstOptions {
  readonly runtime?: RuntimeKernel;
  readonly maxFaults?: number;
  readonly maxCommandsPerFrame?: number;
  readonly seed?: number;
  readonly legacyModules?: readonly LegacyModuleHandle[];
}

export interface TypeScriptFirstRuntime {
  readonly runtime: RuntimeKernel;
  readonly capabilities: CapabilitySnapshot;
  readonly phase: AppPhase;
  readonly revision: number;
  readonly faults: readonly AppFault[];
  readonly snapshot: AppWorldSnapshot;
  submit(command: FrameCommand): EngineResult<void>;
  emit(name: string, payload: unknown): boolean;
  advance(deltaSeconds: number): AppWorldSnapshot;
  transition(next: AppPhase): boolean;
  capture(): AppWorldSnapshot;
  dispose(): void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class TypeScriptFirstApplication implements TypeScriptFirstRuntime {
  public readonly runtime: RuntimeKernel;
  public readonly capabilities: CapabilitySnapshot;
  private readonly maxFaults: number;
  private readonly maxCommandsPerFrame: number;
  private readonly seed: number;
  private readonly legacyModules: readonly LegacyModuleHandle[];
  private _phase: AppPhase = 'boot';
  private _revision = 0;
  private _faults: AppFault[] = [];
  private _disposed = false;
  private _clock: AppClockState = Object.freeze({ frame: 0, tick: 0, deltaSeconds: 0, elapsedSeconds: 0 });
  private _stats: AppFrameStats = Object.freeze({ frameMs: 0, cpuMs: 0, gpuMs: 0, drawCalls: 0, triangles: 0, visibleObjects: 0, textureBytes: 0 });

  public constructor(options: TypeScriptFirstOptions = {}) {
    this.runtime = options.runtime ?? new RuntimeKernel({ telemetrySamples: 8192, eventQueue: 8192, commandHistory: 8192 });
    this.capabilities = this.runtime.capabilities;
    this.maxFaults = Math.max(8, Math.floor(options.maxFaults ?? 256));
    this.maxCommandsPerFrame = Math.max(16, Math.floor(options.maxCommandsPerFrame ?? 2048));
    this.seed = Math.trunc(options.seed ?? 0xA4F1_2026);
    this.legacyModules = Object.freeze([...(options.legacyModules ?? [])]);
    this.runtime.initialize();
    this.transition('loading');
  }

  public get phase(): AppPhase { return this._phase; }
  public get revision(): number { return this._revision; }
  public get faults(): readonly AppFault[] { return this._faults; }

  public get snapshot(): AppWorldSnapshot {
    return this.capture();
  }

  public submit(command: FrameCommand): EngineResult<void> {
    if (this._disposed) return { ok: false, meta: { status: 'disposed', code: 'TS_FIRST_DISPOSED' } };
    if (this._phase === 'shutdown') return { ok: false, meta: { status: 'rejected', code: 'TS_FIRST_SHUTDOWN' } };
    if (this._stats.visibleObjects < 0 || command.id < 0) return this.fail('COMMAND_INVALID', 'Command contains an invalid monotonic field', false);
    const result = this.runtime.submitCommand(command);
    if (!result.ok) this.recordFault('COMMAND_REJECTED', result.meta.message ?? result.meta.code, 'warning', true);
    return result;
  }

  public emit(name: string, payload: unknown): boolean {
    if (this._disposed || !name) return false;
    return this.runtime.events.publish(EVENT_NAME(name), payload);
  }

  public advance(deltaSeconds: number): AppWorldSnapshot {
    if (this._disposed) return this.capture();
    const safeDelta = clamp(finite(deltaSeconds), 0, 0.25);
    try {
      const result = this.runtime.advance({ deltaSeconds: safeDelta });
      const frame = Number(result.frame.frame);
      const tick = Number(result.frame.tick);
      this._clock = Object.freeze({
        frame: Number.isFinite(frame) ? frame : this._clock.frame + 1,
        tick: Number.isFinite(tick) ? tick : this._clock.tick + 1,
        deltaSeconds: safeDelta,
        elapsedSeconds: this._clock.elapsedSeconds + safeDelta,
      });
      this._revision += 1;
      this._stats = Object.freeze({ ...this._stats, frameMs: safeDelta * 1000, cpuMs: safeDelta * 1000 });
      if (this._phase === 'loading' && this._clock.frame > 0) this.transition('world');
      if (this._phase === 'world' && this._clock.tick > 0) this.transition('simulation');
      return this.capture();
    } catch (error) {
      this.recordFault('FRAME_ADVANCE_FAILED', error instanceof Error ? error.message : String(error), 'error', true);
      return this.capture();
    }
  }

  public transition(next: AppPhase): boolean {
    if (this._disposed || next === this._phase) return false;
    const allowed: Readonly<Record<AppPhase, readonly AppPhase[]>> = {
      boot: ['loading', 'shutdown'],
      loading: ['world', 'shutdown'],
      world: ['simulation', 'shutdown'],
      simulation: ['render', 'shutdown'],
      render: ['ui', 'shutdown'],
      ui: ['world', 'simulation', 'shutdown'],
      shutdown: [],
    };
    if (!allowed[this._phase].includes(next)) {
      this.recordFault('INVALID_PHASE_TRANSITION', `${this._phase}->${next}`, 'warning', true);
      return false;
    }
    this._phase = next;
    this._revision += 1;
    this.emit('app:phase', { from: this._phase, to: next, revision: this._revision });
    return true;
  }

  public capture(): AppWorldSnapshot {
    return Object.freeze({
      revision: this._revision,
      seed: this.seed,
      phase: this._phase,
      clock: this._clock,
      stats: this._stats,
      health: this.runtime.health,
    });
  }

  public setFrameStats(stats: Partial<AppFrameStats>): void {
    if (this._disposed) return;
    this._stats = Object.freeze({
      frameMs: clamp(finite(stats.frameMs ?? this._stats.frameMs), 0, 1000),
      cpuMs: clamp(finite(stats.cpuMs ?? this._stats.cpuMs), 0, 1000),
      gpuMs: clamp(finite(stats.gpuMs ?? this._stats.gpuMs), 0, 1000),
      drawCalls: Math.max(0, Math.floor(finite(stats.drawCalls ?? this._stats.drawCalls))),
      triangles: Math.max(0, Math.floor(finite(stats.triangles ?? this._stats.triangles))),
      visibleObjects: Math.max(0, Math.floor(finite(stats.visibleObjects ?? this._stats.visibleObjects))),
      textureBytes: Math.max(0, Math.floor(finite(stats.textureBytes ?? this._stats.textureBytes))),
    });
  }

  public drainCommands(limit = this.maxCommandsPerFrame): readonly FrameCommand[] {
    const safeLimit = Math.max(1, Math.min(this.maxCommandsPerFrame, Math.floor(limit)));
    const result = this.runtime.commandBuffer.drain(safeLimit);
    return Object.freeze([...result]);
  }

  public recordFault(code: string, message: string, severity: AppFault['severity'] = 'error', recoverable = false): AppFault {
    const fault: AppFault = Object.freeze({
      id: `fault-${this._revision + this._faults.length + 1}`,
      phase: this._phase,
      severity,
      code,
      message,
      frame: this._clock.frame,
      recoverable,
    });
    this._faults = [...this._faults.slice(-(this.maxFaults - 1)), fault];
    return fault;
  }

  public fail(code: string, message: string, recoverable: boolean): EngineResult<void> {
    const severity = recoverable ? 'error' : 'fatal';
    this.recordFault(code, message, severity, recoverable);
    return { ok: false, meta: { status: recoverable ? 'rejected' : 'invalid', code, message } };
  }

  public healthScore(): number {
    const fatal = this._faults.filter(f => f.severity === 'fatal').length;
    const errors = this._faults.filter(f => f.severity === 'error').length;
    const warnings = this._faults.filter(f => f.severity === 'warning').length;
    return clamp(1 - fatal * 0.35 - errors * 0.08 - warnings * 0.01, 0, 1);
  }

  public enforceBudget(frameBudgetMs = 16.667): void {
    const budget = Math.max(1, frameBudgetMs);
    const pressure = this._stats.cpuMs / budget + this._stats.gpuMs / budget;
    if (pressure > 1.6) this.recordFault('FRAME_BUDGET_CRITICAL', `frame pressure ${pressure.toFixed(2)}`, 'warning', true);
    if (pressure > 2.2) this.runtime.enterDegradedMode('typescript-first-budget-pressure');
  }

  public diagnostics(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      phase: this._phase,
      revision: this._revision,
      frame: this._clock.frame,
      tick: this._clock.tick,
      healthScore: this.healthScore(),
      faultCount: this._faults.length,
      capabilityBackend: this.capabilities.webgpu ? 'webgpu' : this.capabilities.webgl2 ? 'webgl2' : 'unknown',
      legacyModuleCount: this.legacyModules.length,
      loadedLegacyModules: this.legacyModules.filter(module => module.loaded).map(module => module.name),
    });
  }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._phase = 'shutdown';
    for (const module of this.legacyModules) {
      try { module.dispose?.(); } catch (error) { this.recordFault('LEGACY_DISPOSE_FAILED', String(error), 'warning', true); }
    }
    this.runtime.dispose();
    this._revision += 1;
  }
}

export const createTypeScriptFirstApplication = (options: TypeScriptFirstOptions = {}): TypeScriptFirstApplication => new TypeScriptFirstApplication(options);

export const asCommand = (id: number, entity: string, tick: number, payload: Record<string, unknown> = {}): FrameCommand => ({
  kind: 'typescript-first-frame',
  version: 1,
  revision: 1,
  id: SEQUENCE(Math.max(0, Math.floor(id))),
  entity: ENTITY_ID(entity),
  issuedAtTick: TICK_ID(Math.max(0, Math.floor(tick))),
  priority: 0,
  type: 'frame',
  payload: Object.freeze({ ...payload }),
});

export const clockSample = (app: TypeScriptFirstApplication): TimeSample => ({
  deltaSeconds: app.snapshot.clock.deltaSeconds,
  elapsedSeconds: app.snapshot.clock.elapsedSeconds,
  frame: FRAME_ID(app.snapshot.clock.frame),
  tick: TICK_ID(app.snapshot.clock.tick),
  alpha: 0,
});

export const eventIdentity = (name: string, sequence: number, tick: number, frame: number): Pick<EventEnvelope, 'name' | 'sequence' | 'tick' | 'frame'> => ({
  name: EVENT_NAME(name), sequence: SEQUENCE(sequence), tick: TICK_ID(tick), frame: FRAME_ID(frame),
});
