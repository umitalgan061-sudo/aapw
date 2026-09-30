export interface StorageCodecOptions {
  readonly maxBytes: number;
  readonly version: number;
}

export interface EncodedStorageValue {
  readonly version: number;
  readonly bytes: number;
  readonly payload: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

export class BrowserStorageCodec<T> {
  readonly options: StorageCodecOptions;

  constructor(options: Partial<StorageCodecOptions> = {}) {
    this.options = Object.freeze({
      maxBytes: Math.max(1024, Math.floor(options.maxBytes ?? 2 * 1024 * 1024)),
      version: Math.max(1, Math.floor(options.version ?? 1)),
    });
  }

  encode(value: T): EncodedStorageValue {
    const payload = canonical(value);
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > this.options.maxBytes) throw new Error('Encoded storage value exceeds size budget');
    return { version: this.options.version, bytes, payload };
  }

  decode(encoded: EncodedStorageValue): T {
    if (encoded.version !== this.options.version) throw new Error('Storage codec version mismatch');
    if (encoded.bytes > this.options.maxBytes) throw new Error('Stored value exceeds size budget');
    const actualBytes = new TextEncoder().encode(encoded.payload).byteLength;
    if (actualBytes !== encoded.bytes) throw new Error('Stored value byte count mismatch');
    return JSON.parse(encoded.payload) as T;
  }
}
