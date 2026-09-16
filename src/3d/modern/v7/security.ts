import { clamp, digest, integer, type Disposable, type V7Result } from './primitives.js';

export type UrlKind = 'asset' | 'network' | 'worker';
export interface SecurityLimits { readonly maxPayloadBytes: number; readonly maxStringLength: number; readonly maxArrayLength: number; readonly maxObjectKeys: number; readonly maxDepth: number; }
export interface UrlCheck { readonly accepted: boolean; readonly normalized: string | null; readonly reason: string; }
export interface RateLimitPolicy { readonly capacity: number; readonly refillPerSecond: number; }
export interface SecurityCapabilities { readonly webgpu: boolean; readonly webgl2: boolean; readonly workers: boolean; readonly offscreenCanvas: boolean; readonly indexedDb: boolean; readonly serviceWorker: boolean; readonly sharedArrayBuffer: boolean; readonly hardwareConcurrency: number; readonly deviceMemoryGb: number | null; readonly reducedMotion: boolean; readonly saveData: boolean; }
export interface SecurityReport { readonly payloadAccepted: boolean; readonly payloadBytes: number; readonly rateAccepted: boolean; readonly urlAccepted: boolean; readonly reasons: readonly string[]; readonly digest: string; }

const DEFAULT_LIMITS: SecurityLimits = Object.freeze({ maxPayloadBytes: 1_048_576, maxStringLength: 16_384, maxArrayLength: 4096, maxObjectKeys: 512, maxDepth: 10 });

export class RuntimeSecurity implements Disposable {
  readonly limits: SecurityLimits; #buckets = new Map<string, { tokens: number; updatedAt: number; policy: RateLimitPolicy }>(); #disposed = false;
  constructor(limits: Partial<SecurityLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits, maxPayloadBytes: clamp(integer(limits.maxPayloadBytes ?? DEFAULT_LIMITS.maxPayloadBytes), 1024, 8 * 1024 * 1024), maxStringLength: clamp(integer(limits.maxStringLength ?? DEFAULT_LIMITS.maxStringLength), 64, 131_072), maxArrayLength: clamp(integer(limits.maxArrayLength ?? DEFAULT_LIMITS.maxArrayLength), 16, 65_536), maxObjectKeys: clamp(integer(limits.maxObjectKeys ?? DEFAULT_LIMITS.maxObjectKeys), 16, 8192), maxDepth: clamp(integer(limits.maxDepth ?? DEFAULT_LIMITS.maxDepth), 2, 32) }); }
  validatePayload(payload: unknown): V7Result<number> {
    if (this.#disposed) return { ok: false, code: 'SECURITY_DISPOSED', message: 'Security runtime is disposed', retryable: false };
    const seen = new WeakSet<object>(); let nodes = 0;
    const walk = (value: unknown, depth: number): boolean => {
      nodes += 1; if (nodes > this.limits.maxObjectKeys * 64 || depth > this.limits.maxDepth) return false; if (typeof value === 'string') return value.length <= this.limits.maxStringLength; if (value === null || typeof value !== 'object') return true;
      if (seen.has(value as object)) return false; seen.add(value as object);
      if (Array.isArray(value)) return value.length <= this.limits.maxArrayLength && value.every((child) => walk(child, depth + 1));
      const entries = Object.entries(value as Record<string, unknown>); return entries.length <= this.limits.maxObjectKeys && entries.every(([key, child]) => key.length <= 256 && walk(child, depth + 1));
    };
    let serialized = ''; try { serialized = JSON.stringify(payload) ?? 'null'; } catch { return { ok: false, code: 'PAYLOAD_SERIALIZE', message: 'Payload could not be serialized', retryable: false }; }
    if (serialized.length > this.limits.maxPayloadBytes || !walk(payload, 0)) return { ok: false, code: 'PAYLOAD_REJECTED', message: 'Payload exceeds structural or byte limits', retryable: false };
    return { ok: true, value: serialized.length };
  }
  checkUrl(input: string, kind: UrlKind, allowHttp = false): UrlCheck {
    if (this.#disposed) return Object.freeze({ accepted: false, normalized: null, reason: 'disposed' });
    try {
      const url = new URL(input, typeof location !== 'undefined' ? location.href : 'https://aapw.invalid/');
      const protocols = allowHttp ? ['https:', 'http:'] : ['https:']; if (!protocols.includes(url.protocol)) return Object.freeze({ accepted: false, normalized: null, reason: `protocol:${url.protocol}` });
      if (url.username || url.password) return Object.freeze({ accepted: false, normalized: null, reason: 'credentials-not-allowed' });
      if (kind === 'worker' && !url.pathname.endsWith('.js') && !url.pathname.endsWith('.mjs')) return Object.freeze({ accepted: false, normalized: null, reason: 'worker-extension' });
      return Object.freeze({ accepted: true, normalized: url.href, reason: 'accepted' });
    } catch { return Object.freeze({ accepted: false, normalized: null, reason: 'malformed-url' }); }
  }
  consumeRateLimit(key: string, policy: RateLimitPolicy, now = Date.now()): boolean {
    if (this.#disposed || !key) return false; const normalized: RateLimitPolicy = { capacity: clamp(integer(policy.capacity), 1, 10_000), refillPerSecond: clamp(policy.refillPerSecond, .01, 10_000) }; const current = this.#buckets.get(key) ?? { tokens: normalized.capacity, updatedAt: now, policy: normalized }; const elapsed = Math.max(0, (now - current.updatedAt) / 1000); const tokens = Math.min(normalized.capacity, current.tokens + elapsed * normalized.refillPerSecond); const accepted = tokens >= 1; this.#buckets.set(key, { tokens: accepted ? tokens - 1 : tokens, updatedAt: now, policy: normalized }); return accepted;
  }
  capabilities(): SecurityCapabilities {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined; const connection = nav && 'connection' in nav ? (nav as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
    return Object.freeze({ webgpu: Boolean(nav && 'gpu' in nav), webgl2: typeof document !== 'undefined' && Boolean(document.createElement('canvas').getContext('webgl2')), workers: typeof Worker !== 'undefined', offscreenCanvas: typeof OffscreenCanvas !== 'undefined', indexedDb: typeof indexedDB !== 'undefined', serviceWorker: Boolean(nav?.serviceWorker), sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', hardwareConcurrency: Math.max(1, integer(nav?.hardwareConcurrency ?? 4)), deviceMemoryGb: nav && 'deviceMemory' in nav ? (Number((nav as Navigator & { deviceMemory?: number }).deviceMemory) || null) : null, reducedMotion: typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false, saveData: Boolean(connection?.saveData) });
  }
  report(payload: unknown, url: string, kind: UrlKind, rateKey: string, policy: RateLimitPolicy): SecurityReport { const checked = this.validatePayload(payload); const urlCheck = this.checkUrl(url, kind); const rateAccepted = this.consumeRateLimit(rateKey, policy); const reasons = [!checked.ok ? checked.code : '', !urlCheck.accepted ? urlCheck.reason : '', !rateAccepted ? 'rate-limited' : ''].filter(Boolean); const payloadBytes = checked.ok ? checked.value : 0; return Object.freeze({ payloadAccepted: checked.ok, payloadBytes, rateAccepted, urlAccepted: urlCheck.accepted, reasons: Object.freeze(reasons), digest: digest(payloadBytes, urlCheck.normalized, rateAccepted, reasons) }); }
  resetRateLimits(): void { this.#buckets.clear(); }
  dispose(): void { this.#disposed = true; this.#buckets.clear(); }
}
