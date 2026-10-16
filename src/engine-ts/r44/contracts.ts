/**
 * R44 shared contracts.
 *
 * These types intentionally live beside, rather than replace, R43 contracts. They
 * define the stable boundary used by the assurance services and stay independent
 * from browser APIs so the same rules can be exercised in Node and the browser.
 */
export type R44Brand<T, Name extends string> = T & { readonly __brand: Name };
export type R44EntityId = R44Brand<string, "R44EntityId">;
export type R44EventId = R44Brand<string, "R44EventId">;
export type R44TaskId = R44Brand<string, "R44TaskId">;
export type R44IncidentId = R44Brand<string, "R44IncidentId">;
export type R44ResourceId = R44Brand<string, "R44ResourceId">;
export type R44SaveId = R44Brand<string, "R44SaveId">;
export type R44Tick = R44Brand<number, "R44Tick">;
export type R44Sequence = R44Brand<number, "R44Sequence">;
export type R44Fingerprint = R44Brand<string, "R44Fingerprint">;

export type R44JsonPrimitive = string | number | boolean | null;
export type R44JsonValue =
  | R44JsonPrimitive
  | readonly R44JsonValue[]
  | { readonly [key: string]: R44JsonValue };

export type R44Result<T, E = R44Failure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type R44RuntimePhase =
  | "created"
  | "starting"
  | "running"
  | "degraded"
  | "stopping"
  | "stopped"
  | "failed";

export type R44HealthGrade = "excellent" | "healthy" | "watch" | "degraded" | "critical";
export type R44PressureLevel = "nominal" | "elevated" | "constrained" | "emergency";
export type R44Severity = "info" | "warning" | "error" | "fatal";
export type R44TaskLane = "interactive" | "simulation" | "streaming" | "background";
export type R44TaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
export type R44CircuitState = "closed" | "open" | "half-open";

export interface R44Failure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, R44JsonValue>>;
}

export interface R44ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface R44Clock {
  nowTick(): number;
}

export interface R44Disposable {
  dispose(): void | Promise<void>;
}

export interface R44AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener?(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: "abort", listener: () => void): void;
}

export interface R44Capacity {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export const R44_DEFAULT_LIMITS = Object.freeze({
  idLength: 128,
  labelLength: 96,
  eventKindLength: 96,
  maxJsonDepth: 32,
  maxJsonNodes: 20_000,
  maxPayloadBytes: 256 * 1024,
  maxCollectionSize: 100_000,
  maxStringLength: 256 * 1024,
});

export class R44InvariantError extends Error {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, context: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "R44InvariantError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

export class R44BoundaryError extends Error {
  readonly code: string;
  readonly issues: readonly R44ValidationIssue[];

  constructor(code: string, message: string, issues: readonly R44ValidationIssue[] = []) {
    super(message);
    this.name = "R44BoundaryError";
    this.code = code;
    this.issues = Object.freeze([...issues]);
  }
}

export function r44AsEntityId(value: string): R44EntityId {
  return r44NormalizeId(value, "entity") as R44EntityId;
}

export function r44AsEventId(value: string): R44EventId {
  return r44NormalizeId(value, "event") as R44EventId;
}

export function r44AsTaskId(value: string): R44TaskId {
  return r44NormalizeId(value, "task") as R44TaskId;
}

export function r44AsIncidentId(value: string): R44IncidentId {
  return r44NormalizeId(value, "incident") as R44IncidentId;
}

export function r44AsResourceId(value: string): R44ResourceId {
  return r44NormalizeId(value, "resource") as R44ResourceId;
}

export function r44AsSaveId(value: string): R44SaveId {
  return r44NormalizeId(value, "save") as R44SaveId;
}

export function r44AsTick(value: number): R44Tick {
  return r44FiniteInteger(value, "tick", 0, Number.MAX_SAFE_INTEGER) as R44Tick;
}

export function r44AsSequence(value: number): R44Sequence {
  return r44FiniteInteger(value, "sequence", 0, Number.MAX_SAFE_INTEGER) as R44Sequence;
}

export function r44NormalizeId(value: string, label = "identifier", maxLength = R44_DEFAULT_LIMITS.idLength): string {
  if (typeof value !== "string") throw new R44BoundaryError("invalid-id", label + " must be a string");
  const normalized = value.trim();
  if (normalized.length === 0) throw new R44BoundaryError("empty-id", label + " must not be empty");
  if (normalized.length > maxLength) {
    throw new R44BoundaryError("long-id", label + " exceeds " + maxLength + " characters");
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new R44BoundaryError("control-char-id", label + " contains a control character");
  }
  return normalized;
}

export function r44NormalizeLabel(value: string, maxLength = R44_DEFAULT_LIMITS.labelLength): string {
  const normalized = r44NormalizeId(value, "label", maxLength);
  return normalized.replace(/\s+/gu, " ");
}

export function r44FiniteNumber(value: number, label: string, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number {
  if (!Number.isFinite(value)) throw new R44BoundaryError("non-finite", label + " must be finite");
  if (value < min || value > max) {
    throw new R44BoundaryError("out-of-range", label + " must be in [" + min + ", " + max + "]");
  }
  return value;
}

export function r44FiniteInteger(value: number, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  r44FiniteNumber(value, label, min, max);
  if (!Number.isInteger(value)) throw new R44BoundaryError("not-integer", label + " must be an integer");
  return value;
}

export function r44Clamp(value: number, min: number, max: number): number {
  r44FiniteNumber(value, "value");
  r44FiniteNumber(min, "min");
  r44FiniteNumber(max, "max");
  if (min > max) throw new R44InvariantError("invalid-range", "min cannot exceed max", { min, max });
  return Math.min(max, Math.max(min, value));
}

export function r44SafeRatio(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return fallback;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : fallback;
}

export function r44IsPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function r44AssertPlainRecord(value: unknown, label = "value"): asserts value is Record<string, unknown> {
  if (!r44IsPlainRecord(value)) {
    throw new R44BoundaryError("not-plain-record", label + " must be a plain object");
  }
}

export function r44FreezeJson<T extends R44JsonValue>(
  value: T,
  options: { maxDepth?: number; maxNodes?: number; maxStringLength?: number } = {},
): T {
  const maxDepth = options.maxDepth ?? R44_DEFAULT_LIMITS.maxJsonDepth;
  const maxNodes = options.maxNodes ?? R44_DEFAULT_LIMITS.maxJsonNodes;
  const maxStringLength = options.maxStringLength ?? R44_DEFAULT_LIMITS.maxStringLength;
  let nodes = 0;
  const seen = new WeakSet<object>();

  const visit = (item: unknown, depth: number, path: string): R44JsonValue => {
    nodes += 1;
    if (nodes > maxNodes) throw new R44BoundaryError("json-node-limit", "JSON node limit exceeded at " + path);
    if (depth > maxDepth) throw new R44BoundaryError("json-depth-limit", "JSON nesting limit exceeded at " + path);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      if (item.length > maxStringLength) throw new R44BoundaryError("json-string-limit", "String limit exceeded at " + path);
      return item;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new R44BoundaryError("json-number-invalid", "Non-finite number at " + path);
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item !== "object") {
      throw new R44BoundaryError("json-type-invalid", "Unsupported JSON value at " + path);
    }
    if (seen.has(item)) throw new R44BoundaryError("json-cycle", "Cyclic value at " + path);
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > R44_DEFAULT_LIMITS.maxCollectionSize) {
          throw new R44BoundaryError("json-array-limit", "Array limit exceeded at " + path);
        }
        const array = item.map((child, index) => visit(child, depth + 1, path + "[" + index + "]"));
        return Object.freeze(array);
      }
      if (!r44IsPlainRecord(item)) {
        throw new R44BoundaryError("json-record-invalid", "Expected a plain record at " + path);
      }
      const result: Record<string, R44JsonValue> = Object.create(null) as Record<string, R44JsonValue>;
      const keys = Object.keys(item).sort();
      if (keys.length > R44_DEFAULT_LIMITS.maxCollectionSize) {
        throw new R44BoundaryError("json-object-limit", "Object key limit exceeded at " + path);
      }
      for (const key of keys) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new R44BoundaryError("json-key-forbidden", "Unsafe key at " + path + "." + key);
        }
        result[key] = visit((item as Record<string, unknown>)[key], depth + 1, path + "." + key);
      }
      return Object.freeze(result);
    } finally {
      seen.delete(item);
    }
  };

  return visit(value, 0, "$") as T;
}

export function r44ToFailure(error: unknown, fallbackCode = "unexpected"): R44Failure {
  if (error instanceof R44BoundaryError) {
    return Object.freeze({ code: error.code, message: error.message, retryable: false });
  }
  if (error instanceof R44InvariantError) {
    return Object.freeze({ code: error.code, message: error.message, retryable: false });
  }
  if (error instanceof Error) {
    return Object.freeze({ code: fallbackCode, message: error.message.slice(0, 512), retryable: false });
  }
  return Object.freeze({ code: fallbackCode, message: "Unknown failure", retryable: false });
}

export function r44Ok<T>(value: T): R44Result<T> {
  return Object.freeze({ ok: true, value });
}

export function r44Err<T = never>(error: R44Failure): R44Result<T> {
  return Object.freeze({ ok: false, error });
}

export function r44Exhaustive(value: never, context = "switch"): never {
  throw new R44InvariantError("unhandled-variant", "Unhandled variant in " + context, { value });
}
