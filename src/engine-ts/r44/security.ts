import { clamp, err, normalizeIdentifier, ok, stableStringify, type JsonValue, type Result } from "./contracts.ts";

export interface BoundaryPolicy {
  readonly maxPayloadBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
}

export type DataSchema =
  | { readonly type: "string"; readonly minLength?: number; readonly maxLength?: number; readonly pattern?: RegExp; readonly normalize?: "trim" | "id" }
  | { readonly type: "number"; readonly min?: number; readonly max?: number; readonly integer?: boolean }
  | { readonly type: "boolean" }
  | { readonly type: "null" }
  | { readonly type: "enum"; readonly values: readonly (string | number | boolean | null)[] }
  | { readonly type: "array"; readonly items: DataSchema; readonly minItems?: number; readonly maxItems?: number }
  | { readonly type: "object"; readonly fields: Readonly<Record<string, DataSchema>>; readonly required?: readonly string[]; readonly additionalProperties?: boolean };

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationReport<T> {
  readonly value: T;
  readonly issues: readonly ValidationIssue[];
  readonly nodesVisited: number;
  readonly encodedBytes: number;
}

const DEFAULT_BOUNDARY_POLICY: BoundaryPolicy = Object.freeze({
  maxPayloadBytes: 128 * 1024,
  maxDepth: 32,
  maxNodes: 20_000,
  maxArrayLength: 4096,
  maxObjectKeys: 1024,
  maxStringLength: 16_384,
});

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Schema validator that clones values into JSON-safe data. Accessors, exotic
 * prototypes, cycles, non-finite numbers, and prototype-manipulation keys are
 * rejected at the boundary, before business logic sees the payload.
 */
export class BoundaryValidator {
  readonly policy: BoundaryPolicy;

  constructor(policy: Partial<BoundaryPolicy> = {}) {
    this.policy = Object.freeze({
      maxPayloadBytes: Math.max(256, Math.trunc(policy.maxPayloadBytes ?? DEFAULT_BOUNDARY_POLICY.maxPayloadBytes)),
      maxDepth: Math.max(1, Math.trunc(policy.maxDepth ?? DEFAULT_BOUNDARY_POLICY.maxDepth)),
      maxNodes: Math.max(1, Math.trunc(policy.maxNodes ?? DEFAULT_BOUNDARY_POLICY.maxNodes)),
      maxArrayLength: Math.max(1, Math.trunc(policy.maxArrayLength ?? DEFAULT_BOUNDARY_POLICY.maxArrayLength)),
      maxObjectKeys: Math.max(1, Math.trunc(policy.maxObjectKeys ?? DEFAULT_BOUNDARY_POLICY.maxObjectKeys)),
      maxStringLength: Math.max(1, Math.trunc(policy.maxStringLength ?? DEFAULT_BOUNDARY_POLICY.maxStringLength)),
    });
  }

  validate<T = JsonValue>(input: unknown, schema: DataSchema): Result<ValidationReport<T>> {
    const issues: ValidationIssue[] = [];
    let nodesVisited = 0;
    const active = new WeakSet<object>();

    const reject = (path: string, code: string, message: string): undefined => {
      issues.push(Object.freeze({ path, code, message }));
      return undefined;
    };

    const safeClone = (value: unknown, path: string, depth: number): JsonValue | undefined => {
      nodesVisited += 1;
      if (nodesVisited > this.policy.maxNodes) return reject(path, "NODE_LIMIT", "Payload has too many values.");
      if (depth > this.policy.maxDepth) return reject(path, "DEPTH_LIMIT", "Payload is nested too deeply.");
      if (value === null || typeof value === "boolean") return value;
      if (typeof value === "string") {
        if (value.length > this.policy.maxStringLength) return reject(path, "STRING_LIMIT", "String is too long.");
        return value.normalize("NFKC");
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return reject(path, "NUMBER_INVALID", "Number must be finite.");
        return Object.is(value, -0) ? 0 : value;
      }
      if (typeof value !== "object") return reject(path, "TYPE_INVALID", "Value is not JSON-safe.");
      const object = value as object;
      if (active.has(object)) return reject(path, "CYCLE", "Cyclic payload is not allowed.");
      active.add(object);
      try {
        if (Array.isArray(value)) {
          if (value.length > this.policy.maxArrayLength) return reject(path, "ARRAY_LIMIT", "Array has too many entries.");
          const out: JsonValue[] = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!(index in value)) return reject(path + "[" + index + "]", "ARRAY_HOLE", "Sparse arrays are not accepted.");
            const item = safeClone(value[index], path + "[" + index + "]", depth + 1);
            if (item === undefined) return undefined;
            out.push(item);
          }
          return Object.freeze(out);
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return reject(path, "OBJECT_PROTOTYPE", "Only plain objects are accepted.");
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Object.keys(descriptors);
        if (keys.length > this.policy.maxObjectKeys) return reject(path, "KEY_LIMIT", "Object has too many properties.");
        const out: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
        for (const key of keys.sort()) {
          if (DANGEROUS_KEYS.has(key)) return reject(path + "." + key, "DANGEROUS_KEY", "Unsafe property name.");
          const descriptor = descriptors[key];
          if (!descriptor || !("value" in descriptor)) return reject(path + "." + key, "ACCESSOR", "Accessor properties are not accepted.");
          const item = safeClone(descriptor.value, path + "." + key, depth + 1);
          if (item === undefined) return undefined;
          out[key] = item;
        }
        return Object.freeze(out);
      } finally {
        active.delete(object);
      }
    };

    const cloned = safeClone(input, "$", 0);
    if (cloned === undefined) return err("BOUNDARY_PAYLOAD_INVALID", issues[0]?.message ?? "Payload is invalid.", false, { issueCount: issues.length });
    let encodedBytes: number;
    try {
      encodedBytes = new TextEncoder().encode(stableStringify(cloned, this.policy.maxDepth + 2)).byteLength;
    } catch (cause) {
      return err("BOUNDARY_SERIALIZATION", cause instanceof Error ? cause.message : String(cause));
    }
    if (encodedBytes > this.policy.maxPayloadBytes) {
      return err("BOUNDARY_SIZE_LIMIT", "Payload is larger than the configured byte budget.", false, { bytes: encodedBytes, limit: this.policy.maxPayloadBytes });
    }

    const parsed = this.#applySchema(cloned, schema, "$", issues);
    if (parsed === undefined || issues.length > 0) {
      return err("BOUNDARY_SCHEMA_INVALID", "Payload does not satisfy the declared schema.", false, { issueCount: issues.length });
    }
    return ok(Object.freeze({
      value: parsed as T,
      issues: Object.freeze(issues),
      nodesVisited,
      encodedBytes,
    }));
  }

  #applySchema(value: JsonValue, schema: DataSchema, path: string, issues: ValidationIssue[]): JsonValue | undefined {
    const issue = (code: string, message: string): undefined => {
      issues.push(Object.freeze({ path, code, message }));
      return undefined;
    };

    if (schema.type === "enum") {
      if (!schema.values.some((entry) => Object.is(entry, value))) return issue("ENUM", "Value is not in the allowed set.");
      return value;
    }
    if (schema.type === "null") return value === null ? null : issue("EXPECTED_NULL", "Value must be null.");
    if (schema.type === "boolean") return typeof value === "boolean" ? value : issue("EXPECTED_BOOLEAN", "Value must be boolean.");
    if (schema.type === "number") {
      if (typeof value !== "number") return issue("EXPECTED_NUMBER", "Value must be numeric.");
      if (schema.integer && !Number.isInteger(value)) return issue("EXPECTED_INTEGER", "Value must be an integer.");
      if (schema.min !== undefined && value < schema.min) return issue("NUMBER_MIN", "Value is below the allowed minimum.");
      if (schema.max !== undefined && value > schema.max) return issue("NUMBER_MAX", "Value is above the allowed maximum.");
      return value;
    }
    if (schema.type === "string") {
      if (typeof value !== "string") return issue("EXPECTED_STRING", "Value must be a string.");
      const normalized = schema.normalize === "trim" ? value.trim()
        : schema.normalize === "id" ? normalizeIdentifier(value, schema.maxLength ?? 96)
        : value;
      if (schema.minLength !== undefined && normalized.length < schema.minLength) return issue("STRING_MIN", "String is shorter than required.");
      if (schema.maxLength !== undefined && normalized.length > schema.maxLength) return issue("STRING_MAX", "String is longer than allowed.");
      if (schema.pattern && !schema.pattern.test(normalized)) return issue("STRING_PATTERN", "String does not match the required format.");
      return normalized;
    }
    if (schema.type === "array") {
      if (!Array.isArray(value)) return issue("EXPECTED_ARRAY", "Value must be an array.");
      if (schema.minItems !== undefined && value.length < schema.minItems) return issue("ARRAY_MIN", "Array has too few items.");
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return issue("ARRAY_MAX", "Array has too many items.");
      const items: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const parsed = this.#applySchema(value[index] as JsonValue, schema.items, path + "[" + index + "]", issues);
        if (parsed === undefined) return undefined;
        items.push(parsed);
      }
      return Object.freeze(items);
    }
    if (schema.type === "object") {
      if (value === null || Array.isArray(value) || typeof value !== "object") return issue("EXPECTED_OBJECT", "Value must be an object.");
      const source = value as Readonly<Record<string, JsonValue>>;
      const required = schema.required ?? [];
      for (const key of required) {
        if (!(key in source)) {
          issues.push(Object.freeze({ path: path + "." + key, code: "REQUIRED", message: "Required property is missing." }));
        }
      }
      const out: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const [key, item] of Object.entries(source)) {
        const fieldSchema = schema.fields[key];
        if (!fieldSchema) {
          if (schema.additionalProperties === false) {
            issues.push(Object.freeze({ path: path + "." + key, code: "ADDITIONAL_PROPERTY", message: "Property is not declared in the schema." }));
            continue;
          }
          out[key] = item;
          continue;
        }
        const parsed = this.#applySchema(item, fieldSchema, path + "." + key, issues);
        if (parsed !== undefined) out[key] = parsed;
      }
      if (issues.length > 0) return undefined;
      return Object.freeze(out);
    }
    return issue("SCHEMA_UNKNOWN", "Unknown schema type.");
  }
}

export interface LimiterPolicy {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  readonly maxEventsPerKey: number;
}
export interface LimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
  readonly key: string;
}

/** Bounded sliding-window limiter keyed by a caller-defined scope. */
export class SlidingWindowLimiter {
  readonly policy: LimiterPolicy;
  #events = new Map<string, number[]>();
  #lastSeen = new Map<string, number>();

  constructor(policy: Partial<LimiterPolicy> = {}) {
    this.policy = Object.freeze({
      limit: Math.max(1, Math.trunc(policy.limit ?? 120)),
      windowMs: Math.max(1, Math.trunc(policy.windowMs ?? 1000)),
      maxKeys: Math.max(8, Math.trunc(policy.maxKeys ?? 4096)),
      maxEventsPerKey: Math.max(1, Math.trunc(policy.maxEventsPerKey ?? policy.limit ?? 120)),
    });
  }

  consume(keyValue: unknown, nowMs: number, cost = 1): LimitDecision {
    const key = normalizeIdentifier(keyValue, 160) || "anonymous";
    const now = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
    const safeCost = clamp(Math.trunc(cost), 0, this.policy.limit + 1);
    this.#pruneKey(key, now);
    let events = this.#events.get(key);
    if (!events) {
      this.#ensureCapacity();
      events = [];
      this.#events.set(key, events);
    }
    this.#lastSeen.set(key, now);
    const allowed = events.length + safeCost <= this.policy.limit;
    if (allowed) {
      for (let index = 0; index < safeCost; index += 1) events.push(now);
      while (events.length > this.policy.maxEventsPerKey) events.shift();
      return Object.freeze({ allowed: true, remaining: Math.max(0, this.policy.limit - events.length), retryAfterMs: 0, key });
    }
    const oldest = events[0] ?? now;
    return Object.freeze({
      allowed: false,
      remaining: Math.max(0, this.policy.limit - events.length),
      retryAfterMs: Math.max(0, oldest + this.policy.windowMs - now),
      key,
    });
  }

  prune(nowMs: number): number {
    const now = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
    let removed = 0;
    for (const key of [...this.#events.keys()]) {
      this.#pruneKey(key, now);
      if ((this.#events.get(key)?.length ?? 0) === 0 && now - (this.#lastSeen.get(key) ?? 0) > this.policy.windowMs * 4) {
        this.#events.delete(key);
        this.#lastSeen.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  keyCount(): number {
    return this.#events.size;
  }

  reset(keyValue?: unknown): void {
    if (keyValue === undefined) {
      this.#events.clear();
      this.#lastSeen.clear();
      return;
    }
    const key = normalizeIdentifier(keyValue, 160) || "anonymous";
    this.#events.delete(key);
    this.#lastSeen.delete(key);
  }

  #pruneKey(key: string, now: number): void {
    const events = this.#events.get(key);
    if (!events) return;
    const cutoff = now - this.policy.windowMs;
    while (events.length > 0 && (events[0] ?? now) <= cutoff) events.shift();
  }

  #ensureCapacity(): void {
    if (this.#events.size < this.policy.maxKeys) return;
    let oldestKey: string | undefined;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, time] of this.#lastSeen) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.#events.delete(oldestKey);
      this.#lastSeen.delete(oldestKey);
    }
  }
}

export interface CapabilityDescriptor {
  readonly scope: string;
  readonly permissions: readonly string[];
  readonly expiresAtMs: number;
  readonly issuedAtMs: number;
  readonly label: string;
}
export interface CapabilityToken extends CapabilityDescriptor {
  readonly id: string;
}

/**
 * In-memory capability authority. Only object identities issued by this
 * instance are accepted, so callers cannot manufacture a valid token by
 * guessing serialized fields. Persisted sessions must request fresh grants.
 */
export class CapabilityAuthority {
  #issued = 0;
  #tokens = new WeakMap<object, CapabilityDescriptor>();
  #revoked = new WeakSet<object>();

  issue(descriptor: CapabilityDescriptor): CapabilityToken {
    const now = Math.max(0, Number.isFinite(descriptor.issuedAtMs) ? descriptor.issuedAtMs : 0);
    const normalized: CapabilityDescriptor = Object.freeze({
      scope: normalizeIdentifier(descriptor.scope, 160),
      permissions: Object.freeze([...new Set(descriptor.permissions.map((permission) => normalizeIdentifier(permission, 96)).filter(Boolean))].sort()),
      issuedAtMs: now,
      expiresAtMs: Math.max(now, Number.isFinite(descriptor.expiresAtMs) ? descriptor.expiresAtMs : now),
      label: String(descriptor.label ?? "").normalize("NFKC").slice(0, 96),
    });
    const token = Object.freeze({ ...normalized, id: "cap:" + this.#issued++ });
    this.#tokens.set(token, normalized);
    return token;
  }

  authorize(token: CapabilityToken | null | undefined, scope: string, permission: string, nowMs: number): boolean {
    if (!token || typeof token !== "object" || this.#revoked.has(token)) return false;
    const descriptor = this.#tokens.get(token);
    if (!descriptor) return false;
    const now = Number.isFinite(nowMs) ? nowMs : Number.POSITIVE_INFINITY;
    if (now < descriptor.issuedAtMs || now > descriptor.expiresAtMs) return false;
    if (descriptor.scope !== normalizeIdentifier(scope, 160)) return false;
    return descriptor.permissions.includes(normalizeIdentifier(permission, 96));
  }

  revoke(token: CapabilityToken | null | undefined): boolean {
    if (!token || typeof token !== "object" || !this.#tokens.has(token)) return false;
    this.#revoked.add(token);
    return true;
  }

  revokeAll(): void {
    this.#tokens = new WeakMap<object, CapabilityDescriptor>();
    this.#revoked = new WeakSet<object>();
    this.#issued += 1;
  }

  hasIssued(token: object): boolean {
    return this.#tokens.has(token) && !this.#revoked.has(token);
  }
}

export interface ReplayGuardPolicy {
  readonly capacity: number;
  readonly ttlMs: number;
}

export class ReplayGuard {
  readonly policy: ReplayGuardPolicy;
  #seen = new Map<string, number>();

  constructor(policy: Partial<ReplayGuardPolicy> = {}) {
    this.policy = Object.freeze({
      capacity: Math.max(32, Math.trunc(policy.capacity ?? 8192)),
      ttlMs: Math.max(1, Math.trunc(policy.ttlMs ?? 60_000)),
    });
  }

  accept(nonceValue: unknown, nowMs: number): Result<true> {
    const nonce = normalizeIdentifier(nonceValue, 160);
    if (nonce.length < 8) return err("REPLAY_NONCE_INVALID", "Nonce must have at least eight safe characters.");
    const now = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
    this.prune(now);
    if (this.#seen.has(nonce)) return err("REPLAY_NONCE_USED", "Nonce has already been accepted.");
    if (this.#seen.size >= this.policy.capacity) {
      const oldest = [...this.#seen.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) this.#seen.delete(oldest[0]);
    }
    this.#seen.set(nonce, now);
    return ok(true);
  }

  prune(nowMs: number): number {
    const cutoff = Math.max(0, nowMs) - this.policy.ttlMs;
    let removed = 0;
    for (const [nonce, seenAt] of this.#seen) {
      if (seenAt < cutoff) {
        this.#seen.delete(nonce);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#seen.size;
  }

  clear(): void {
    this.#seen.clear();
  }
}
