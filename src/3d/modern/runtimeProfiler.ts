import type { PressureState, QualityTier } from './types';
import { checksum, clamp01, quantize } from './deterministic';
import { RollingTelemetry } from './telemetry';

export interface ProfilerMark {
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly frame: number;
}

export interface FrameProfile {
  readonly frame: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly totalMs: number;
  readonly phases: readonly ProfilerMark[];
  readonly pressure: PressureState;
  readonly quality: QualityTier;
  readonly digest: string;
}

export interface ProfilerBudget {
  readonly totalMs: number;
  readonly simulationMs: number;
  readonly streamingMs: number;
  readonly animationMs: number;
  readonly renderMs: number;
  readonly uiMs: number;
}

export interface BudgetViolation {
  readonly phase: string;
  readonly actualMs: number;
  readonly budgetMs: number;
  readonly ratio: number;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Low-overhead production profiler with explicit phase budgets and deterministic summaries. */
export class RuntimeProfiler {
  readonly telemetry: RollingTelemetry;
  readonly budget: ProfilerBudget;
  #frames: FrameProfile[] = [];
  #active: { frame: number; startedAt: number; phases: ProfilerMark[]; current: { name: string; startMs: number } | null } | null = null;
  #maxFrames: number;

  constructor(options: { readonly budget?: Partial<ProfilerBudget>; readonly maxFrames?: number; readonly telemetry?: RollingTelemetry } = {}) {
    this.budget = Object.freeze({ totalMs: 16.6667, simulationMs: 4, streamingMs: 2.2, animationMs: 1.8, renderMs: 7.1, uiMs: 1.2, ...options.budget });
    this.#maxFrames = Math.max(30, Math.min(1024, Math.floor(options.maxFrames ?? 240)));
    this.telemetry = options.telemetry ?? new RollingTelemetry({ maxSamples: this.#maxFrames });
  }

  begin(frame: number): void {
    if (this.#active) this.end({ cpu: 0, gpu: 0, frame: 0, memory: 0, thermal: 0, combined: 0 }, 'balanced');
    this.#active = { frame: Math.max(0, Math.trunc(frame)), startedAt: now(), phases: [], current: null };
  }

  enter(name: string): void {
    if (!this.#active) throw new Error('Profiler frame has not started');
    if (this.#active.current) this.exit();
    this.#active.current = { name, startMs: now() };
  }

  exit(): void {
    if (!this.#active?.current) return;
    const endMs = now();
    const current = this.#active.current;
    this.#active.phases.push({ name: current.name, startMs: current.startMs, endMs, durationMs: Math.max(0, endMs - current.startMs), frame: this.#active.frame });
    this.#active.current = null;
  }

  end(pressure: PressureState, quality: QualityTier): FrameProfile {
    if (!this.#active) throw new Error('Profiler frame has not started');
    if (this.#active.current) this.exit();
    const endedAt = now();
    const active = this.#active;
    const profile: FrameProfile = Object.freeze({
      frame: active.frame,
      startedAt: active.startedAt,
      endedAt,
      totalMs: Math.max(0, endedAt - active.startedAt),
      phases: Object.freeze(active.phases.map((phase) => ({ ...phase }))),
      pressure,
      quality,
      digest: checksum({ frame: active.frame, phases: active.phases.map((phase) => ({ name: phase.name, durationMs: quantize(phase.durationMs, 0.001) })), quality }),
    });
    this.#frames.push(profile);
    if (this.#frames.length > this.#maxFrames) this.#frames.splice(0, this.#frames.length - this.#maxFrames);
    this.#active = null;
    return profile;
  }

  current(): FrameProfile | null {
    const latest = this.#frames[this.#frames.length - 1];
    return latest ? { ...latest, phases: latest.phases.map((phase) => ({ ...phase })) } : null;
  }

  history(): readonly FrameProfile[] {
    return this.#frames.map((frame) => ({ ...frame, phases: frame.phases.map((phase) => ({ ...phase })) }));
  }

  violations(profile = this.current()): readonly BudgetViolation[] {
    if (!profile) return [];
    const budgetFor = (name: string): number => {
      switch (name) {
        case 'simulation': return this.budget.simulationMs;
        case 'streaming': return this.budget.streamingMs;
        case 'animation': return this.budget.animationMs;
        case 'render': return this.budget.renderMs;
        case 'ui': return this.budget.uiMs;
        default: return this.budget.totalMs;
      }
    };
    const violations: BudgetViolation[] = [];
    if (profile.totalMs > this.budget.totalMs) violations.push({ phase: 'frame', actualMs: profile.totalMs, budgetMs: this.budget.totalMs, ratio: profile.totalMs / this.budget.totalMs });
    for (const phase of profile.phases) {
      const budget = budgetFor(phase.name);
      if (phase.durationMs > budget) violations.push({ phase: phase.name, actualMs: phase.durationMs, budgetMs: budget, ratio: phase.durationMs / budget });
    }
    return violations;
  }

  summary(): Readonly<Record<string, number>> {
    const latest = this.current();
    const violations = this.violations(latest);
    const total = this.#frames.length;
    const over = this.#frames.filter((frame) => frame.totalMs > this.budget.totalMs).length;
    return Object.freeze({
      frames: total,
      latestMs: latest?.totalMs ?? 0,
      averageMs: total ? this.#frames.reduce((sum, frame) => sum + frame.totalMs, 0) / total : 0,
      p95Ms: total ? this.#percentile(0.95) : 0,
      overBudgetRatio: total ? over / total : 0,
      currentViolations: violations.length,
      severity: clamp01((latest?.pressure.combined ?? 0) + (over > 0 ? 0.25 : 0)),
    });
  }

  reset(): void {
    this.#frames = [];
    this.#active = null;
    this.telemetry.clear();
  }

  #percentile(percentile: number): number {
    const values = this.#frames.map((frame) => frame.totalMs).sort((a, b) => a - b);
    if (!values.length) return 0;
    const index = (values.length - 1) * clamp01(percentile);
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return lo === hi ? values[lo] ?? 0 : (values[lo] ?? 0) + ((values[hi] ?? 0) - (values[lo] ?? 0)) * (index - lo);
  }
}

export function createRuntimeProfiler(budget?: Partial<ProfilerBudget>): RuntimeProfiler {
  return new RuntimeProfiler({ budget });
}
