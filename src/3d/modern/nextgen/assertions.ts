import { RuntimeFault, Tick, Vec3, isFiniteVec3 } from './types.ts';

export class RuntimeInvariantError extends Error {
  readonly code: string;
  readonly tick: Tick;

  constructor(code: string, message: string, tick: Tick) {
    super(message);
    this.name = 'RuntimeInvariantError';
    this.code = code;
    this.tick = tick;
  }
}

export function invariant(condition: unknown, code: string, message: string, tick: Tick): asserts condition {
  if (!condition) throw new RuntimeInvariantError(code, message, tick);
}

export function finite(value: number, label: string, tick: Tick): number {
  invariant(Number.isFinite(value), 'NON_FINITE_NUMBER', `${label} must be finite`, tick);
  return value;
}

export function nonNegative(value: number, label: string, tick: Tick): number {
  finite(value, label, tick);
  invariant(value >= 0, 'NEGATIVE_VALUE', `${label} must be non-negative`, tick);
  return value;
}

export function finiteVector(value: Vec3, label: string, tick: Tick): Vec3 {
  invariant(isFiniteVec3(value), 'NON_FINITE_VECTOR', `${label} must contain finite coordinates`, tick);
  return value;
}

export function monotonic(previous: Tick, next: Tick, label: string): Tick {
  if (next < previous) throw new RuntimeInvariantError('TICK_REGRESSION', `${label} regressed from ${previous} to ${next}`, next);
  return next;
}

export function toFault(error: unknown, tick: Tick, source = 'runtime'): RuntimeFault {
  if (error instanceof RuntimeInvariantError) {
    return { code: error.code, message: error.message, tick, recoverable: false, source };
  }
  return { code: 'RUNTIME_ERROR', message: error instanceof Error ? error.message : String(error), tick, recoverable: true, source };
}

export function assertArrayCapacity<T>(values: readonly T[], max: number, label: string, tick: Tick): void {
  invariant(values.length <= max, 'CAPACITY_EXCEEDED', `${label} exceeds capacity ${max}`, tick);
}

export function assertId(value: string, label: string, tick: Tick): string {
  invariant(/^[a-zA-Z0-9._:-]{1,128}$/.test(value), 'INVALID_ID', `${label} contains unsupported characters`, tick);
  return value;
}
