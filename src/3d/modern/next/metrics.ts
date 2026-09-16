export interface BudgetMetricInput {
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly workerMs: number;
  readonly memoryBytes: number;
  readonly targetFrameMs: number;
}

export interface BudgetHealth {
  readonly frameMs: number;
  readonly frameBudgetUtilization: number;
  readonly cpuUtilization: number;
  readonly memoryMb: number;
  readonly status: 'healthy' | 'degraded' | 'critical';
  readonly recommendations: readonly string[];
}

export function evaluateBudget(input: BudgetMetricInput): BudgetHealth {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const simulationMs = finite(input.simulationMs);
  const renderMs = finite(input.renderMs);
  const streamingMs = finite(input.streamingMs);
  const networkMs = finite(input.networkMs);
  const workerMs = finite(input.workerMs);
  const frameMs = simulationMs + renderMs + streamingMs + networkMs;
  const target = Math.max(1, finite(input.targetFrameMs));
  const utilization = frameMs / target;
  const cpu = (simulationMs + workerMs) / target;
  const memoryMb = finite(input.memoryBytes) / (1024 * 1024);
  const recommendations: string[] = [];
  if (renderMs > target * 0.55) recommendations.push('reduce render resolution or distant LOD density');
  if (simulationMs > target * 0.35) recommendations.push('reduce simulation frequency for distant actors');
  if (streamingMs > target * 0.2) recommendations.push('spread streaming work across more frames');
  if (networkMs > target * 0.15) recommendations.push('reduce snapshot frequency or delta size');
  if (workerMs > target * 0.2) recommendations.push('defer low-priority worker jobs');
  if (memoryMb > 1024) recommendations.push('evict unpinned resources and reduce cache budgets');
  const status = utilization > 1.35 || memoryMb > 2048 ? 'critical' : utilization > 1.1 || memoryMb > 1536 ? 'degraded' : 'healthy';
  return { frameMs, frameBudgetUtilization: utilization, cpuUtilization: cpu, memoryMb, status, recommendations };
}

export class RollingBudgetMetrics {
  readonly windowSize: number;
  #samples: BudgetHealth[] = [];
  constructor(windowSize = 120) { this.windowSize = Math.max(16, Math.floor(windowSize)); }
  add(health: BudgetHealth): void { if (this.#samples.length >= this.windowSize) this.#samples.shift(); this.#samples.push(health); }
  count(): number { return this.#samples.length; }
  averageFrameMs(): number { return this.#samples.length ? this.#samples.reduce((sum, sample) => sum + sample.frameMs, 0) / this.#samples.length : 0; }
  criticalRatio(): number { return this.#samples.length ? this.#samples.filter((sample) => sample.status === 'critical').length / this.#samples.length : 0; }
  latest(): BudgetHealth | undefined { return this.#samples.at(-1); }
  clear(): void { this.#samples.length = 0; }
}
