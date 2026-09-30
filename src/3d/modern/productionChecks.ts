import { checksum } from './deterministic';
import type { PlatformError, Result, UnixMillis } from './types';
import type { ProductionRuntimeState } from './productionRuntime';
import type { RecoveryStats } from './recoveryOrchestrator';
import type { SecurityFinding } from './runtimeSecurity';

export type HealthLevel = 'healthy' | 'degraded' | 'warning' | 'blocked';
export type HealthDomain = 'runtime' | 'performance' | 'memory' | 'network' | 'security' | 'persistence' | 'world';

export interface HealthCheck {
  readonly id: string;
  readonly domain: HealthDomain;
  readonly level: HealthLevel;
  readonly message: string;
  readonly score: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ProductionHealthReport {
  readonly level: HealthLevel;
  readonly score: number;
  readonly checks: readonly HealthCheck[];
  readonly generatedAt: UnixMillis;
  readonly digest: string;
}

export interface ProductionCheckInput {
  readonly runtime?: ProductionRuntimeState | null;
  readonly security?: readonly SecurityFinding[];
  readonly recovery?: RecoveryStats | null;
  readonly fps?: number;
  readonly frameP95?: number;
  readonly memoryBytes?: number;
  readonly memoryLimitBytes?: number;
  readonly saveAvailable?: boolean;
  readonly loadedCells?: number;
  readonly expectedLoadedCells?: number;
  readonly networkRttMs?: number;
}

function levelForScore(score: number): HealthLevel { return score >= 95 ? 'healthy' : score >= 80 ? 'degraded' : score >= 60 ? 'warning' : 'blocked'; }
function scoreFrameP95(value: number | undefined): number { if (value === undefined) return 100; if (value <= 17) return 100; if (value <= 25) return 92; if (value <= 33) return 80; if (value <= 50) return 60; return 30; }
function scoreFps(value: number | undefined): number { if (value === undefined) return 100; if (value >= 58) return 100; if (value >= 50) return 90; if (value >= 40) return 75; if (value >= 30) return 55; return 25; }
function scoreMemory(value: number | undefined, limit: number | undefined): number { if (value === undefined || !limit) return 100; const ratio = value / Math.max(1, limit); return ratio <= 0.65 ? 100 : ratio <= 0.8 ? 90 : ratio <= 0.9 ? 75 : ratio <= 0.97 ? 55 : 20; }

/** Deterministic production readiness evaluator used by headless CI and in-game diagnostics. */
export function evaluateProductionHealth(input: ProductionCheckInput): ProductionHealthReport {
  const checks: HealthCheck[] = [];
  const now = Date.now() as UnixMillis;
  const add = (id: string, domain: HealthDomain, score: number, message: string, metadata: Record<string, unknown> = {}): void => {
    checks.push(Object.freeze({ id, domain, level: levelForScore(score), score, message, metadata: Object.freeze({ ...metadata }) }));
  };
  const runtime = input.runtime;
  if (!runtime) add('runtime.missing', 'runtime', 0, 'Runtime state is unavailable');
  else {
    add('runtime.lifecycle', 'runtime', runtime.lifecycle === 'running' ? 100 : runtime.lifecycle === 'paused' ? 90 : 30, `Lifecycle: ${runtime.lifecycle}`);
    add('runtime.frame', 'runtime', Number(runtime.frame) > 0 ? 100 : 60, `Frame counter: ${Number(runtime.frame)}`);
    add('runtime.quality', 'performance', runtime.quality === 'ultra' ? 92 : runtime.quality === 'high' ? 100 : runtime.quality === 'medium' ? 90 : 75, `Quality: ${runtime.quality}`);
  }
  const p95 = scoreFrameP95(input.frameP95);
  add('performance.frame-p95', 'performance', p95, `Frame p95: ${input.frameP95 ?? 'n/a'} ms`, { value: input.frameP95 ?? null });
  const fps = scoreFps(input.fps);
  add('performance.fps', 'performance', fps, `FPS: ${input.fps ?? 'n/a'}`, { value: input.fps ?? null });
  const memory = scoreMemory(input.memoryBytes, input.memoryLimitBytes);
  add('memory.ratio', 'memory', memory, `Memory: ${input.memoryBytes ?? 'n/a'} / ${input.memoryLimitBytes ?? 'n/a'}`, { value: input.memoryBytes ?? null, limit: input.memoryLimitBytes ?? null });
  if (input.networkRttMs !== undefined) add('network.rtt', 'network', input.networkRttMs <= 80 ? 100 : input.networkRttMs <= 150 ? 90 : input.networkRttMs <= 300 ? 70 : 40, `RTT: ${input.networkRttMs} ms`);
  else add('network.rtt', 'network', 100, 'Network metrics not required');
  const blockers = (input.security ?? []).filter((finding) => finding.severity === 'blocker');
  add('security.blockers', 'security', blockers.length ? 0 : 100, blockers.length ? `${blockers.length} security blockers` : 'No security blockers', { blockers: blockers.map((item) => item.code) });
  add('persistence.available', 'persistence', input.saveAvailable === false ? 60 : 100, input.saveAvailable === false ? 'Persistence backend unavailable' : 'Persistence backend available');
  if (input.loadedCells !== undefined && input.expectedLoadedCells !== undefined) {
    const coverage = input.expectedLoadedCells <= 0 ? 1 : Math.min(1, input.loadedCells / input.expectedLoadedCells);
    add('world.streaming', 'world', coverage >= 0.95 ? 100 : coverage >= 0.75 ? 85 : coverage >= 0.5 ? 65 : 35, `Loaded cells: ${input.loadedCells}/${input.expectedLoadedCells}`, { coverage });
  } else add('world.streaming', 'world', 100, 'Streaming metrics not required');
  if (input.recovery) add('runtime.recovery', 'runtime', input.recovery.failed === 0 ? 100 : input.recovery.failed < input.recovery.successful + 2 ? 75 : 40, `Recovery: ${input.recovery.successful} success, ${input.recovery.failed} failed`);
  const score = checks.reduce((sum, check) => sum + check.score, 0) / Math.max(1, checks.length);
  const level = levelForScore(score);
  const digest = checksum(checks.map((check) => ({ id: check.id, score: check.score, level: check.level })));
  return Object.freeze({ level, score, checks: Object.freeze(checks), generatedAt: now, digest });
}

export function assertProductionHealth(report: ProductionHealthReport, minimum: HealthLevel = 'warning'): Result<true> {
  const order: Record<HealthLevel, number> = { healthy: 4, degraded: 3, warning: 2, blocked: 1 };
  if (order[report.level] >= order[minimum]) return { ok: true, value: true };
  const blocker = report.checks.find((check) => check.level === 'blocked');
  const error: PlatformError = Object.freeze({ code: 'PRODUCTION_HEALTH_BLOCKED', message: blocker?.message ?? `Production health is ${report.level}`, retryable: false });
  return { ok: false, error };
}

export function formatProductionHealth(report: ProductionHealthReport): string {
  const lines = [`Aapw production health: ${report.level} (${report.score.toFixed(1)})`, `digest=${report.digest}`];
  for (const check of report.checks) lines.push(`${check.level.padEnd(8)} ${check.domain.padEnd(12)} ${check.id}: ${check.message}`);
  return lines.join('\n');
}
