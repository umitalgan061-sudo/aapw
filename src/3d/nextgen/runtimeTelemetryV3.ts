/** Runtime telemetry primitives with bounded histories and frame-budget accounting. */

export type TelemetryDomain = 'frame' | 'simulation' | 'render' | 'network' | 'streaming' | 'ai' | 'audio' | 'memory';
export type BudgetSeverity = 'ok' | 'warning' | 'critical';

export interface MetricSample { tick: number; value: number }
export interface RuntimeBudget { domain: TelemetryDomain; budgetMs: number; warningRatio: number; criticalRatio: number }
export interface BudgetResult { domain: TelemetryDomain; elapsedMs: number; budgetMs: number; utilization: number; severity: BudgetSeverity }
export interface FrameTelemetry { tick: number; cpuMs: number; renderMs: number; simulationMs: number; networkMs: number; streamingMs: number; gpuMs: number | null; entityCount: number; drawCalls: number; triangles: number }
export interface TelemetrySummary { frameP95Ms: number; simulationP95Ms: number; renderP95Ms: number; networkP95Ms: number; streamingP95Ms: number; avgEntityCount: number; avgDrawCalls: number; droppedSamples: number }

const DEFAULT_HISTORY = 240;

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export class RingBuffer<T> {
  readonly capacity: number;
  #items: T[] = [];
  #cursor = 0;
  #dropped = 0;

  constructor(capacity = DEFAULT_HISTORY) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be > 0');
    this.capacity = capacity;
  }

  push(value: T): void {
    if (this.#items.length < this.capacity) { this.#items.push(value); return; }
    this.#items[this.#cursor] = value;
    this.#cursor = (this.#cursor + 1) % this.capacity;
    this.#dropped += 1;
  }

  values(): readonly T[] {
    if (this.#items.length < this.capacity || this.#cursor === 0) return [...this.#items];
    return [...this.#items.slice(this.#cursor), ...this.#items.slice(0, this.#cursor)];
  }

  clear(): void { this.#items.length = 0; this.#cursor = 0; this.#dropped = 0; }
  get dropped(): number { return this.#dropped; }
  get size(): number { return this.#items.length; }
}

export class RuntimeTelemetryV3 {
  readonly history: RingBuffer<FrameTelemetry>;
  readonly budgets = new Map<TelemetryDomain, RuntimeBudget>();
  #active = new Map<TelemetryDomain, { startedAt: number; tick: number }>();
  #budgetResults = new RingBuffer<BudgetResult>(DEFAULT_HISTORY);

  constructor(historyCapacity = DEFAULT_HISTORY) { this.history = new RingBuffer(historyCapacity); }

  defineBudget(budget: RuntimeBudget): void {
    if (budget.budgetMs <= 0) throw new RangeError('budgetMs must be > 0');
    if (budget.warningRatio < 0 || budget.warningRatio > 2) throw new RangeError('invalid warning ratio');
    if (budget.criticalRatio < budget.warningRatio) throw new RangeError('criticalRatio must be >= warningRatio');
    this.budgets.set(budget.domain, { ...budget });
  }

  begin(domain: TelemetryDomain, tick: number, now = performance.now()): void {
    if (!Number.isFinite(now)) throw new RangeError('now must be finite');
    if (this.#active.has(domain)) throw new Error(`telemetry span already active: ${domain}`);
    this.#active.set(domain, { startedAt: now, tick });
  }

  end(domain: TelemetryDomain, now = performance.now()): BudgetResult | null {
    const active = this.#active.get(domain);
    if (!active) return null;
    this.#active.delete(domain);
    const budget = this.budgets.get(domain);
    if (!budget) return null;
    const elapsedMs = Math.max(0, now - active.startedAt);
    const utilization = elapsedMs / budget.budgetMs;
    const severity: BudgetSeverity = utilization >= budget.criticalRatio ? 'critical' : utilization >= budget.warningRatio ? 'warning' : 'ok';
    const result = { domain, elapsedMs, budgetMs: budget.budgetMs, utilization, severity };
    this.#budgetResults.push(result);
    return result;
  }

  record(frame: FrameTelemetry): void {
    if (![frame.cpuMs, frame.renderMs, frame.simulationMs, frame.networkMs, frame.streamingMs, frame.entityCount, frame.drawCalls, frame.triangles].every(Number.isFinite)) throw new RangeError('telemetry frame contains non-finite values');
    this.history.push({ ...frame });
  }

  latest(): FrameTelemetry | undefined { return this.history.values().at(-1); }
  budgetResults(): readonly BudgetResult[] { return this.#budgetResults.values(); }

  summarize(): TelemetrySummary {
    const frames = this.history.values();
    const avg = (key: keyof FrameTelemetry): number => frames.length ? frames.reduce((sum, frame) => sum + Number(frame[key]), 0) / frames.length : 0;
    return {
      frameP95Ms: percentile(frames.map((frame) => frame.cpuMs), 0.95),
      simulationP95Ms: percentile(frames.map((frame) => frame.simulationMs), 0.95),
      renderP95Ms: percentile(frames.map((frame) => frame.renderMs), 0.95),
      networkP95Ms: percentile(frames.map((frame) => frame.networkMs), 0.95),
      streamingP95Ms: percentile(frames.map((frame) => frame.streamingMs), 0.95),
      avgEntityCount: avg('entityCount'),
      avgDrawCalls: avg('drawCalls'),
      droppedSamples: this.history.dropped,
    };
  }
}

export function createDefaultTelemetry(): RuntimeTelemetryV3 {
  const telemetry = new RuntimeTelemetryV3();
  telemetry.defineBudget({ domain: 'frame', budgetMs: 16.67, warningRatio: 0.82, criticalRatio: 1 });
  telemetry.defineBudget({ domain: 'simulation', budgetMs: 6.5, warningRatio: 0.8, criticalRatio: 1 });
  telemetry.defineBudget({ domain: 'render', budgetMs: 8.5, warningRatio: 0.82, criticalRatio: 1 });
  telemetry.defineBudget({ domain: 'network', budgetMs: 1.5, warningRatio: 0.8, criticalRatio: 1 });
  telemetry.defineBudget({ domain: 'streaming', budgetMs: 2.0, warningRatio: 0.8, criticalRatio: 1 });
  telemetry.defineBudget({ domain: 'ai', budgetMs: 1.2, warningRatio: 0.8, criticalRatio: 1 });
  return telemetry;
}
