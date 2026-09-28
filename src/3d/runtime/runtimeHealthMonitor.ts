/**
 * Strict runtime health monitor.
 *
 * Computes bounded health signals and recovery hints without owning renderer or quality state.
 */
import { clamp, finiteOr, integerOr } from './modernRuntimeContract.ts';

export const HEALTH_LEVELS = Object.freeze(['healthy', 'watch', 'degraded', 'critical'] as const);
export type HealthLevel = (typeof HEALTH_LEVELS)[number];
export type HealthAction = 'pause-or-throttle' | 'reduce-quality' | 'shed-effects' | 'consider-recovery' | 'hold';

export interface RuntimeHealthOptions {
  readonly frameBudgetMs?: number;
  readonly simulationBudgetMs?: number;
  readonly presentationBudgetMs?: number;
  readonly historySize?: number;
}
export interface HealthSampleInput {
  readonly deltaMs?: number;
  readonly simulationMs?: number;
  readonly presentationMs?: number;
  readonly dropped?: boolean;
  readonly timestampMs?: number;
}
export interface HealthSample {
  readonly level: HealthLevel;
  readonly load: number;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly presentationMs: number;
  readonly consecutiveBadFrames: number;
  readonly consecutiveGoodFrames: number;
  readonly visibility: string;
}
export interface HealthSummary {
  readonly health: HealthLevel;
  readonly visibility: string;
  readonly stalls: number;
  readonly dropped: number;
  readonly recoveries: number;
  readonly lastTimestampMs: number;
  readonly frame: Readonly<{ averageMs: number; worstMs: number }>;
  readonly simulation: Readonly<{ averageMs: number; worstMs: number }>;
  readonly presentation: Readonly<{ averageMs: number; worstMs: number }>;
  readonly recommendation: Readonly<{ action: HealthAction; reason: string }>;
}
export interface RuntimeHealthMonitor {
  sample(input?: HealthSampleInput): HealthSample;
  setVisibility(next: string): string;
  recommend(): Readonly<{ action: HealthAction; reason: string }>;
  summary(): HealthSummary;
  reset(): void;
  readonly health: HealthLevel;
}
interface CounterWindow {
  push(sample: number): void;
  values(): readonly number[];
  clear(): void;
}

function levelFromLoad(load: number): HealthLevel {
  if (load <= 0.9) return 'healthy';
  if (load <= 1.1) return 'watch';
  if (load <= 1.4) return 'degraded';
  return 'critical';
}
function maxLevel(a: HealthLevel, b: HealthLevel): HealthLevel {
  return HEALTH_LEVELS[Math.max(HEALTH_LEVELS.indexOf(a), HEALTH_LEVELS.indexOf(b))] ?? 'watch';
}
function createCounterWindow(size: number): CounterWindow {
  const values: number[] = [];
  return {
    push(sample) { values.push(sample); if (values.length > size) values.shift(); },
    values() { return values.slice(); },
    clear() { values.length = 0; },
  };
}
function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function createRuntimeHealthMonitor(options: RuntimeHealthOptions = {}): RuntimeHealthMonitor {
  const frameBudgetMs = clamp(finiteOr(options.frameBudgetMs, 16.67), 4, 100);
  const simulationBudgetMs = clamp(finiteOr(options.simulationBudgetMs, 7), 1, 80);
  const presentationBudgetMs = clamp(finiteOr(options.presentationBudgetMs, 5), 1, 80);
  const historySize = clamp(integerOr(options.historySize, 120), 30, 1000);
  const frames = createCounterWindow(historySize);
  const simulation = createCounterWindow(historySize);
  const presentation = createCounterWindow(historySize);
  let visibility = 'visible';
  let consecutiveBadFrames = 0;
  let consecutiveGoodFrames = 0;
  let lastHealth: HealthLevel = 'healthy';
  let lastTimestampMs = 0;
  let stalls = 0;
  let recoveries = 0;
  let dropped = 0;

  function sample(input: HealthSampleInput = {}): HealthSample {
    const deltaMs = clamp(finiteOr(input.deltaMs, frameBudgetMs), 0, 500);
    const simMs = clamp(finiteOr(input.simulationMs, 0), 0, 500);
    const presentMs = clamp(finiteOr(input.presentationMs, 0), 0, 500);
    const load = Math.max(deltaMs / frameBudgetMs, simMs / simulationBudgetMs, presentMs / presentationBudgetMs);
    const level = levelFromLoad(load);
    frames.push(deltaMs);
    simulation.push(simMs);
    presentation.push(presentMs);
    if (deltaMs > frameBudgetMs * 2) stalls += 1;
    if (input.dropped) dropped += 1;
    if (level === 'healthy' || level === 'watch') {
      consecutiveGoodFrames += 1;
      consecutiveBadFrames = 0;
    } else {
      consecutiveBadFrames += 1;
      consecutiveGoodFrames = 0;
    }
    if (level !== lastHealth && level === 'healthy') recoveries += 1;
    lastHealth = level;
    lastTimestampMs = Math.max(lastTimestampMs, finiteOr(input.timestampMs, lastTimestampMs));
    return Object.freeze({ level, load, frameMs: deltaMs, simulationMs: simMs, presentationMs: presentMs, consecutiveBadFrames, consecutiveGoodFrames, visibility });
  }
  function setVisibility(next: string): string {
    visibility = ['visible', 'hidden', 'prerender', 'unknown'].includes(next) ? next : 'unknown';
    return visibility;
  }
  function recommend(): Readonly<{ action: HealthAction; reason: string }> {
    if (visibility !== 'visible') return Object.freeze({ action: 'pause-or-throttle', reason: `visibility:${visibility}` });
    if (consecutiveBadFrames >= 12) return Object.freeze({ action: 'reduce-quality', reason: 'sustained-budget-pressure' });
    if (consecutiveBadFrames >= 4) return Object.freeze({ action: 'shed-effects', reason: 'budget-pressure' });
    if (consecutiveGoodFrames >= 180) return Object.freeze({ action: 'consider-recovery', reason: 'sustained-recovery' });
    return Object.freeze({ action: 'hold', reason: 'stable' });
  }
  function summary(): HealthSummary {
    const frameValues = frames.values();
    const simValues = simulation.values();
    const presentValues = presentation.values();
    return Object.freeze({
      health: lastHealth,
      visibility,
      stalls,
      dropped,
      recoveries,
      lastTimestampMs,
      frame: Object.freeze({ averageMs: average(frameValues), worstMs: Math.max(0, ...frameValues) }),
      simulation: Object.freeze({ averageMs: average(simValues), worstMs: Math.max(0, ...simValues) }),
      presentation: Object.freeze({ averageMs: average(presentValues), worstMs: Math.max(0, ...presentValues) }),
      recommendation: recommend(),
    });
  }
  function reset(): void {
    frames.clear(); simulation.clear(); presentation.clear();
    consecutiveBadFrames = 0; consecutiveGoodFrames = 0; lastHealth = 'healthy';
    lastTimestampMs = 0; stalls = 0; recoveries = 0; dropped = 0;
  }
  return Object.freeze({ sample, setVisibility, recommend, summary, reset, get health(): HealthLevel { return lastHealth; } });
}

export function combineHealthLevels(...levels: readonly (string | HealthLevel)[]): HealthLevel {
  let result: HealthLevel = 'healthy';
  for (const level of levels) {
    result = maxLevel(result, HEALTH_LEVELS.includes(level as HealthLevel) ? level as HealthLevel : 'watch');
  }
  return result;
}

export function buildHealthBudget(input: Readonly<Record<string, unknown>> = {}): Readonly<{
  frameMs: number; simulationMs: number; presentationMs: number; networkMs: number; storageMs: number;
}> {
  return Object.freeze({
    frameMs: clamp(finiteOr(input.frameMs, 16.67), 4, 100),
    simulationMs: clamp(finiteOr(input.simulationMs, 7), 1, 80),
    presentationMs: clamp(finiteOr(input.presentationMs, 5), 1, 80),
    networkMs: clamp(finiteOr(input.networkMs, 250), 20, 5000),
    storageMs: clamp(finiteOr(input.storageMs, 50), 5, 1000),
  });
}
