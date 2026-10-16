export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type ServiceId = Brand<string, "ServiceId">;
export type CommandName = Brand<string, "CommandName">;
export type TaskId = Brand<string, "TaskId">;
export type RuntimeTick = Brand<number, "RuntimeTick">;

export type RuntimeFaultCode =
  | "INVALID_INPUT"
  | "CAPACITY_EXCEEDED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "CANCELLED"
  | "DEPENDENCY_FAILED"
  | "INTEGRITY_FAILURE"
  | "STORAGE_FAILURE"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface RuntimeFaultShape {
  readonly code: RuntimeFaultCode;
  readonly message: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export class RuntimeFault extends Error implements RuntimeFaultShape {
  readonly code: RuntimeFaultCode;
  readonly operation: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: RuntimeFaultCode,
    message: string,
    operation: string,
    options: {
      retryable?: boolean;
      details?: Readonly<Record<string, string | number | boolean | null>>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RuntimeFault";
    this.code = code;
    this.operation = operation;
    this.retryable = options.retryable ?? false;
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }

  toJSON(): RuntimeFaultShape {
    return {
      code: this.code,
      message: this.message,
      operation: this.operation,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export type Outcome<T, E = RuntimeFault> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function succeed<T>(value: T): Outcome<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Outcome<never, E> {
  return { ok: false, error };
}

export function serviceId(value: string): ServiceId {
  return normalizeIdentifier(value, "serviceId") as ServiceId;
}

export function commandName(value: string): CommandName {
  return normalizeIdentifier(value, "commandName") as CommandName;
}

export function taskId(value: string): TaskId {
  return normalizeIdentifier(value, "taskId") as TaskId;
}

export function normalizeIdentifier(value: string, operation = "identifier"): string {
  if (typeof value !== "string") {
    throw new RuntimeFault("INVALID_INPUT", "Identifier must be a string", operation);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(normalized)
  ) {
    throw new RuntimeFault("INVALID_INPUT", "Identifier has an invalid shape", operation, {
      details: { length: normalized.length },
    });
  }
  return normalized;
}

export function finiteNumber(
  value: unknown,
  operation: string,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new RuntimeFault("INVALID_INPUT", "Number is outside the accepted range", operation, {
      details: { min: Number.isFinite(min) ? min : "unbounded", max: Number.isFinite(max) ? max : "unbounded" },
    });
  }
  return value;
}

export function integer(
  value: unknown,
  operation: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const result = finiteNumber(value, operation, min, max);
  if (!Number.isInteger(result)) {
    throw new RuntimeFault("INVALID_INPUT", "Value must be an integer", operation);
  }
  return result;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RuntimeFault("INVALID_INPUT", "Clamp arguments are invalid", "clamp");
  }
  return Math.min(max, Math.max(min, value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeForSerialization(value: unknown, seen: Set<object>, depth: number): unknown {
  if (depth > 64) {
    throw new RuntimeFault("INVALID_INPUT", "Payload nesting exceeds the supported depth", "stableSerialize");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RuntimeFault("INVALID_INPUT", "Non-finite values cannot be serialized", "stableSerialize");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new RuntimeFault("INVALID_INPUT", "Payload contains an unsupported value", "stableSerialize", {
      details: { type: typeof value },
    });
  }
  if (seen.has(value)) {
    throw new RuntimeFault("INVALID_INPUT", "Payload contains a circular reference", "stableSerialize");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeForSerialization(entry, seen, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RuntimeFault("INVALID_INPUT", "Only plain records can cross the runtime boundary", "stableSerialize");
    }
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw new RuntimeFault("INVALID_INPUT", "Undefined values are not permitted in payloads", "stableSerialize", {
          details: { key },
        });
      }
      normalized[key] = normalizeForSerialization(record[key], seen, depth + 1);
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForSerialization(value, new Set<object>(), 0));
}

export function stableFingerprint(value: unknown): string {
  const input = stableSerialize(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + index), 0x85ebca6b);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export function cloneCanonical<T>(value: T): T {
  return JSON.parse(stableSerialize(value)) as T;
}

export function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (typeof value !== "object" || value === null) return value as Readonly<T>;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value as Readonly<T>;
  seen.add(objectValue);
  for (const child of Object.values(objectValue)) deepFreeze(child, seen);
  return Object.freeze(value) as Readonly<T>;
}

export class MonotonicSequence {
  #value: number;

  constructor(initial = 0) {
    this.#value = integer(initial, "sequence.initial", 0, Number.MAX_SAFE_INTEGER - 1);
  }

  next(): number {
    if (this.#value >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Sequence exhausted", "sequence.next");
    }
    this.#value += 1;
    return this.#value;
  }

  current(): number {
    return this.#value;
  }
}

export interface BoundedRingSnapshot<T> {
  readonly capacity: number;
  readonly size: number;
  readonly dropped: number;
  readonly values: readonly T[];
}

export class BoundedRing<T> {
  readonly capacity: number;
  #values: T[] = [];
  #dropped = 0;

  constructor(capacity: number) {
    this.capacity = integer(capacity, "ring.capacity", 1, 1_000_000);
  }

  push(value: T): void {
    if (this.#values.length === this.capacity) {
      this.#values.shift();
      this.#dropped += 1;
    }
    this.#values.push(value);
  }

  snapshot(): BoundedRingSnapshot<T> {
    return Object.freeze({
      capacity: this.capacity,
      size: this.#values.length,
      dropped: this.#dropped,
      values: Object.freeze([...this.#values]),
    });
  }

  drain(maxItems = this.capacity): T[] {
    const count = integer(maxItems, "ring.drain", 0, this.capacity);
    return this.#values.splice(0, count);
  }

  clear(): void {
    this.#values = [];
  }

  get size(): number {
    return this.#values.length;
  }

  get dropped(): number {
    return this.#dropped;
  }
}

export function normalizeError(error: unknown, operation: string): RuntimeFault {
  if (error instanceof RuntimeFault) return error;
  if (error instanceof Error) {
    return new RuntimeFault("INTERNAL", error.message || "Unknown error", operation, { cause: error });
  }
  return new RuntimeFault("INTERNAL", "Unknown non-error exception", operation, {
    details: { type: typeof error },
  });
}
