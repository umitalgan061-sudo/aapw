import type { BudgetUsageV4, RuntimeHealthV4, RuntimeSnapshotV4, RuntimeStatsV4 } from './runtimeContractsV4';

export type DiagnosticSeverityV4 = 'info' | 'notice' | 'warning' | 'critical';
export type DiagnosticDomainV4 = 'runtime' | 'scheduler' | 'ecs' | 'network' | 'asset' | 'render' | 'input' | 'persistence' | 'platform';

export interface DiagnosticEventV4 {
  readonly id: string;
  readonly tick: number;
  readonly timestamp: number;
  readonly severity: DiagnosticSeverityV4;
  readonly domain: DiagnosticDomainV4;
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface DiagnosticThresholdsV4 {
  readonly frameMsWarning: number;
  readonly frameMsCritical: number;
  readonly memoryWarningRatio: number;
  readonly memoryCriticalRatio: number;
  readonly queueWarning: number;
  readonly queueCritical: number;
  readonly networkLossWarning: number;
  readonly networkLossCritical: number;
}

export interface DiagnosticSummaryV4 {
  readonly total: number;
  readonly info: number;
  readonly notice: number;
  readonly warning: number;
  readonly critical: number;
  readonly domains: Readonly<Record<DiagnosticDomainV4, number>>;
  readonly latestTick: number;
  readonly health: 'nominal' | 'degraded' | 'critical';
}

export interface DiagnosticSnapshotV4 {
  readonly capturedAt: number;
  readonly runtime: RuntimeSnapshotV4 | null;
  readonly stats: RuntimeStatsV4 | null;
  readonly budget: BudgetUsageV4 | null;
  readonly health: RuntimeHealthV4 | null;
  readonly summary: DiagnosticSummaryV4;
  readonly events: readonly DiagnosticEventV4[];
}

export interface RuntimeDiagnosticsOptionsV4 {
  readonly maxEvents?: number;
  readonly now?: () => number;
  readonly thresholds?: Partial<DiagnosticThresholdsV4>;
}

const DEFAULT_THRESHOLDS: DiagnosticThresholdsV4 = Object.freeze({
  frameMsWarning: 22,
  frameMsCritical: 40,
  memoryWarningRatio: 0.82,
  memoryCriticalRatio: 0.94,
  queueWarning: 128,
  queueCritical: 512,
  networkLossWarning: 0.04,
  networkLossCritical: 0.12,
});

const SEVERITY_RANK: Record<DiagnosticSeverityV4, number> = { info: 0, notice: 1, warning: 2, critical: 3 };
const DOMAINS: readonly DiagnosticDomainV4[] = Object.freeze(['runtime', 'scheduler', 'ecs', 'network', 'asset', 'render', 'input', 'persistence', 'platform']);
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

function severityForFrame(ms: number, t: DiagnosticThresholdsV4): DiagnosticSeverityV4 {
  if (ms >= t.frameMsCritical) return 'critical';
  if (ms >= t.frameMsWarning) return 'warning';
  if (ms >= t.frameMsWarning * 0.8) return 'notice';
  return 'info';
}
function severityForRatio(ratio: number, t: DiagnosticThresholdsV4): DiagnosticSeverityV4 {
  if (ratio >= t.memoryCriticalRatio) return 'critical';
  if (ratio >= t.memoryWarningRatio) return 'warning';
  if (ratio >= t.memoryWarningRatio * 0.9) return 'notice';
  return 'info';
}
function severityForQueue(size: number, t: DiagnosticThresholdsV4): DiagnosticSeverityV4 {
  if (size >= t.queueCritical) return 'critical';
  if (size >= t.queueWarning) return 'warning';
  if (size >= t.queueWarning * 0.75) return 'notice';
  return 'info';
}
function severityForLoss(loss: number, t: DiagnosticThresholdsV4): DiagnosticSeverityV4 {
  if (loss >= t.networkLossCritical) return 'critical';
  if (loss >= t.networkLossWarning) return 'warning';
  if (loss >= t.networkLossWarning * 0.5) return 'notice';
  return 'info';
}
function cloneRecord(value: Readonly<Record<string, string | number | boolean>>): Readonly<Record<string, string | number | boolean>> {
  return Object.freeze({ ...value });
}

export class RuntimeDiagnosticsV4 {
  readonly maxEvents: number;
  readonly thresholds: DiagnosticThresholdsV4;
  #now: () => number;
  #events: DiagnosticEventV4[] = [];
  #sequence = 0;
  #lastTick = 0;
  #lastSummary: DiagnosticSummaryV4 = this.#emptySummary();

  constructor(options: RuntimeDiagnosticsOptionsV4 = {}) {
    this.maxEvents = Math.max(32, Math.min(4096, Math.trunc(options.maxEvents ?? 512)));
    this.thresholds = Object.freeze({ ...DEFAULT_THRESHOLDS, ...options.thresholds });
    this.#now = options.now ?? (() => performance.now());
  }

  setClock(now: () => number): void { this.#now = now; }

  record(tick: number, severity: DiagnosticSeverityV4, domain: DiagnosticDomainV4, code: string, message: string, details: Readonly<Record<string, string | number | boolean>> = {}): DiagnosticEventV4 {
    const normalizedTick = Math.max(0, Math.trunc(finite(tick)));
    this.#lastTick = Math.max(this.#lastTick, normalizedTick);
    const event: DiagnosticEventV4 = Object.freeze({
      id: `d-${this.#lastTick}-${this.#sequence++}`,
      tick: normalizedTick,
      timestamp: finite(this.#now()),
      severity,
      domain,
      code: code.trim() || 'RUNTIME_DIAGNOSTIC',
      message: message.trim() || 'Runtime diagnostic event',
      details: cloneRecord(details),
    });
    this.#events.push(event);
    if (this.#events.length > this.maxEvents) this.#events.splice(0, this.#events.length - this.maxEvents);
    this.#lastSummary = this.#summarize(this.#events);
    return event;
  }

  inspect(tick: number, stats: RuntimeStatsV4, budget: BudgetUsageV4, health: RuntimeHealthV4): readonly DiagnosticEventV4[] {
    const created: DiagnosticEventV4[] = [];
    const frameMs = finite(stats.frameMs);
    const frameSeverity = severityForFrame(frameMs, this.thresholds);
    if (SEVERITY_RANK[frameSeverity] > SEVERITY_RANK.info) created.push(this.record(tick, frameSeverity, 'render', 'FRAME_BUDGET', `Frame budget pressure: ${frameMs.toFixed(2)}ms`, { frameMs }));
    const memoryBudget = Math.max(1, finite(budget.memoryBytes));
    const memoryUsed = Math.max(0, finite(budget.memoryUsedBytes));
    const memoryRatio = Math.min(1, memoryUsed / memoryBudget);
    const memorySeverity = severityForRatio(memoryRatio, this.thresholds);
    if (SEVERITY_RANK[memorySeverity] > SEVERITY_RANK.info) created.push(this.record(tick, memorySeverity, 'runtime', 'MEMORY_BUDGET', `Memory budget pressure: ${(memoryRatio * 100).toFixed(1)}%`, { memoryRatio, memoryUsed, memoryBudget }));
    const queueSize = Math.max(0, Math.trunc(finite(stats.pendingCommands)));
    const queueSeverity = severityForQueue(queueSize, this.thresholds);
    if (SEVERITY_RANK[queueSeverity] > SEVERITY_RANK.info) created.push(this.record(tick, queueSeverity, 'scheduler', 'COMMAND_QUEUE', `Command queue depth: ${queueSize}`, { queueSize }));
    const packetLoss = Math.max(0, finite(stats.packetLossRatio));
    const networkSeverity = severityForLoss(packetLoss, this.thresholds);
    if (SEVERITY_RANK[networkSeverity] > SEVERITY_RANK.info) created.push(this.record(tick, networkSeverity, 'network', 'PACKET_LOSS', `Packet loss: ${(packetLoss * 100).toFixed(2)}%`, { packetLoss }));
    if (!health.healthy) created.push(this.record(tick, 'critical', 'runtime', 'HEALTH_REPORT', 'Runtime health reports a failure state', { healthy: false }));
    return Object.freeze(created.slice());
  }

  capture(capturedAt: number, runtime: RuntimeSnapshotV4 | null, stats: RuntimeStatsV4 | null, budget: BudgetUsageV4 | null, health: RuntimeHealthV4 | null): DiagnosticSnapshotV4 {
    if (runtime) this.#lastTick = Math.max(this.#lastTick, Number(runtime.tick));
    const events = Object.freeze(this.#events.slice());
    const summary = this.#summarize(events);
    this.#lastSummary = summary;
    return Object.freeze({ capturedAt: finite(capturedAt, this.#now()), runtime, stats, budget, health, summary, events });
  }

  recent(limit = 32, minimumSeverity: DiagnosticSeverityV4 = 'info'): readonly DiagnosticEventV4[] {
    const max = Math.max(0, Math.min(limit, this.maxEvents));
    const threshold = SEVERITY_RANK[minimumSeverity];
    return Object.freeze(this.#events.filter((event) => SEVERITY_RANK[event.severity] >= threshold).slice(-max));
  }

  summary(): DiagnosticSummaryV4 { return this.#lastSummary; }
  clear(): void { this.#events.length = 0; this.#lastSummary = this.#emptySummary(); }
  exportJson(): string { return JSON.stringify(this.capture(this.#now(), null, null, null, null)); }

  #summarize(events: readonly DiagnosticEventV4[]): DiagnosticSummaryV4 {
    const counts: Record<DiagnosticSeverityV4, number> = { info: 0, notice: 0, warning: 0, critical: 0 };
    const domains = Object.fromEntries(DOMAINS.map((domain) => [domain, 0])) as Record<DiagnosticDomainV4, number>;
    let latestTick = 0;
    for (const event of events) { counts[event.severity] += 1; domains[event.domain] += 1; latestTick = Math.max(latestTick, event.tick); }
    const health = counts.critical > 0 ? 'critical' : counts.warning > 0 ? 'degraded' : 'nominal';
    return Object.freeze({ total: events.length, info: counts.info, notice: counts.notice, warning: counts.warning, critical: counts.critical, domains: Object.freeze(domains), latestTick, health });
  }

  #emptySummary(): DiagnosticSummaryV4 {
    return Object.freeze({ total: 0, info: 0, notice: 0, warning: 0, critical: 0, domains: Object.freeze(Object.fromEntries(DOMAINS.map((domain) => [domain, 0])) as Record<DiagnosticDomainV4, number>), latestTick: 0, health: 'nominal' });
  }
}
