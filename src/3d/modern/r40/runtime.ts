import type { FeatureFlag, FrameBudget, HealthSignal, RenderDecision, RuntimeCommand, RuntimeConfig, RuntimeHealthReport, RuntimePhase, RuntimeTask, TaskBudgetReport, Tick } from './types';
import { commandId, tick } from './types';
import { FixedClock, hashJson } from './deterministic';
import { DeterministicTaskScheduler } from './scheduler';
import { HealthMonitor, MetricRegistry, FeatureFlagStore } from './observability';
import { SecurityGate } from './security';
import { RenderQualityGovernor } from './render';

export interface RuntimeHost {
  readonly now: () => number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
  readonly onError?: (signal: HealthSignal) => void;
}
export interface RuntimeFrameResult {
  readonly tick: Tick;
  readonly alpha: number;
  readonly budget: TaskBudgetReport;
  readonly render: RenderDecision;
  readonly digest: string;
}

export class R40Runtime {
  readonly config: RuntimeConfig;
  readonly host: RuntimeHost;
  readonly clock: FixedClock;
  readonly scheduler: DeterministicTaskScheduler;
  readonly health: HealthMonitor;
  readonly metrics: MetricRegistry;
  readonly flags: FeatureFlagStore;
  readonly security: SecurityGate;
  readonly renderGovernor: RenderQualityGovernor;
  #running = false;
  #frameHandle: number | null = null;
  #lastTime = 0;
  #abort = new AbortController();
  #listeners = new Set<(frame: RuntimeFrameResult) => void>();

  constructor(config: RuntimeConfig, host: RuntimeHost = { now: () => performance.now() }) {
    this.config = Object.freeze(config);
    this.host = host;
    this.clock = new FixedClock(config.fixedHz);
    this.scheduler = new DeterministicTaskScheduler({ maxTasksPerFrame: config.maxTasksPerFrame });
    this.health = new HealthMonitor();
    this.metrics = new MetricRegistry();
    this.flags = new FeatureFlagStore();
    this.security = new SecurityGate();
    this.renderGovernor = new RenderQualityGovernor(config.frameBudget, config.initialQuality.tier);
  }

  registerTask(task: RuntimeTask): boolean {
    if (!this.security.checkCommandType(task.phase).accepted) return false;
    return this.scheduler.enqueue(task);
  }

  submit(command: RuntimeCommand): boolean {
    if (!this.security.checkCommandType(command.type).accepted) {
      this.signal('runtime', false, 'error', 'COMMAND_REJECTED', 'command type failed security policy');
      return false;
    }
    if (!this.security.validatePayload(command.payload).accepted) {
      this.signal('runtime', false, 'error', 'PAYLOAD_REJECTED', 'command payload failed security policy');
      return false;
    }
    const task: RuntimeTask = Object.freeze({
      id: command.id,
      lane: 'interactive',
      phase: 'input',
      costUnits: 1,
      deadlineTick: command.tick,
      enqueuedAt: command.tick,
      run: () => Object.freeze({ consumedUnits: 1, completed: true, reschedule: false, detail: command.type }),
    });
    return this.scheduler.enqueue(task);
  }

  step(deltaMs: number): RuntimeFrameResult {
    const frameStart = this.host.now();
    const clock = this.clock.push(deltaMs, this.config.maxCatchUpSteps);
    let budget: TaskBudgetReport = Object.freeze({
      tick: this.clock.tick,
      laneUnits: Object.freeze({ critical: 0, interactive: 0, simulation: 0, background: 0, idle: 0 }),
      phaseUnits: Object.freeze({ input: 0, simulation: 0, navigation: 0, ai: 0, audio: 0, streaming: 0, network: 0, save: 0, render: 0, telemetry: 0 }),
      deferred: 0,
      dropped: 0,
    });
    for (const currentTick of clock.ticks) budget = this.scheduler.runFrame(currentTick, this.#abort.signal);
    const elapsed = Math.max(0, this.host.now() - frameStart);
    const render = this.renderGovernor.evaluate({ frameMs: elapsed, cpuMs: elapsed, gpuMs: elapsed * 0.7, drawCalls: 0, triangles: 0, memoryBytes: 0 });
    this.metrics.record({ name: 'r40.frameMs', value: elapsed, unit: 'ms', tick: this.clock.tick, phase: 'telemetry', tags: {} });
    const result = Object.freeze({ tick: this.clock.tick, alpha: clock.alpha, budget, render, digest: hashJson({ tick: this.clock.tick, budget, render }) });
    for (const listener of this.#listeners) listener(result);
    return result;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = this.host.now();
    this.#abort = new AbortController();
    const frame = () => {
      if (!this.#running) return;
      const now = this.host.now();
      const delta = Math.max(0, now - this.#lastTime);
      this.#lastTime = now;
      this.step(delta);
      if (this.host.requestFrame) this.#frameHandle = this.host.requestFrame(frame);
    };
    if (this.host.requestFrame) this.#frameHandle = this.host.requestFrame(frame);
  }

  stop(): void {
    this.#running = false;
    this.#abort.abort();
    if (this.#frameHandle !== null && this.host.cancelFrame) this.host.cancelFrame(this.#frameHandle);
    this.#frameHandle = null;
  }

  running(): boolean { return this.#running; }
  currentTick(): Tick { return this.clock.tick; }

  addFrameListener(listener: (frame: RuntimeFrameResult) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  setFlag(flag: FeatureFlag): void { this.flags.set(flag); }
  flag(id: string, subject = ''): boolean { return this.flags.resolve(id, subject); }

  signal(subsystem: string, ok: boolean, severity: HealthSignal['severity'], code: string, message: string): void {
    const signal: HealthSignal = Object.freeze({ subsystem, ok, severity, code, message, tick: this.clock.tick });
    this.health.push(signal);
    this.host.onError?.(signal);
  }

  healthReport(): RuntimeHealthReport {
    return this.health.report(this.clock.tick, this.renderGovernor.current(), this.scheduler.pending(), 0, 0);
  }

  configDigest(): string { return hashJson(this.config); }
  commandToken(type: string): string { return commandId(type + ':' + String(Number(this.clock.tick))); }
}

export function createDefaultRuntimeConfig(platform: RuntimeConfig['platform'], capabilities: RuntimeConfig['capabilities']): RuntimeConfig {
  const budget: FrameBudget = Object.freeze({ frameMs: 16.67, cpuMs: 9, gpuMs: 14, drawCalls: 12000, triangles: 8000000, memoryBytes: 536870912 });
  const tier: 0 | 1 | 2 | 3 | 4 = platform === 'constrained' ? 1 : platform === 'mobile' ? 2 : platform === 'tablet' ? 3 : 4;
  const quality = Object.freeze({ tier, renderScale: tier === 1 ? 0.67 : tier === 2 ? 0.78 : tier === 3 ? 0.9 : 1, shadows: tier >= 2, foliageDensity: tier === 1 ? 0.35 : tier === 2 ? 0.5 : tier === 3 ? 0.75 : 1, postFx: tier === 1 ? 0.25 : tier === 2 ? 0.5 : tier === 3 ? 0.8 : 1, maxAudioVoices: tier === 1 ? 24 : tier === 2 ? 48 : tier === 3 ? 64 : 96 });
  return Object.freeze({ platform, capabilities, fixedHz: 60, maxCatchUpSteps: 4, frameBudget: budget, initialQuality: quality, maxEntities: 100000, maxTasksPerFrame: 256 });
}
