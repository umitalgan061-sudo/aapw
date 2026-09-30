/** Strict TypeScript audio graph safety monitor. */

export type AudioGraphHealthState = 'healthy' | 'pressured' | 'critical';
export type AudioGraphSafetyAction = 'none' | 'virtualize' | 'stop-ambience' | 'stop-optional';

export interface AudioGraphHealthInput {
  readonly sourceCount?: number;
  readonly sourceLimit?: number;
  readonly positionalCount?: number;
  readonly positionalLimit?: number;
  readonly generatedBufferCount?: number;
  readonly bufferLimit?: number;
  readonly transientRate?: number;
  readonly transientLimit?: number;
  readonly contextState?: string;
}

export interface AudioGraphHealthSnapshot {
  readonly version: 1;
  readonly state: AudioGraphHealthState;
  readonly ratio: number;
  readonly action: AudioGraphSafetyAction;
  readonly contextState: string;
  readonly counts: Readonly<{
    sources: number;
    positional: number;
    buffers: number;
    transients: number;
  }>;
  readonly limits: Readonly<{
    sourceCap: number;
    positionalCap: number;
    bufferCap: number;
    transientCap: number;
  }>;
}

export interface AudioGraphSmoothingPolicy {
  readonly attack: number;
  readonly release: number;
}

const STATES = Object.freeze({
  HEALTHY: 'healthy',
  PRESSURED: 'pressured',
  CRITICAL: 'critical',
} satisfies Record<string, AudioGraphHealthState>);

const ACTIONS = Object.freeze({
  NONE: 'none',
  VIRTUALIZE: 'virtualize',
  STOP_AMBIENCE: 'stop-ambience',
  STOP_OPTIONAL: 'stop-optional',
} satisfies Record<string, AudioGraphSafetyAction>);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback;
}

export function evaluateAudioGraphHealth(input: AudioGraphHealthInput = {}): AudioGraphHealthSnapshot {
  const sources = Math.max(0, Math.round(finiteOr(input.sourceCount, 0)));
  const sourceCap = Math.max(1, Math.round(finiteOr(input.sourceLimit, 16)));
  const positional = Math.max(0, Math.round(finiteOr(input.positionalCount, 0)));
  const positionalCap = Math.max(1, Math.round(finiteOr(input.positionalLimit, 8)));
  const buffers = Math.max(0, Math.round(finiteOr(input.generatedBufferCount, 0)));
  const bufferCap = Math.max(1, Math.round(finiteOr(input.bufferLimit, 6)));
  const transients = Math.max(0, finiteOr(input.transientRate, 0));
  const transientCap = Math.max(1, finiteOr(input.transientLimit, 12));
  const ratio = Math.max(
    sources / sourceCap,
    positional / positionalCap,
    buffers / bufferCap,
    transients / transientCap,
  );
  const contextState = typeof input.contextState === 'string'
    ? input.contextState.slice(0, 40)
    : 'running';
  const state: AudioGraphHealthState =
    ratio >= 1.15 || contextState === 'suspended-error'
      ? STATES.CRITICAL
      : ratio >= 0.82
        ? STATES.PRESSURED
        : STATES.HEALTHY;
  const action: AudioGraphSafetyAction =
    state === STATES.CRITICAL
      ? ACTIONS.STOP_OPTIONAL
      : state === STATES.PRESSURED
        ? ACTIONS.VIRTUALIZE
        : ACTIONS.NONE;

  return Object.freeze({
    version: 1,
    state,
    ratio: Number(ratio.toFixed(4)),
    action,
    contextState,
    counts: Object.freeze({ sources, positional, buffers, transients }),
    limits: Object.freeze({ sourceCap, positionalCap, bufferCap, transientCap }),
  });
}

export function smoothGraphPressure(
  previous = 0,
  current = 0,
  deltaSeconds = 0.016,
  attack = 6,
  release = 2.5,
): number {
  const prev = clamp(finiteOr(previous, 0), 0, 2);
  const next = clamp(finiteOr(current, 0), 0, 2);
  const rate = next > prev ? attack : release;
  const t = clamp(Math.max(0, finiteOr(deltaSeconds, 0)) * rate, 0, 1);
  return prev + (next - prev) * t;
}

export function audioGraphSafetyConstants(): Readonly<{
  states: typeof STATES;
  actions: typeof ACTIONS;
  smoothing: AudioGraphSmoothingPolicy;
}> {
  return Object.freeze({
    states: STATES,
    actions: ACTIONS,
    smoothing: Object.freeze({ attack: 6, release: 2.5 }),
  });
}
