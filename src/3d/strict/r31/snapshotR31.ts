import type { RuntimeSnapshotEnvelopeR31, RuntimeSnapshotMetaR31 } from './applicationTypesR31.ts';
import { R31_RUNTIME_SCHEMA } from './applicationTypesR31.ts';

export interface SnapshotCodecR31<T> {
  readonly sanitize: (state: T) => T;
  readonly validate: (state: unknown) => state is T;
}

export interface SnapshotDecodeResultR31<T> {
  readonly ok: boolean;
  readonly state: T | null;
  readonly meta: RuntimeSnapshotMetaR31 | null;
  readonly error: string | null;
}

function stableNormalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableNormalize);
  const source = value as Record<string, unknown>;
  const target: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) target[key] = stableNormalize(source[key]);
  return target;
}

function canonical(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function digest(value: unknown): string {
  let hash = 2166136261;
  for (const char of canonical(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function canonicalDigestR31(value: unknown): string {
  return digest(value);
}

export class SnapshotCodecRuntimeR31<T> {
  readonly #codec: SnapshotCodecR31<T>;
  #encodedBytes = 0;
  #decodedBytes = 0;

  constructor(codec: SnapshotCodecR31<T>) {
    this.#codec = codec;
  }

  encode(state: T, tick: number, nowMs: number): RuntimeSnapshotEnvelopeR31<T> {
    const sanitized = this.#codec.sanitize(state);
    const envelope = Object.freeze({
      version: 31 as const,
      schema: R31_RUNTIME_SCHEMA,
      tick: Math.max(0, Math.floor(tick)),
      createdAt: Math.max(0, Math.floor(nowMs)),
      digest: digest(sanitized),
      state: sanitized,
    });
    this.#encodedBytes += canonical(envelope).length;
    return envelope;
  }

  decode(input: unknown): SnapshotDecodeResultR31<T> {
    try {
      if (!input || typeof input !== 'object') return this.fail('snapshot-not-object');
      const source = input as Partial<RuntimeSnapshotEnvelopeR31<T>>;
      if (source.version !== 31) return this.fail('version-mismatch');
      if (source.schema !== R31_RUNTIME_SCHEMA) return this.fail('schema-mismatch');
      if (!Number.isInteger(source.tick) || (source.tick ?? -1) < 0) return this.fail('invalid-tick');
      if (!Number.isFinite(source.createdAt)) return this.fail('invalid-createdAt');
      if (!this.#codec.validate(source.state)) return this.fail('state-validation-failed');
      const expected = digest(source.state);
      if (expected !== source.digest) return this.fail('digest-mismatch');
      const meta: RuntimeSnapshotMetaR31 = Object.freeze({
        version: 31,
        schema: R31_RUNTIME_SCHEMA,
        tick: source.tick,
        digest: source.digest,
        byteLength: canonical(input).length,
      });
      this.#decodedBytes += meta.byteLength;
      return Object.freeze({ ok: true, state: source.state, meta, error: null });
    } catch {
      return this.fail('decode-exception');
    }
  }

  diagnostics(): Readonly<{ encodedBytes: number; decodedBytes: number }> {
    return Object.freeze({ encodedBytes: this.#encodedBytes, decodedBytes: this.#decodedBytes });
  }

  #fail<TState>(error: string): SnapshotDecodeResultR31<TState> {
    return Object.freeze({ ok: false, state: null, meta: null, error });
  }
}
