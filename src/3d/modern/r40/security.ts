import { hashJson } from './deterministic';

export interface SecurityLimits {
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly maxArray: number;
  readonly maxString: number;
  readonly maxPayloadBytes: number;
  readonly maxUrlLength: number;
}
const DEFAULT_LIMITS: SecurityLimits = Object.freeze({ maxDepth: 16, maxKeys: 256, maxArray: 1024, maxString: 8192, maxPayloadBytes: 262144, maxUrlLength: 4096 });
export interface ValidationResult { readonly accepted: boolean; readonly code: string; readonly reason: string; readonly digest: string; }

export class SecurityGate {
  readonly limits: SecurityLimits;
  constructor(limits: Partial<SecurityLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }

  validatePayload(value: unknown): ValidationResult {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (bytes > this.limits.maxPayloadBytes) return this.reject('PAYLOAD_TOO_LARGE', 'serialized payload exceeds configured budget');
      this.walk(value, 0, new Set<object>());
      return Object.freeze({ accepted: true, code: 'OK', reason: 'accepted', digest: hashJson(value) });
    } catch (error) {
      return this.reject('PAYLOAD_INVALID', error instanceof Error ? error.message : String(error));
    }
  }

  checkUrl(raw: string, allowBlob = false): ValidationResult {
    if (!raw || raw.length > this.limits.maxUrlLength) return this.reject('URL_INVALID', 'url is empty or too long');
    let url: URL;
    try { url = new URL(raw, 'https://aapw.invalid'); } catch { return this.reject('URL_INVALID', 'url parse failed'); }
    if (!['https:', 'http:'].includes(url.protocol) && !(allowBlob && url.protocol === 'blob:')) return this.reject('URL_PROTOCOL', 'unsupported url protocol');
    if (url.username || url.password) return this.reject('URL_CREDENTIALS', 'credential-bearing urls are rejected');
    if (raw.includes('data:')) return this.reject('URL_DATA', 'data urls are rejected by default');
    return Object.freeze({ accepted: true, code: 'OK', reason: 'accepted', digest: hashJson(url.href) });
  }

  checkCommandType(type: string): ValidationResult {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(type)) return this.reject('COMMAND_TYPE', 'command type contains unsupported characters');
    return Object.freeze({ accepted: true, code: 'OK', reason: 'accepted', digest: hashJson(type) });
  }

  #walk(value: unknown, depth: number, seen: Set<object>): void {
    if (depth > this.limits.maxDepth) throw new RangeError('nested depth exceeds limit');
    if (typeof value === 'string' && value.length > this.limits.maxString) throw new RangeError('string exceeds limit');
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) throw new TypeError('cyclic payload is not accepted');
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > this.limits.maxArray) throw new RangeError('array exceeds limit');
      for (const item of value) this.#walk(item, depth + 1, seen);
    } else {
      const keys = Object.keys(value);
      if (keys.length > this.limits.maxKeys) throw new RangeError('object key count exceeds limit');
      for (const key of keys) { if (key.length > this.limits.maxString) throw new RangeError('key exceeds limit'); this.#walk((value as Record<string, unknown>)[key], depth + 1, seen); }
    }
    seen.delete(value);
  }

  private reject(code: string, reason: string): ValidationResult {
    return Object.freeze({ accepted: false, code, reason, digest: hashJson({ code, reason }) });
  }
}
