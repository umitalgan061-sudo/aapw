import { SystemContext, SystemDefinition, SystemPhase, Tick, clamp, hashString, tickValue } from './types.ts';

interface ScheduledSystem extends SystemDefinition {
  enabled: boolean;
  lastRunTick: Tick;
  accumulatedMs: number;
  executions: number;
  overruns: number;
}

export interface SchedulerMetrics {
  executions: number;
  overruns: number;
  activeSystems: number;
  totalBudgetMs: number;
}

export interface ScheduleOptions {
  systems: readonly SystemDefinition[];
  maxCommandsPerTick?: number;
  maxEventsPerTick?: number;
}

const PHASE_ORDER: readonly SystemPhase[] = ['input', 'simulation', 'presentation', 'network', 'persistence'];

export class DeterministicScheduler {
  readonly #systems = new Map<string, ScheduledSystem>();
  readonly #commandQueue: { kind: string; payload: unknown }[] = [];
  readonly #eventQueue: { kind: string; payload: unknown }[] = [];
  readonly #maxCommandsPerTick: number;
  readonly #maxEventsPerTick: number;
  #currentTick: Tick = tickValue(0);

  constructor(options: ScheduleOptions) {
    this.#maxCommandsPerTick = options.maxCommandsPerTick ?? 512;
    this.#maxEventsPerTick = options.maxEventsPerTick ?? 512;
    for (const definition of options.systems) this.register(definition);
  }

  get currentTick(): Tick { return this.#currentTick; }

  register(definition: SystemDefinition): void {
    if (!definition.id.trim()) throw new Error('System id is required');
    if (this.#systems.has(definition.id)) throw new Error(`System already registered: ${definition.id}`);
    this.#systems.set(definition.id, {
      ...definition,
      enabled: true,
      lastRunTick: tickValue(0),
      accumulatedMs: 0,
      executions: 0,
      overruns: 0,
    });
  }

  unregister(id: string): boolean {
    return this.#systems.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const system = this.#systems.get(id);
    if (!system) throw new Error(`Unknown system: ${id}`);
    system.enabled = enabled;
  }

  dispatch(kind: string, payload: unknown): boolean {
    if (this.#commandQueue.length >= this.#maxCommandsPerTick) return false;
    this.#commandQueue.push({ kind, payload });
    return true;
  }

  emit(kind: string, payload: unknown): boolean {
    if (this.#eventQueue.length >= this.#maxEventsPerTick) return false;
    this.#eventQueue.push({ kind, payload });
    return true;
  }

  runTick(tick: Tick, deltaSeconds: number, nowMs: () => number = () => performance.now()): SchedulerMetrics {
    if (tick <= this.#currentTick) throw new Error(`Scheduler tick must advance monotonically: ${tick}`);
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) throw new RangeError('deltaSeconds must be positive');
    this.#currentTick = tick;
    const entities: number[] = [];
    const phaseBuckets = new Map<SystemPhase, ScheduledSystem[]>();
    for (const phase of PHASE_ORDER) phaseBuckets.set(phase, []);
    for (const system of this.#systems.values()) {
      if (!system.enabled || !this.#shouldRun(system, tick)) continue;
      phaseBuckets.get(system.phase)!.push(system);
    }
    for (const systems of phaseBuckets.values()) {
      systems.sort((a, b) => b.priority - a.priority || stableSystemOrder(a.id, b.id));
    }
    for (const phase of PHASE_ORDER) {
      for (const system of phaseBuckets.get(phase)!) {
        const started = nowMs();
        const context: SystemContext = {
          tick,
          deltaSeconds,
          entities,
          emit: <T>(kind: string, payload: T) => { this.emit(kind, payload); },
          dispatch: <T>(kind: string, payload: T) => { this.dispatch(kind, payload); },
        };
        try {
          system.step(context);
        } catch (error) {
          system.enabled = false;
          throw new Error(`System ${system.id} failed at tick ${tick}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          const elapsed = Math.max(0, nowMs() - started);
          system.accumulatedMs += elapsed;
          system.executions += 1;
          system.lastRunTick = tick;
          if (system.budgetMs > 0 && elapsed > system.budgetMs) system.overruns += 1;
        }
      }
    }
    return this.metrics();
  }

  metrics(): SchedulerMetrics {
    let executions = 0;
    let overruns = 0;
    let totalBudgetMs = 0;
    let activeSystems = 0;
    for (const system of this.#systems.values()) {
      executions += system.executions;
      overruns += system.overruns;
      totalBudgetMs += Math.max(0, system.budgetMs);
      if (system.enabled) activeSystems += 1;
    }
    return { executions, overruns, activeSystems, totalBudgetMs };
  }

  consumeCommands(limit = this.#maxCommandsPerTick): { kind: string; payload: unknown }[] {
    const count = clamp(Math.floor(limit), 0, this.#commandQueue.length);
    return this.#commandQueue.splice(0, count);
  }

  consumeEvents(limit = this.#maxEventsPerTick): { kind: string; payload: unknown }[] {
    const count = clamp(Math.floor(limit), 0, this.#eventQueue.length);
    return this.#eventQueue.splice(0, count);
  }

  snapshot(): { id: string; enabled: boolean; lastRunTick: Tick; executions: number; overruns: number }[] {
    return [...this.#systems.values()]
      .sort((a, b) => stableSystemOrder(a.id, b.id))
      .map((system) => ({
        id: system.id,
        enabled: system.enabled,
        lastRunTick: system.lastRunTick,
        executions: system.executions,
        overruns: system.overruns,
      }));
  }

  #shouldRun(system: ScheduledSystem, tick: Tick): boolean {
    if (system.frequency === 'tick') return true;
    if (system.frequency === 'demand') return system.lastRunTick !== tick;
    const cadence = Math.max(1, Math.round(1000 / Math.max(1, system.budgetMs * 10)));
    return Number(tick) % cadence === 0;
  }
}

function stableSystemOrder(left: string, right: string): number {
  return hashString(left) - hashString(right) || left.localeCompare(right);
}

export function createSystem(
  id: string,
  phase: SystemPhase,
  step: (context: SystemContext) => void,
  options: Partial<Omit<SystemDefinition, 'id' | 'phase' | 'step'>> = {},
): SystemDefinition {
  return {
    id,
    phase,
    step,
    frequency: options.frequency ?? 'tick',
    priority: options.priority ?? 0,
    budgetMs: options.budgetMs ?? 1,
  };
}

export function createScheduler(systems: readonly SystemDefinition[]): DeterministicScheduler {
  return new DeterministicScheduler({ systems });
}

export function schedulerStableDigest(scheduler: DeterministicScheduler): number {
  return hashString(JSON.stringify(scheduler.snapshot()));
}
