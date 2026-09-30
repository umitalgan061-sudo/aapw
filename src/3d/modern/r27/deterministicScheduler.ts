import {
  type InputFrame,
  type RuntimeBudget,
  type RuntimeEvent,
  type RuntimePhase,
  type RuntimeTick,
  type ScheduledSystem,
  type SystemContext,
  type SystemId,
  systemId,
} from './contracts.ts';

export interface SchedulerFrame {
  readonly tick: RuntimeTick;
  readonly executed: readonly SystemId[];
  readonly skipped: readonly SystemId[];
  readonly events: readonly RuntimeEvent[];
  readonly commandCount: number;
  readonly decisionCount: number;
}

export interface AccumulatorResult {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
  readonly simulationTimeSeconds: number;
}

const PHASE_ORDER: readonly RuntimePhase[] = [
  'input',
  'simulation',
  'physics',
  'ai',
  'gameplay',
  'network',
  'presentation',
  'persistence',
  'observability',
];

function stableIdCompare(a: SystemId, b: SystemId): number {
  return String(a).localeCompare(String(b));
}

function uniqueIds(ids: readonly SystemId[]): readonly SystemId[] {
  return [...new Map(ids.map((id) => [String(id), id])).values()].sort(stableIdCompare);
}

export class FixedStepAccumulator {
  readonly stepSeconds: number;
  readonly maxStepsPerFrame: number;

  #accumulated = 0;
  #simulationTime = 0;

  constructor(stepSeconds = 1 / 60, maxStepsPerFrame = 5) {
    if (!(stepSeconds > 0 && Number.isFinite(stepSeconds))) throw new RangeError('stepSeconds must be finite and positive');
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) throw new RangeError('maxStepsPerFrame must be a positive integer');
    this.stepSeconds = stepSeconds;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  reset(simulationTimeSeconds = 0): void {
    if (!Number.isFinite(simulationTimeSeconds)) throw new RangeError('simulationTimeSeconds must be finite');
    this.#accumulated = 0;
    this.#simulationTime = simulationTimeSeconds;
  }

  advance(deltaSeconds: number): AccumulatorResult {
    const safeDelta = Math.max(0, Math.min(deltaSeconds, this.stepSeconds * this.maxStepsPerFrame * 4));
    this.#accumulated += safeDelta;

    let steps = 0;
    while (this.#accumulated + Number.EPSILON >= this.stepSeconds && steps < this.maxStepsPerFrame) {
      this.#accumulated -= this.stepSeconds;
      this.#simulationTime += this.stepSeconds;
      steps++;
    }

    let droppedSeconds = 0;
    const hardCap = this.stepSeconds * this.maxStepsPerFrame;
    if (this.#accumulated > hardCap) {
      droppedSeconds = this.#accumulated - hardCap;
      this.#accumulated = hardCap;
    }

    return {
      steps,
      alpha: this.#accumulated / this.stepSeconds,
      droppedSeconds,
      simulationTimeSeconds: this.#simulationTime,
    };
  }
}

export class DeterministicMetricSink {
  #active = new Map<string, number>();
  #totals = new Map<string, number>();

  begin(name: string): void {
    const normalized = name.trim();
    if (!normalized) return;
    this.#active.set(normalized, this.#active.get(normalized) ?? 0);
  }

  end(name: string, units = 1): void {
    const normalized = name.trim();
    if (!normalized || !Number.isFinite(units)) return;
    this.#active.delete(normalized);
    this.increment(normalized, units);
  }

  increment(name: string, delta = 1): void {
    const normalized = name.trim();
    if (!normalized || !Number.isFinite(delta)) return;
    this.#totals.set(normalized, (this.#totals.get(normalized) ?? 0) + delta);
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.#totals.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  reset(): void {
    this.#active.clear();
    this.#totals.clear();
  }
}

export class DeterministicSystemScheduler {
  readonly budget: RuntimeBudget;

  #systems = new Map<SystemId, ScheduledSystem>();
  #ordered: readonly ScheduledSystem[] = [];
  #dirty = true;

  constructor(
    budget: Partial<RuntimeBudget> = {},
  ) {
    this.budget = Object.freeze({
      maxSystems: budget.maxSystems ?? 128,
      maxCommands: budget.maxCommands ?? 2048,
      maxAiDecisions: budget.maxAiDecisions ?? 128,
      maxNetworkBytes: budget.maxNetworkBytes ?? 16_384,
      maxAssetOperations: budget.maxAssetOperations ?? 64,
    });
  }

  register(system: ScheduledSystem): void {
    if (this.#systems.has(system.id)) throw new Error(`System already registered: ${String(system.id)}`);
    this.#systems.set(system.id, system);
    this.#dirty = true;
  }

  registerMany(systems: readonly ScheduledSystem[]): void {
    for (const system of systems) this.register(system);
  }

  remove(id: SystemId): boolean {
    const removed = this.#systems.delete(id);
    if (removed) this.#dirty = true;
    return removed;
  }

  setEnabled(id: SystemId, enabled: boolean): void {
    const current = this.#systems.get(id);
    if (!current) throw new Error(`Unknown system: ${String(id)}`);
    this.#systems.set(id, { ...current, enabled });
    this.#dirty = true;
  }

  list(): readonly ScheduledSystem[] {
    this.#ensureOrder();
    return this.#ordered;
  }

  run(
    tick: RuntimeTick,
    input: InputFrame | null,
    publish: (event: RuntimeEvent) => void,
  ): SchedulerFrame {
    this.#ensureOrder();
    const metrics = new DeterministicMetricSink();
    const events: RuntimeEvent[] = [];
    let commandCount = 0;
    let decisionCount = 0;
    const executed: SystemId[] = [];
    const skipped: SystemId[] = [];

    const context: SystemContext = {
      tick,
      budget: this.budget,
      input,
      publish: (event) => {
        events.push(event);
        publish(event);
      },
      metrics,
    };

    let systemIndex = 0;
    for (const system of this.#ordered) {
      if (systemIndex >= this.budget.maxSystems) {
        skipped.push(system.id);
        continue;
      }
      if (system.enabled === false) {
        skipped.push(system.id);
        continue;
      }
      try {
        metrics.begin(String(system.id));
        system.run(context);
        metrics.end(String(system.id));
        executed.push(system.id);
      } catch (error) {
        skipped.push(system.id);
        publish({
          type: 'incident',
          code: 'R27_SYSTEM_FAILURE',
          severity: 'critical',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      systemIndex++;
    }

    for (const event of events) {
      if (event.type === 'damage' || event.type === 'item-changed') commandCount++;
      if (event.type === 'dialogue-choice') decisionCount++;
    }

    if (commandCount > this.budget.maxCommands) {
      commandCount = this.budget.maxCommands;
    }
    if (decisionCount > this.budget.maxAiDecisions) {
      decisionCount = this.budget.maxAiDecisions;
    }

    return Object.freeze({
      tick,
      executed: uniqueIds(executed),
      skipped: uniqueIds(skipped),
      events: [...events],
      commandCount,
      decisionCount,
    });
  }

  #ensureOrder(): void {
    if (!this.#dirty) return;
    const systems = [...this.#systems.values()];
    if (systems.length > this.budget.maxSystems * 4) throw new Error('Too many registered systems for deterministic scheduler');

    const byId = new Map(systems.map((system) => [String(system.id), system]));
    const phaseRank = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));
    const edges = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();

    for (const system of systems) {
      const id = String(system.id);
      edges.set(id, new Set());
      indegree.set(id, 0);
    }

    const addEdge = (from: SystemId, to: SystemId): void => {
      if (String(from) === String(to)) return;
      const a = String(from);
      const b = String(to);
      if (!byId.has(a) || !byId.has(b)) throw new Error(`Scheduler dependency references unknown system: ${a} -> ${b}`);
      const set = edges.get(a);
      if (!set || set.has(b)) return;
      set.add(b);
      indegree.set(b, (indegree.get(b) ?? 0) + 1);
    };

    for (const system of systems) {
      for (const before of system.before ?? []) addEdge(system.id, before);
      for (const after of system.after ?? []) addEdge(after, system.id);
    }

    const ready = systems
      .filter((system) => (indegree.get(String(system.id)) ?? 0) === 0)
      .sort((a, b) => {
        const phaseA = phaseRank.get(a.phase) ?? Number.MAX_SAFE_INTEGER;
        const phaseB = phaseRank.get(b.phase) ?? Number.MAX_SAFE_INTEGER;
        return phaseA - phaseB || a.order - b.order || stableIdCompare(a.id, b.id);
      });

    const result: ScheduledSystem[] = [];
    while (ready.length > 0) {
      const current = ready.shift();
      if (!current) break;
      result.push(current);
      for (const next of [...(edges.get(String(current.id)) ?? [])].sort()) {
        const nextDegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextDegree);
        if (nextDegree === 0) {
          const node = byId.get(next);
          if (node) {
            ready.push(node);
            ready.sort((a, b) => {
              const phaseA = phaseRank.get(a.phase) ?? Number.MAX_SAFE_INTEGER;
              const phaseB = phaseRank.get(b.phase) ?? Number.MAX_SAFE_INTEGER;
              return phaseA - phaseB || a.order - b.order || stableIdCompare(a.id, b.id);
            });
          }
        }
      }
    }

    if (result.length !== systems.length) {
      throw new Error('Deterministic scheduler dependency cycle detected');
    }

    this.#ordered = result;
    this.#dirty = false;
  }
}

export function buildSystem(
  name: string,
  phase: RuntimePhase,
  order: number,
  run: (context: SystemContext) => void,
  dependencies?: { readonly before?: readonly string[]; readonly after?: readonly string[] },
): ScheduledSystem {
  return {
    id: systemId(name),
    phase,
    order,
    ...(dependencies?.before ? { before: dependencies.before.map(systemId) } : {}),
    ...(dependencies?.after ? { after: dependencies.after.map(systemId) } : {}),
    run,
  };
}
