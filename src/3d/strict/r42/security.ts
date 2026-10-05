/**
 * Hostile-input, size and rate controls for R42.
 * Production TypeScript owner. Security policy is deterministic and allocation-bounded.
 */

import type { RateLimitState } from './types.ts';
import { clamp, finite, safeInteger } from './types.ts';

export interface SecurityLimits {
  readonly maxStringLength: number;
  readonly maxObjectKeys: number;
  readonly maxArrayLength: number;
  readonly maxDepth: number;
  readonly maxPacketBytes: number;
  readonly maxCommandsPerWindow: number;
  readonly windowTicks: number;
}

export const DEFAULT_R42_SECURITY_LIMITS: SecurityLimits = Object.freeze({
  maxStringLength: 4096,
  maxObjectKeys: 512,
  maxArrayLength: 2048,
  maxDepth: 6,
  maxPacketBytes: 128 * 1024,
  maxCommandsPerWindow: 128,
  windowTicks: 60,
});

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly severity: 'warning' | 'critical';
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly estimatedBytes: number;
}

export class RuntimeSecurityR42 {
  readonly limits: SecurityLimits;
  readonly rateLimiter: RateLimiterR42;

  constructor(limits: Partial<SecurityLimits> = {}) {
    this.limits = Object.freeze({
      ...DEFAULT_R42_SECURITY_LIMITS,
      ...limits,
      maxStringLength: Math.max(16, Math.trunc(finite(limits.maxStringLength, DEFAULT_R42_SECURITY_LIMITS.maxStringLength))),
      maxObjectKeys: Math.max(1, Math.trunc(finite(limits.maxObjectKeys, DEFAULT_R42_SECURITY_LIMITS.maxObjectKeys))),
      maxArrayLength: Math.max(1, Math.trunc(finite(limits.maxArrayLength, DEFAULT_R42_SECURITY_LIMITS.maxArrayLength))),
      maxDepth: Math.max(1, Math.trunc(finite(limits.maxDepth, DEFAULT_R42_SECURITY_LIMITS.maxDepth))),
      maxPacketBytes: Math.max(1024, Math.trunc(finite(limits.maxPacketBytes, DEFAULT_R42_SECURITY_LIMITS.maxPacketBytes))),
      maxCommandsPerWindow: Math.max(1, Math.trunc(finite(limits.maxCommandsPerWindow, DEFAULT_R42_SECURITY_LIMITS.maxCommandsPerWindow))),
      windowTicks: Math.max(1, Math.trunc(finite(limits.windowTicks, DEFAULT_R42_SECURITY_LIMITS.windowTicks))),
    });
    this.rateLimiter = new RateLimiterR42(this.limits.maxCommandsPerWindow, this.limits.windowTicks);
  }

  validatePayload(value: unknown): ValidationReport {
    const issues: ValidationIssue[] = [];
    const estimatedBytes = inspect(value, issues, this.limits, 'payload', 0);
    const normalizedBytes = Math.max(0, estimatedBytes);
    if (normalizedBytes > this.limits.maxPacketBytes) {
      issues.push(issue('size', 'Payload exceeds configured byte budget.', 'critical', 'payload'));
    }
    return Object.freeze({
      ok: !issues.some(value => value.severity === 'critical'),
      issues: Object.freeze(issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))),
      estimatedBytes: normalizedBytes,
    });
  }

  sanitizeString(value: unknown): string {
    return String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[<>]/g, '')
      .slice(0, this.limits.maxStringLength);
  }

  sanitizeId(value: unknown, maxLength = 128): string {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[^a-zA-Z0-9._:-]/g, '')
      .slice(0, Math.max(1, maxLength));
  }

  safeNumber(value: unknown, min = -1_000_000_000, max = 1_000_000_000): number {
    return clamp(finite(value), min, max);
  }
}

export class RateLimiterR42 {
  readonly max: number;
  readonly windowTicks: number;
  #entries = new Map<string, RateLimitState>();

  constructor(max = 128, windowTicks = 60) {
    this.max = Math.max(1, Math.trunc(max));
    this.windowTicks = Math.max(1, Math.trunc(windowTicks));
  }

  allow(key: string, tick: number): boolean {
    const normalizedKey = key.slice(0, 128);
    const currentTick = Math.max(0, safeInteger(tick));
    const previous = this.#entries.get(normalizedKey);

    if (!previous || currentTick - previous.windowStartTick >= this.windowTicks) {
      this.#entries.set(normalizedKey, {
        key: normalizedKey,
        windowStartTick: currentTick,
        count: 1,
        max: this.max,
      });
      return true;
    }

    if (previous.count >= this.max) return false;

    this.#entries.set(normalizedKey, {
      ...previous,
      count: previous.count + 1,
    });
    return true;
  }

  snapshot(): readonly RateLimitState[] {
    return Object.freeze(
      [...this.#entries.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(value => Object.freeze({ ...value })),
    );
  }

  clear(): void {
    this.#entries.clear();
  }
}

function inspect(
  value: unknown,
  issues: ValidationIssue[],
  limits: SecurityLimits,
  path: string,
  depth: number,
): number {
  if (depth > limits.maxDepth) {
    issues.push(issue('depth', 'Payload nesting exceeds maximum depth.', 'critical', path));
    return 0;
  }

  if (value === null || value === undefined) return 4;

  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) issues.push(issue('string-length', 'String exceeds maximum length.', 'warning', path));
    return Math.min(value.length * 2 + 8, limits.maxPacketBytes + 1);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(issue('number', 'Numeric value is not finite.', 'critical', path));
    return 8;
  }

  if (typeof value === 'boolean') return 4;
  if (typeof value === 'bigint') return 16;
  if (typeof value === 'function' || typeof value === 'symbol') {
    issues.push(issue('type', 'Executable or symbol values are forbidden.', 'critical', path));
    return 0;
  }

  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) issues.push(issue('array-length', 'Array exceeds maximum length.', 'critical', path));
    return 16 + value.slice(0, limits.maxArrayLength).reduce(
      (sum, child, index) => sum + inspect(child, issues, limits, path + '[' + index + ']', depth + 1),
      0,
    );
  }

  const objectValue = value as Record<string, unknown>;
  const entries = Object.entries(objectValue);
  if (entries.length > limits.maxObjectKeys) issues.push(issue('object-keys', 'Object exceeds maximum key count.', 'critical', path));
  let bytes = 24;
  for (const [key, child] of entries.slice(0, limits.maxObjectKeys)) {
    if (key.length > 256) issues.push(issue('key-length', 'Object key exceeds maximum length.', 'warning', path + '.' + key.slice(0, 64)));
    bytes += key.length * 2 + inspect(child, issues, limits, path + '.' + key, depth + 1);
  }
  return bytes;
}

function issue(
  code: string,
  _message: string,
  severity: ValidationIssue['severity'],
  path: string,
): ValidationIssue {
  return Object.freeze({ code, path, severity });
}
