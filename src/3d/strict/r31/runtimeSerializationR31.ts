import { canonicalDigestR31 } from './snapshotR31.ts';

export interface SerializedRuntimeR31 {
  readonly version: 31;
  readonly contentType: 'application/json';
  readonly digest: string;
  readonly bytes: Uint8Array;
}

export function serializeRuntimeR31(value: unknown): SerializedRuntimeR31 {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('value-not-serializable');
  const bytes = new TextEncoder().encode(json);
  return Object.freeze({
    version: 31,
    contentType: 'application/json' as const,
    digest: canonicalDigestR31(value),
    bytes,
  });
}

export function deserializeRuntimeR31<T>(payload: SerializedRuntimeR31): T {
  if (payload.version !== 31 || payload.contentType !== 'application/json') {
    throw new Error('serialization-version-mismatch');
  }
  const decoded = JSON.parse(new TextDecoder().decode(payload.bytes)) as T;
  if (canonicalDigestR31(decoded) !== payload.digest) throw new Error('serialization-digest-mismatch');
  return decoded;
}

export function cloneRuntimeStateR31<T>(value: T): T {
  return deserializeRuntimeR31<T>(serializeRuntimeR31(value));
}
