/**
 * Canonical, deterministic fingerprints for R44 ledgers and save envelopes.
 *
 * The hash is deliberately a non-cryptographic change detector. It is not used as
 * an authentication primitive. Any external persistence/network boundary that needs
 * adversarial integrity must use a cryptographic digest at its platform adapter.
 */
import {
  R44BoundaryError,
  R44_DEFAULT_LIMITS,
  type R44Fingerprint,
  type R44JsonValue,
  r44IsPlainRecord,
} from "./contracts.js";

export interface R44CanonicalOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxEncodedLength?: number;
}

export interface R44Digest {
  readonly algorithm: "fnv1a32x2";
  readonly fingerprint: R44Fingerprint;
  readonly byteLength: number;
  readonly nodeCount: number;
}

function r44Quote(value: string): string {
  return JSON.stringify(value);
}

/** Serialize supported JSON values using stable object-key ordering. */
export function r44CanonicalStringify(value: R44JsonValue, options: R44CanonicalOptions = {}): string {
  const maxDepth = options.maxDepth ?? R44_DEFAULT_LIMITS.maxJsonDepth;
  const maxNodes = options.maxNodes ?? R44_DEFAULT_LIMITS.maxJsonNodes;
  const maxLength = options.maxEncodedLength ?? R44_DEFAULT_LIMITS.maxPayloadBytes;
  let nodes = 0;
  const active = new WeakSet<object>();

  const write = (input: unknown, depth: number, path: string): string => {
    nodes += 1;
    if (nodes > maxNodes) throw new R44BoundaryError("canonical-node-limit", "Node limit exceeded at " + path);
    if (depth > maxDepth) throw new R44BoundaryError("canonical-depth-limit", "Depth limit exceeded at " + path);
    if (input === null) return "null";
    if (typeof input === "string") return r44Quote(input);
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new R44BoundaryError("canonical-number", "Invalid number at " + path);
      if (Object.is(input, -0)) return "0";
      return String(input);
    }
    if (typeof input !== "object") throw new R44BoundaryError("canonical-type", "Unsupported value at " + path);
    if (active.has(input)) throw new R44BoundaryError("canonical-cycle", "Cycle at " + path);
    active.add(input);
    let encoded: string;
    try {
      if (Array.isArray(input)) {
        encoded = "[" + input.map((child, index) => write(child, depth + 1, path + "[" + index + "]")).join(",") + "]";
      } else {
        if (!r44IsPlainRecord(input)) throw new R44BoundaryError("canonical-prototype", "Invalid object at " + path);
        const record = input as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const pairs: string[] = [];
        for (const key of keys) {
          if (key === "__proto__" || key === "prototype" || key === "constructor") {
            throw new R44BoundaryError("canonical-key", "Unsafe key at " + path + "." + key);
          }
          pairs.push(r44Quote(key) + ":" + write(record[key], depth + 1, path + "." + key));
        }
        encoded = "{" + pairs.join(",") + "}";
      }
    } finally {
      active.delete(input);
    }
    if (encoded.length > maxLength) {
      throw new R44BoundaryError("canonical-length", "Encoded value exceeds " + maxLength + " characters");
    }
    return encoded;
  };

  const encoded = write(value, 0, "$");
  if (encoded.length > maxLength) throw new R44BoundaryError("canonical-length", "Encoded value is too large");
  return encoded;
}

function r44FNV1a32(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Stable fingerprint for deduplication/checkpoint comparisons.
 * It is deterministic across JS engines for identical UTF-8 input.
 */
export function r44Fingerprint(value: R44JsonValue, options: R44CanonicalOptions = {}): R44Digest {
  const encoded = r44CanonicalStringify(value, options);
  const bytes = new TextEncoder().encode(encoded);
  const left = r44FNV1a32(bytes, 0x811c9dc5);
  const right = r44FNV1a32(bytes, 0x9e3779b9 ^ bytes.length);
  const hex = left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
  const nodeCount = r44CountNodes(value);
  return Object.freeze({
    algorithm: "fnv1a32x2",
    fingerprint: ("r44-" + hex) as R44Fingerprint,
    byteLength: bytes.byteLength,
    nodeCount,
  });
}

export function r44EqualJson(left: R44JsonValue, right: R44JsonValue): boolean {
  return r44CanonicalStringify(left) === r44CanonicalStringify(right);
}

export function r44CompareFingerprints(left: R44Fingerprint, right: R44Fingerprint): -1 | 0 | 1 {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function r44CountNodes(value: R44JsonValue): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    count += 1;
    if (current !== null && typeof current === "object") {
      if (Array.isArray(current)) {
        for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
      } else {
        const values = Object.values(current as Record<string, unknown>);
        for (let index = values.length - 1; index >= 0; index -= 1) stack.push(values[index]);
      }
    }
  }
  return count;
}

/** Clone and normalize input into a canonical immutable JSON tree. */
export function r44CanonicalClone<T extends R44JsonValue>(value: T): T {
  return JSON.parse(r44CanonicalStringify(value)) as T;
}

export function r44DigestText(value: string): R44Digest {
  const bytes = new TextEncoder().encode(value);
  const left = r44FNV1a32(bytes, 0x811c9dc5);
  const right = r44FNV1a32(bytes, 0x9e3779b9 ^ bytes.length);
  return Object.freeze({
    algorithm: "fnv1a32x2",
    fingerprint: ("r44-" + left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0")) as R44Fingerprint,
    byteLength: bytes.length,
    nodeCount: 1,
  });
}


/** Fingerprint raw bytes without converting them to text or expanding each byte to characters. */
export function r44FingerprintBytes(bytes: Uint8Array): R44Digest {
  const left = r44FNV1a32(bytes, 0x811c9dc5);
  const right = r44FNV1a32(bytes, 0x9e3779b9 ^ bytes.length);
  return Object.freeze({
    algorithm: "fnv1a32x2",
    fingerprint: ("r44-" + left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0")) as R44Fingerprint,
    byteLength: bytes.byteLength,
    nodeCount: 1,
  });
}
