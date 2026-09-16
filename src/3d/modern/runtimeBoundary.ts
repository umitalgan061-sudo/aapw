import type { PlatformError, Result } from './types';
import { checksum, stableStringify } from './deterministic';

export interface BoundaryLimits {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxDepth: number;
  readonly maxPayloadBytes: number;
}

export interface BoundaryReport {
  readonly accepted: boolean;
  readonly bytes: number;
  readonly depth: number;
  readonly nodes: number;
  readonly digest: string;
}

const DEFAULT_LIMITS: BoundaryLimits = {
  maxStringLength: 64 * 1024,
  maxArrayLength: 50_000,
  maxObjectKeys: 10_000,
  maxDepth: 32,
  maxPayloadBytes: 16 * 1024 * 1024,
};

interface WalkStats { bytes: number; depth: number; nodes: number; }

function invalid(code: string, message: string): Result<never> {
  const error: PlatformError = { code, message, retryable: false };
  return { ok: false, error };
}

/** Shared hostile-input boundary for saves, worker messages and future network packets. */
export function validateRuntimeBoundary(value: unknown, limits: Partial<BoundaryLimits> = {}): Result<BoundaryReport> {
  const policy = { ...DEFAULT_LIMITS, ...limits };
  const seen = new WeakSet<object>();
  const stats: WalkStats = { bytes: 0, depth: 0, nodes: 0 };
  const walk = (current: unknown, depth: number): boolean => {
    stats.nodes += 1;
    stats.depth = Math.max(stats.depth, depth);
    if (stats.nodes > policy.maxObjectKeys * 4) return false;
    if (depth > policy.maxDepth) return false;
    if (typeof current === 'string') {
      stats.bytes += current.length * 2;
      return current.length <= policy.maxStringLength;
    }
    if (current === null || typeof current !== 'object') return true;
    if (seen.has(current)) return false;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > policy.maxArrayLength) return false;
      for (const item of current) if (!walk(item, depth + 1)) return false;
      return true;
    }
    const keys = Object.keys(current);
    if (keys.length > policy.maxObjectKeys) return false;
    for (const key of keys) {
      if (key.length > policy.maxStringLength) return false;
      if (!walk(key, depth + 1) || !walk((current as Record<string, unknown>)[key], depth + 1)) return false;
    }
    return true;
  };
  const valid = walk(value, 0);
  try {
    stats.bytes = Math.max(stats.bytes, new TextEncoder().encode(stableStringify(value)).byteLength);
  } catch {
    return invalid('BOUNDARY_SERIALIZE_FAILED', 'Payload cannot be deterministically serialized');
  }
  if (!valid) return invalid('BOUNDARY_STRUCTURE_INVALID', 'Payload violates runtime boundary limits');
  if (stats.bytes > policy.maxPayloadBytes) return invalid('BOUNDARY_PAYLOAD_TOO_LARGE', `Payload exceeds ${policy.maxPayloadBytes} bytes`);
  return { ok: true, value: { accepted: true, bytes: stats.bytes, depth: stats.depth, nodes: stats.nodes, digest: checksum(value) } };
}

export function guardRuntimeBoundary<T>(value: T, limits: Partial<BoundaryLimits> = {}): T {
  const result = validateRuntimeBoundary(value, limits);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return value;
}
