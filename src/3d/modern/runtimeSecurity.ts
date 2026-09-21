import { checksum, stableStringify } from './deterministic';
import type { PlatformError, Result, UnixMillis } from './types';

export type SecuritySeverity = 'info' | 'warning' | 'error' | 'blocker';
export type SecuritySource = 'input' | 'network' | 'asset' | 'save' | 'plugin' | 'runtime';

export interface SecurityFinding {
  readonly code: string;
  readonly severity: SecuritySeverity;
  readonly source: SecuritySource;
  readonly message: string;
  readonly timestamp: UnixMillis;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SecurityPolicy {
  readonly maxPayloadBytes: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxDepth: number;
  readonly maxCollectionItems: number;
  readonly allowedProtocols: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly allowBlobUrls: boolean;
  readonly allowDataUrls: boolean;
  readonly rejectCredentialsInUrls: boolean;
}

export interface UrlCheck {
  readonly accepted: boolean;
  readonly normalized: string | null;
  readonly reason: string | null;
}

const DEFAULT_POLICY: SecurityPolicy = Object.freeze({
  maxPayloadBytes: 512 * 1024,
  maxStringLength: 16 * 1024,
  maxArrayLength: 4096,
  maxObjectKeys: 1024,
  maxDepth: 24,
  maxCollectionItems: 4096,
  allowedProtocols: Object.freeze(['https:', 'http:']),
  allowedOrigins: Object.freeze([]),
  allowBlobUrls: false,
  allowDataUrls: false,
  rejectCredentialsInUrls: true,
});

function byteLength(value: unknown): number {
  try { return new TextEncoder().encode(stableStringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}

function addFinding(findings: SecurityFinding[], code: string, severity: SecuritySeverity, source: SecuritySource, message: string, now: () => UnixMillis, metadata: Record<string, unknown> = {}): void {
  findings.push(Object.freeze({ code, severity, source, message, timestamp: now(), metadata: Object.freeze({ ...metadata }) }));
}

export class RuntimeSecurityBoundary {
  readonly policy: SecurityPolicy;
  #now: () => UnixMillis;
  #findings: SecurityFinding[] = [];
  #blocked = new Set<string>();

  constructor(options: Partial<SecurityPolicy> = {}, now: () => UnixMillis = () => Date.now() as UnixMillis) {
    this.policy = Object.freeze({
      ...DEFAULT_POLICY,
      ...options,
      allowedProtocols: Object.freeze([...(options.allowedProtocols ?? DEFAULT_POLICY.allowedProtocols)]),
      allowedOrigins: Object.freeze([...(options.allowedOrigins ?? DEFAULT_POLICY.allowedOrigins)]),
    });
    this.#now = now;
  }

  findings(): readonly SecurityFinding[] { return Object.freeze([...this.#findings]); }
  clearFindings(): void { this.#findings.length = 0; }
  isBlocked(code: string): boolean { return this.#blocked.has(code); }

  inspectPayload(value: unknown, source: SecuritySource, label = 'payload'): Result<true> {
    const findings: SecurityFinding[] = [];
    const seen = new WeakSet<object>();
    let nodes = 0;
    const walk = (node: unknown, depth: number, path: string): boolean => {
      if (node === null || node === undefined) return true;
      if (typeof node === 'string') {
        if (node.length > this.policy.maxStringLength) {
          addFinding(findings, 'SEC_STRING_LIMIT', 'blocker', source, `${label} string exceeds limit`, this.#now, { path, length: node.length });
          return false;
        }
        return true;
      }
      if (typeof node !== 'object') {
        if (typeof node === 'number' && !Number.isFinite(node)) {
          addFinding(findings, 'SEC_NONFINITE', 'error', source, `${label} contains non-finite number`, this.#now, { path });
          return false;
        }
        return true;
      }
      if (depth > this.policy.maxDepth) {
        addFinding(findings, 'SEC_DEPTH_LIMIT', 'blocker', source, `${label} nesting is too deep`, this.#now, { path, depth });
        return false;
      }
      const object = node as object;
      if (seen.has(object)) {
        addFinding(findings, 'SEC_CYCLE', 'blocker', source, `${label} contains a cyclic reference`, this.#now, { path });
        return false;
      }
      seen.add(object);
      nodes += 1;
      if (nodes > this.policy.maxCollectionItems) {
        addFinding(findings, 'SEC_NODE_LIMIT', 'blocker', source, `${label} contains too many nodes`, this.#now, { path, nodes });
        seen.delete(object);
        return false;
      }
      if (Array.isArray(node)) {
        if (node.length > this.policy.maxArrayLength) {
          addFinding(findings, 'SEC_ARRAY_LIMIT', 'blocker', source, `${label} array exceeds limit`, this.#now, { path, length: node.length });
          seen.delete(object);
          return false;
        }
        for (let i = 0; i < node.length; i += 1) if (!walk(node[i], depth + 1, `${path}[${i}]`)) { seen.delete(object); return false; }
      } else {
        const entries = Object.entries(node as Record<string, unknown>);
        if (entries.length > this.policy.maxObjectKeys) {
          addFinding(findings, 'SEC_KEYS_LIMIT', 'blocker', source, `${label} object has too many keys`, this.#now, { path, count: entries.length });
          seen.delete(object);
          return false;
        }
        for (const [key, child] of entries) {
          if (key.length > 512) {
            addFinding(findings, 'SEC_KEY_LIMIT', 'blocker', source, `${label} key is too long`, this.#now, { path, keyLength: key.length });
            seen.delete(object);
            return false;
          }
          if (!walk(child, depth + 1, path ? `${path}.${key}` : key)) { seen.delete(object); return false; }
        }
      }
      seen.delete(object);
      return true;
    };
    const validShape = walk(value, 0, '$');
    const bytes = byteLength(value);
    if (bytes > this.policy.maxPayloadBytes) {
      addFinding(findings, 'SEC_BYTES_LIMIT', 'blocker', source, `${label} exceeds byte budget`, this.#now, { bytes, limit: this.policy.maxPayloadBytes });
    }
    this.#findings.push(...findings);
    const accepted = validShape && bytes <= this.policy.maxPayloadBytes;
    if (!accepted) {
      for (const finding of findings.filter((item) => item.severity === 'blocker')) this.#blocked.add(finding.code);
      return { ok: false, error: this.#error('SEC_PAYLOAD_REJECTED', `${label} rejected by security boundary`, source) };
    }
    return { ok: true, value: true };
  }

  checkUrl(input: string, source: SecuritySource = 'asset'): UrlCheck {
    let url: URL;
    try { url = new URL(input, typeof location !== 'undefined' ? location.href : 'https://aapw.invalid/'); }
    catch {
      this.#recordUrlFinding('SEC_URL_INVALID', source, input);
      return { accepted: false, normalized: null, reason: 'invalid-url' };
    }
    if (this.policy.rejectCredentialsInUrls && (url.username || url.password)) {
      this.#recordUrlFinding('SEC_URL_CREDENTIALS', source, input);
      return { accepted: false, normalized: null, reason: 'credentials-disallowed' };
    }
    if (url.protocol === 'data:' && !this.policy.allowDataUrls) {
      this.#recordUrlFinding('SEC_URL_DATA', source, input);
      return { accepted: false, normalized: null, reason: 'data-url-disallowed' };
    }
    if (url.protocol === 'blob:' && !this.policy.allowBlobUrls) {
      this.#recordUrlFinding('SEC_URL_BLOB', source, input);
      return { accepted: false, normalized: null, reason: 'blob-url-disallowed' };
    }
    if (!this.policy.allowedProtocols.includes(url.protocol)) {
      this.#recordUrlFinding('SEC_URL_PROTOCOL', source, url.protocol);
      return { accepted: false, normalized: null, reason: 'protocol-disallowed' };
    }
    if (this.policy.allowedOrigins.length && !this.policy.allowedOrigins.includes(url.origin)) {
      this.#recordUrlFinding('SEC_URL_ORIGIN', source, url.origin);
      return { accepted: false, normalized: null, reason: 'origin-disallowed' };
    }
    return { accepted: true, normalized: url.toString(), reason: null };
  }

  validateAssetRequest(input: { readonly id: string; readonly url: string; readonly bytes?: number; readonly kind?: string }): Result<true> {
    if (!input.id || input.id.length > 512) return { ok: false, error: this.#error('SEC_ASSET_ID', 'Invalid asset id', 'asset') };
    const url = this.checkUrl(input.url, 'asset');
    if (!url.accepted) return { ok: false, error: this.#error('SEC_ASSET_URL', `Asset URL rejected: ${url.reason}`, 'asset') };
    if (input.bytes !== undefined && (!Number.isFinite(input.bytes) || input.bytes < 0 || input.bytes > 1024 * 1024 * 1024)) {
      return { ok: false, error: this.#error('SEC_ASSET_BYTES', 'Asset byte declaration is invalid', 'asset') };
    }
    return { ok: true, value: true };
  }

  verifyIntegrity<T>(payload: T, expected: string): Result<true> {
    const actual = checksum(payload);
    if (actual !== expected) {
      addFinding(this.#findings, 'SEC_INTEGRITY_MISMATCH', 'blocker', 'save', 'Integrity checksum mismatch', this.#now, { expected, actual });
      this.#blocked.add('SEC_INTEGRITY_MISMATCH');
      return { ok: false, error: this.#error('SEC_INTEGRITY_MISMATCH', 'Payload integrity verification failed', 'save') };
    }
    return { ok: true, value: true };
  }

  sanitizeError(error: unknown, source: SecuritySource): PlatformError {
    const text = error instanceof Error ? error.message : String(error);
    const safeMessage = text.slice(0, 512).replace(/[\u0000-\u001f]/g, ' ');
    addFinding(this.#findings, 'SEC_RUNTIME_ERROR', 'error', source, safeMessage, this.#now);
    return this.#error('SEC_RUNTIME_ERROR', safeMessage, source);
  }

  #recordUrlFinding(code: string, source: SecuritySource, value: string): void {
    addFinding(this.#findings, code, 'blocker', source, 'URL rejected by security policy', this.#now, { value: value.slice(0, 256) });
    this.#blocked.add(code);
  }

  #error(code: string, message: string, source: SecuritySource): PlatformError {
    return Object.freeze({ code, message, retryable: source === 'network' || source === 'asset' });
  }
}

export function defaultSecurityPolicy(): SecurityPolicy { return DEFAULT_POLICY; }
