import type { Result } from './types';
import { checksum, stableStringify } from './deterministic';

export interface BinaryCodec<T> {
  readonly encode: (value: T) => Uint8Array;
  readonly decode: (bytes: Uint8Array) => T;
}

export interface JsonEnvelope<T> {
  readonly format: 'aapw-json';
  readonly version: 1;
  readonly type: string;
  readonly checksum: string;
  readonly payload: T;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeJson<T>(type: string, payload: T): Uint8Array {
  const envelope: JsonEnvelope<T> = { format: 'aapw-json', version: 1, type, checksum: checksum(payload), payload };
  return textEncoder.encode(stableStringify(envelope));
}

export function decodeJson<T>(bytes: Uint8Array, expectedType: string): Result<T> {
  try {
    const text = textDecoder.decode(bytes);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return invalid('SERIALIZATION_INVALID', 'Payload is not an object');
    const envelope = parsed as Partial<JsonEnvelope<T>>;
    if (envelope.format !== 'aapw-json' || envelope.version !== 1 || envelope.type !== expectedType) return invalid('SERIALIZATION_HEADER_INVALID', 'Unsupported serialization envelope');
    if (typeof envelope.checksum !== 'string' || !('payload' in envelope)) return invalid('SERIALIZATION_PAYLOAD_MISSING', 'Payload is missing');
    if (checksum(envelope.payload) !== envelope.checksum) return invalid('SERIALIZATION_CHECKSUM_INVALID', 'Payload checksum mismatch');
    return { ok: true, value: envelope.payload as T };
  } catch (cause) {
    return { ok: false, error: { code: 'SERIALIZATION_DECODE_FAILED', message: String(cause), retryable: false, cause } };
  }
}

export function createJsonCodec<T>(type: string): BinaryCodec<T> {
  return {
    encode: (value) => encodeJson(type, value),
    decode: (bytes) => {
      const result = decodeJson<T>(bytes, type);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      return result.value;
    },
  };
}

export function cloneTransferable<T extends object>(value: T): T { return structuredClone(value); }

export function validateBuffer(bytes: Uint8Array, maxBytes = 16 * 1024 * 1024): Result<Uint8Array> {
  if (bytes.byteLength > maxBytes) return invalid('SERIALIZATION_BUFFER_TOO_LARGE', `Buffer exceeds ${maxBytes} bytes`);
  return { ok: true, value: bytes };
}

export function mergeBuffers(parts: readonly Uint8Array[], maxBytes = 16 * 1024 * 1024): Result<Uint8Array> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total > maxBytes) return invalid('SERIALIZATION_BUFFER_TOO_LARGE', `Combined buffer exceeds ${maxBytes} bytes`);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return { ok: true, value: output };
}

export interface ChunkHeader {
  readonly magic: 'AAPW';
  readonly version: 1;
  readonly kind: 'world' | 'entity' | 'asset' | 'replay';
  readonly bytes: number;
  readonly checksum: string;
}

export function encodeChunk<T>(kind: ChunkHeader['kind'], payload: T): Uint8Array {
  const body = encodeJson(`chunk:${kind}`, payload);
  const header: ChunkHeader = { magic: 'AAPW', version: 1, kind, bytes: body.byteLength, checksum: checksum(body) };
  const head = textEncoder.encode(stableStringify(header));
  const separator = textEncoder.encode('\n');
  const result = new Uint8Array(head.byteLength + separator.byteLength + body.byteLength);
  result.set(head, 0); result.set(separator, head.byteLength); result.set(body, head.byteLength + separator.byteLength);
  return result;
}

export function decodeChunk<T>(bytes: Uint8Array, kind: ChunkHeader['kind']): Result<T> {
  try {
    const separator = textEncoder.encode('\n')[0]!;
    const index = bytes.indexOf(separator);
    if (index <= 0) return invalid('CHUNK_HEADER_MISSING', 'Chunk header separator missing');
    const header = JSON.parse(textDecoder.decode(bytes.subarray(0, index))) as ChunkHeader;
    const body = bytes.subarray(index + 1);
    if (header.magic !== 'AAPW' || header.version !== 1 || header.kind !== kind) return invalid('CHUNK_HEADER_INVALID', 'Chunk header mismatch');
    if (header.bytes !== body.byteLength || header.checksum !== checksum(body)) return invalid('CHUNK_CHECKSUM_INVALID', 'Chunk integrity check failed');
    return decodeJson<T>(body, `chunk:${kind}`);
  } catch (cause) {
    return { ok: false, error: { code: 'CHUNK_DECODE_FAILED', message: String(cause), retryable: false, cause } };
  }
}

function invalid(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message, retryable: false } };
}
