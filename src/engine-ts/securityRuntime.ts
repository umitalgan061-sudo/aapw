import type { Disposable, EngineResult } from './types.js';

export type SecurityDecision = 'allow' | 'deny' | 'sanitize';
export interface SecurityLimits { readonly maxString: number; readonly maxArray: number; readonly maxObjectKeys: number; readonly maxDepth: number; readonly maxPayloadBytes: number; readonly maxUrlLength: number; }
export interface SecurityReport { readonly decision: SecurityDecision; readonly code: string; readonly detail: string; readonly bytes: number; readonly depth: number; }
export interface CapabilitySnapshot { readonly webgpu: boolean; readonly webgl2: boolean; readonly workers: boolean; readonly serviceWorker: boolean; readonly indexedDb: boolean; readonly secureContext: boolean; readonly sharedArrayBuffer: boolean; readonly hardwareConcurrency: number; readonly memoryGb: number | null; readonly reducedMotion: boolean; readonly saveData: boolean; }

const DEFAULT_LIMITS: SecurityLimits = Object.freeze({ maxString: 8192, maxArray: 2048, maxObjectKeys: 512, maxDepth: 16, maxPayloadBytes: 512 * 1024, maxUrlLength: 4096 });
function bytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function inspect(value: unknown, depth: number, limits: SecurityLimits, seen: Set<object>): SecurityReport {
  const size = bytes(value);
  if (size > limits.maxPayloadBytes) return Object.freeze({ decision: 'deny', code: 'PAYLOAD_BYTES', detail: 'Payload exceeds byte limit.', bytes: size, depth });
  if (depth > limits.maxDepth) return Object.freeze({ decision: 'deny', code: 'PAYLOAD_DEPTH', detail: 'Payload exceeds nesting depth.', bytes: size, depth });
  if (typeof value === 'string' && value.length > limits.maxString) return Object.freeze({ decision: 'deny', code: 'STRING_LENGTH', detail: 'String exceeds maximum length.', bytes: size, depth });
  if (value && typeof value === 'object') {
    if (seen.has(value)) return Object.freeze({ decision: 'deny', code: 'CYCLE', detail: 'Cyclic payload is not accepted.', bytes: size, depth });
    seen.add(value);
    if (Array.isArray(value) && value.length > limits.maxArray) return Object.freeze({ decision: 'deny', code: 'ARRAY_LENGTH', detail: 'Array exceeds maximum length.', bytes: size, depth });
    if (!Array.isArray(value) && Object.keys(value).length > limits.maxObjectKeys) return Object.freeze({ decision: 'deny', code: 'OBJECT_KEYS', detail: 'Object exceeds maximum key count.', bytes: size, depth });
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const nested = inspect(child, depth + 1, limits, seen);
      if (nested.decision === 'deny') return nested;
    }
  }
  return Object.freeze({ decision: 'allow', code: 'OK', detail: 'Payload accepted.', bytes: size, depth });
}

export class SecurityRuntime implements Disposable {
  readonly limits: SecurityLimits;
  #disposed = false;
  #denied = 0;
  #accepted = 0;
  constructor(limits: Partial<SecurityLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }

  validate<T>(value: T): EngineResult<SecurityReport> {
    if (this.#disposed) return this.fail('SECURITY_DISPOSED');
    const report = inspect(value, 0, this.limits, new Set());
    report.decision === 'deny' ? this.#denied += 1 : this.#accepted += 1;
    return report.decision === 'deny' ? { ok: false, meta: { status: 'rejected', code: report.code } } : { ok: true, value: report };
  }

  checkUrl(url: string, context: 'asset' | 'network' = 'asset'): SecurityReport {
    const length = typeof url === 'string' ? url.length : Number.MAX_SAFE_INTEGER;
    if (length > this.limits.maxUrlLength) return Object.freeze({ decision: 'deny', code: 'URL_LENGTH', detail: 'URL exceeds maximum length.', bytes: length, depth: 0 });
    try {
      const parsed = new URL(url, typeof location !== 'undefined' ? location.href : 'https://aapw.invalid/');
      const protocolAllowed = parsed.protocol === 'https:' || parsed.protocol === 'http:' || (context === 'asset' && parsed.protocol === 'file:');
      if (!protocolAllowed) return Object.freeze({ decision: 'deny', code: 'URL_PROTOCOL', detail: 'URL protocol is not allowed.', bytes: length, depth: 0 });
      if (parsed.username || parsed.password) return Object.freeze({ decision: 'deny', code: 'URL_CREDENTIALS', detail: 'Embedded credentials are not allowed.', bytes: length, depth: 0 });
      return Object.freeze({ decision: 'allow', code: 'OK', detail: 'URL accepted.', bytes: length, depth: 0 });
    } catch { return Object.freeze({ decision: 'deny', code: 'URL_PARSE', detail: 'URL could not be parsed.', bytes: length, depth: 0 }); }
  }

  capabilities(): CapabilitySnapshot {
    return Object.freeze({
      webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      webgl2: typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('webgl2')),
      workers: typeof Worker !== 'undefined', serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      indexedDb: typeof indexedDB !== 'undefined', secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
      memoryGb: typeof navigator !== 'undefined' && 'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || null : null,
      reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: typeof navigator !== 'undefined' && 'connection' in navigator ? Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) : false,
    });
  }

  stats(): Readonly<{ accepted: number; denied: number }> { return Object.freeze({ accepted: this.#accepted, denied: this.#denied }); }
  dispose(): void { this.#disposed = true; }
  #fail<T>(code: string): EngineResult<T> { return { ok: false, meta: { status: 'rejected', code } }; }
}
