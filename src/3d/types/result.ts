export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Maybe<T> = T | undefined;

export interface Failure {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly recoverable: boolean;
  readonly timestamp: number;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export function mapResult<T, U, E>(result: Result<T, E>, mapper: (value: T) => U): Result<U, E> {
  return result.ok ? ok(mapper(result.value)) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, mapper: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(mapper(result.error));
}

export function andThen<T, U, E>(result: Result<T, E>, next: (value: T) => Result<U, E>): Result<U, E> {
  return result.ok ? next(result.value) : result;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`Result error: ${String(result.error)}`);
  return result.value;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function isResult<T, E>(value: unknown): value is Result<T, E> {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean';
}

export function normalizeFailure(error: unknown, context: Failure['context'] = {}): Failure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: error instanceof DOMException ? error.name : 'RUNTIME_FAILURE',
    message,
    cause: error,
    recoverable: true,
    timestamp: Date.now(),
    context,
  };
}

export async function settle<T>(operation: Promise<T>): Promise<Result<T, Failure>> {
  try {
    return ok(await operation);
  } catch (error) {
    return err(normalizeFailure(error));
  }
}

export function assertOk<T, E>(result: Result<T, E>, label = 'operation'): asserts result is Ok<T> {
  if (!result.ok) throw new Error(`${label} failed: ${String(result.error)}`);
}
