import { clamp, finite } from './math.ts';

export interface SecurityBoundaryConfig {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxDepth: number;
  readonly maxNumberAbs: number;
}

const DEFAULT_CONFIG: SecurityBoundaryConfig = Object.freeze({
  maxStringLength: 512,
  maxArrayLength: 128,
  maxObjectKeys: 64,
  maxDepth: 5,
  maxNumberAbs: 1e12,
});

export type SanitizationResult = Readonly<{
  accepted: boolean;
  value: unknown;
  violations: readonly string[];
}>;

export class SecurityBoundaryR37 {
  readonly config: SecurityBoundaryConfig;

  constructor(config: Partial<SecurityBoundaryConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      maxStringLength: Math.max(16, Math.trunc(finite(config.maxStringLength, DEFAULT_CONFIG.maxStringLength))),
      maxArrayLength: Math.max(1, Math.trunc(finite(config.maxArrayLength, DEFAULT_CONFIG.maxArrayLength))),
      maxObjectKeys: Math.max(1, Math.trunc(finite(config.maxObjectKeys, DEFAULT_CONFIG.maxObjectKeys))),
      maxDepth: Math.max(1, Math.trunc(finite(config.maxDepth, DEFAULT_CONFIG.maxDepth))),
      maxNumberAbs: Math.max(1, finite(config.maxNumberAbs, DEFAULT_CONFIG.maxNumberAbs)),
    });
  }

  sanitize(value: unknown): SanitizationResult {
    const violations: string[] = [];
    const sanitized = this.#visit(value, 0, violations, '$');
    return Object.freeze({ accepted: violations.length === 0, value: sanitized, violations: Object.freeze(violations) });
  }

  assert(value: unknown): unknown {
    const result = this.sanitize(value);
    if (!result.accepted) throw new TypeError('security boundary rejected payload: ' + result.violations.join(', '));
    return result.value;
  }

  isSafeId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(value);
  }

  clampNumber(value: unknown, min: number, max: number): number {
    return clamp(finite(value), finite(min), finite(max));
  }

  #visit(value: unknown, depth: number, violations: string[], path: string): unknown {
    if (depth > this.config.maxDepth) {
      violations.push(path + ':depth');
      return null;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.length > this.config.maxStringLength) violations.push(path + ':string-length');
      return value.slice(0, this.config.maxStringLength);
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > this.config.maxNumberAbs) {
        violations.push(path + ':number-range');
        return 0;
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > this.config.maxArrayLength) violations.push(path + ':array-length');
      return value.slice(0, this.config.maxArrayLength).map((item, index) => this.#visit(item, depth + 1, violations, path + '[' + index + ']'));
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > this.config.maxObjectKeys) violations.push(path + ':object-keys');
      const output: Record<string, unknown> = {};
      for (const [key, item] of entries.slice(0, this.config.maxObjectKeys)) {
        const safeKey = key.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 96);
        if (!safeKey) {
          violations.push(path + ':invalid-key');
          continue;
        }
        output[safeKey] = this.#visit(item, depth + 1, violations, path + '.' + safeKey);
      }
      return Object.freeze(output);
    }
    violations.push(path + ':unsupported-type');
    return null;
  }
}

export function sanitizeRuntimeText(value: unknown, maxLength = 256): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, Math.max(1, maxLength));
}
