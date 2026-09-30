import type {
  RuntimeBudgetR31,
  RuntimeCommandR31,
  RuntimeFrameR31,
  RuntimeKernelPortsR31,
  RuntimeLifecycleStateR31,
  RuntimePhase,
  RuntimePluginR31,
  RuntimePriority,
} from './applicationTypesR31.ts';
import { R31_DEFAULT_BUDGET } from './applicationTypesR31.ts';
import { EventBusR31 } from './eventBusR31.ts';
import { DeterministicClockR31 } from './deterministicClockR31.ts';
import { SchedulerR31 } from './schedulerR31.ts';
import { CommandRouterR31 } from './commandRouterR31.ts';
import { DiagnosticsR31 } from './diagnosticsR31.ts';

const PLUGIN_WEIGHT: Record<RuntimePriority, number> = {
  critical: 5, high: 4, normal: 3, low: 2, background: 1,
};

export interface ApplicationKernelConfigR31 {
  readonly budget?: RuntimeBudgetR31;
  readonly fixedStepSeconds?: number;
  readonly maxCatchUpSteps?: number;
}

export interface ApplicationKernelDiagnosticsR31 {
  readonly lifecycle: RuntimeLifecycleStateR31;
  readonly clockTick: number;
  readonly frame: number;
  readonly scheduler: ReturnType<SchedulerR31['diagnostics']>;
  readonly commands: ReturnType<CommandRouterR31['diagnostics']>;
  readonly events: ReturnType<EventBusR31['diagnostics']>;
  readonly health: ReturnType<DiagnosticsR31['report']>;
}

export class ApplicationKernelR31 {
  readonly events: EventBusR31;
  readonly scheduler: SchedulerR31;
  readonly commands: CommandRouterR31;
  readonly diagnostics: DiagnosticsR31;
  readonly clock: DeterministicClockR31;
  readonly #ports: RuntimeKernelPortsR31;
  readonly #plugins = new Map<string, RuntimePluginR31>();
  #status: RuntimeLifecycleStateR31 = Object.freeze({ status: 'created', generation: 0, reason: null });
  #frame = 0;
  #lastNowMs: number;
  #commandCounter = 0;

  constructor(ports: RuntimeKernelPortsR31, config: ApplicationKernelConfigR31 = {}) {
    this.#ports = ports;
    this.#lastNowMs = ports.nowMs();
    this.events = new EventBusR31((config.budget ?? R31_DEFAULT_BUDGET).maxEventsPerFrame);
    this.scheduler = new SchedulerR31(config.budget ?? R31_DEFAULT_BUDGET);
    this.commands = new CommandRouterR31();
    this.commands.setMaxQueue((config.budget ?? R31_DEFAULT_BUDGET).maxCommandsPerFrame * 4);
    this.diagnostics = new DiagnosticsR31();
    this.clock = new DeterministicClockR31({
      fixedStepSeconds: config.fixedStepSeconds ?? 1 / 60,
      maxCatchUpSteps: config.maxCatchUpSteps ?? 8,
    });
  }

  async start(): Promise<void> {
    if (this.#status.status === 'running') return;
    if (this.#status.status === 'stopping') throw new Error('Kernel is stopping');
    this.#setStatus('starting', null);
    const plugins = [...this.#plugins.values()].sort((a, b) =>
      PLUGIN_WEIGHT[b.priority] - PLUGIN_WEIGHT[a.priority] || a.id.localeCompare(b.id));
    try {
      for (const plugin of plugins) await plugin.start?.();
      this.#setStatus('running', null);
      this.#lastNowMs = this.#ports.nowMs();
    } catch (error) {
      this.#handleError(error, 'kernel.start');
      this.#setStatus('failed', 'plugin-start-failed');
      throw error;
    }
  }

  registerPlugin(plugin: RuntimePluginR31): () => void {
    if (this.#plugins.has(plugin.id)) throw new Error(`Duplicate plugin id: ${plugin.id}`);
    if (!plugin.id.trim()) throw new Error('Plugin id cannot be empty');
    this.#plugins.set(plugin.id, Object.freeze({ ...plugin }));
    return () => this.#plugins.delete(plugin.id);
  }

  enqueue<T>(command: Omit<RuntimeCommandR31<T>, 'id'>): boolean {
    const id = this.commands.createId(command.name, ++this.#commandCounter);
    return this.commands.enqueue(Object.freeze({ ...command, id }));
  }

  async frame(nowMs = this.#ports.nowMs()): Promise<void> {
    if (this.#status.status !== 'running') return;
    const rawDeltaSeconds = Math.max(0, (nowMs - this.#lastNowMs) / 1000);
    this.#lastNowMs = nowMs;
    this.#frame++;

    this.clock.advance(rawDeltaSeconds, (stepSeconds, tick) => {
      this.events.setTick(tick);
      const frame: RuntimeFrameR31 = Object.freeze({
        frame: this.#frame,
        simulationTick: tick,
        deltaSeconds: stepSeconds,
        elapsedSeconds: this.clock.elapsedSeconds,
        alpha: 0,
        phase: 'simulation',
      });
      this.#runPlugins(frame);
    });

    await this.commands.drain(256);
    const sample = {
      timestampMs: nowMs,
      frameMs: rawDeltaSeconds * 1000,
      simulationMs: rawDeltaSeconds * 1000,
      renderMs: 0,
      networkMs: 0,
      memoryBytes: null,
      droppedCommands: this.commands.diagnostics().dropped,
      droppedEvents: this.events.diagnostics().dropped,
      errors: this.diagnostics.snapshot().errors,
    };
    this.diagnostics.record(sample);
  }

  pause(reason = 'manual'): void {
    if (this.#status.status !== 'running') return;
    this.clock.pause();
    this.#setStatus('paused', reason);
    for (const plugin of this.#plugins.values()) plugin.pause?.();
  }

  resume(): void {
    if (this.#status.status !== 'paused') return;
    this.clock.resume();
    this.#setStatus('running', null);
    for (const plugin of this.#plugins.values()) plugin.resume?.();
  }

  async stop(reason = 'manual'): Promise<void> {
    if (this.#status.status === 'stopped') return;
    this.#setStatus('stopping', reason);
    const plugins = [...this.#plugins.values()].sort((a, b) =>
      PLUGIN_WEIGHT[a.priority] - PLUGIN_WEIGHT[b.priority] || a.id.localeCompare(b.id));
    for (const plugin of plugins) await plugin.stop?.();
    this.scheduler.dispose();
    this.commands.dispose();
    this.events.dispose();
    this.clock.pause();
    this.#setStatus('stopped', reason);
  }

  lifecycle(): RuntimeLifecycleStateR31 { return this.#status; }

  diagnosticsSnapshot(): ApplicationKernelDiagnosticsR31 {
    return Object.freeze({
      lifecycle: this.#status,
      clockTick: this.clock.tick,
      frame: this.#frame,
      scheduler: this.scheduler.diagnostics(),
      commands: this.commands.diagnostics(),
      events: this.events.diagnostics(),
      health: this.diagnostics.report(),
    });
  }

  #runPlugins(frame: RuntimeFrameR31): void {
    for (const plugin of this.#plugins.values()) {
      if (!plugin.update) continue;
      try {
        plugin.update(frame);
      } catch (error) {
        this.#handleError(error, `plugin:${plugin.id}`);
      }
    }
  }

  #setStatus(status: RuntimeLifecycleStateR31['status'], reason: string | null): void {
    this.#status = Object.freeze({
      status,
      generation: this.#status.generation + 1,
      reason,
    });
    this.events.emit('lifecycle', this.#status);
  }

  #handleError(error: unknown, context: string): void {
    this.diagnostics.record({
      timestampMs: this.#ports.nowMs(),
      frameMs: 0,
      simulationMs: 0,
      renderMs: 0,
      networkMs: 0,
      memoryBytes: null,
      droppedCommands: 0,
      droppedEvents: 0,
      errors: 1,
    });
    this.#ports.onError?.(error, context);
  }
}
