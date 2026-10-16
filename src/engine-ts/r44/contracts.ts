/**
 * R44 shared contracts.
 *
 * R44 adds a governed production layer around the R43 engine. Values crossing
 * subsystem boundaries are deliberately small, explicit, and serializable.
 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type FrameId = Brand<number, "FrameId">;
export type TickId = Brand<number, "TickId">;
export type SequenceId = Brand<number, "SequenceId">;
export type RuntimeServiceId = Brand<string, "RuntimeServiceId">;
export type AssetKey = Brand<string, "AssetKey">;
export type Milliseconds = Brand<number, "Milliseconds">;

export type Result<T, E = R44Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface R44Error {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export type Priority = 0 | 1 | 2 | 3 | 4;
export type LaneId = string;
export type Severity = "trace" | "info" | "warning" | "error" | "fatal";
export type LifecycleState = "registered" | "starting" | "ready" | "degraded" | "stopping" | "stopped" | "failed";
export type CircuitState = "closed" | "open" | "half-open";
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface MonotonicClock {
  now(): number;
}

export const systemMonotonicClock: MonotonicClock = Object.freeze({
  now: () => typeof performance !== "undefined" ? performance.now() : 0,
});

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: string,
  message: string,
  retryable = false,
  detail?: Readonly<Record<string, string | number | boolean | null>>,
): Result<T> {
  const error: R44Error = detail
    ? { code, message, retryable, detail: Object.freeze({ ...detail }) }
    : { code, message, retryable };
  return { ok: false, error };
}

export function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function integer(value: unknown, fallback = 0): number {
  return Math.trunc(finite(value, fallback));
}

export function clamp(value: number, min: number, max: number): number {
  const candidate = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, candidate));
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

export function assertNonEmpty(value: string, label: string, maxLength = 160): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(label + " must not be empty");
  if (normalized.length > maxLength) throw new Error(label + " exceeds " + maxLength + " characters");
  return normalized;
}

export function normalizeIdentifier(value: unknown, maxLength = 96): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._:-]/gu, "")
    .slice(0, clampInt(maxLength, 1, 512));
}

/** Stable serialization rejects cycles and non-JSON values instead of silently dropping them. */
export function stableStringify(value: unknown, maxDepth = 64): string {
  const active = new WeakSet<object>();

  const visit = (input: unknown, depth: number): string => {
    if (depth > maxDepth) throw new Error("maximum serialization depth exceeded");
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(input);
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("non-finite number is not serializable");
      return Object.is(input, -0) ? "0" : String(input);
    }
    if (typeof input !== "object") throw new Error("unsupported serializable value: " + typeof input);
    const object = input as object;
    if (active.has(object)) throw new Error("cyclic structure is not serializable");
    active.add(object);
    try {
      if (Array.isArray(input)) {
        const parts: string[] = [];
        for (const entry of input) parts.push(visit(entry, depth + 1));
        return "[" + parts.join(",") + "]";
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("only plain records may be serialized");
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = Object.keys(descriptors).sort();
      const parts: string[] = [];
      for (const key of keys) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new Error("unsafe property name: " + key);
        }
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor)) throw new Error("accessor properties are not serializable");
        parts.push(JSON.stringify(key) + ":" + visit(descriptor.value, depth + 1));
      }
      return "{" + parts.join(",") + "}";
    } finally {
      active.delete(object);
    }
  };

  return visit(value, 0);
}

/** FNV-1a is used for reproducible corruption detection, not cryptographic signatures. */
export function stableDigest(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function freezeRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
  return Object.freeze({ ...value });
}

export function normalizeTime(value: unknown, fallback = 0): number {
  return Math.max(0, finite(value, fallback));
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
