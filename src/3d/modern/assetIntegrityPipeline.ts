import { checksum } from './deterministic';
import { RuntimeSecurityBoundary } from './runtimeSecurity';
import type { Result } from './types';

export type AssetContentType = 'model' | 'texture' | 'audio' | 'shader' | 'json' | 'binary';

export interface AssetIntegrityEntry {
  readonly id: string;
  readonly url: string;
  readonly type: AssetContentType;
  readonly bytes: number;
  readonly digest: string;
  readonly required: boolean;
  readonly cacheKey: string;
}

export interface AssetIntegrityManifest {
  readonly version: number;
  readonly generatedAt: string;
  readonly entries: readonly AssetIntegrityEntry[];
  readonly digest: string;
}

export interface AssetValidationResult {
  readonly accepted: boolean;
  readonly id: string;
  readonly bytes: number;
  readonly digest: string;
  readonly cacheKey: string;
}

export interface AssetPipelineOptions {
  readonly maxBytes?: number;
  readonly maxTextureBytes?: number;
  readonly maxAudioBytes?: number;
  readonly maxModelBytes?: number;
  readonly security?: RuntimeSecurityBoundary;
}

const EXTENSIONS: Readonly<Record<string, AssetContentType>> = Object.freeze({
  '.fbx': 'model', '.gltf': 'model', '.glb': 'model', '.obj': 'model', '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.webp': 'texture', '.ktx2': 'texture', '.mp3': 'audio', '.ogg': 'audio', '.wav': 'audio', '.json': 'json', '.bin': 'binary', '.wasm': 'binary', '.wgsl': 'shader', '.glsl': 'shader',
});

function extension(url: string): string { const path = url.split('?')[0]!.toLowerCase(); const index = path.lastIndexOf('.'); return index >= 0 ? path.slice(index) : ''; }
function typeFor(url: string): AssetContentType { return EXTENSIONS[extension(url)] ?? 'binary'; }
function stableCacheKey(id: string, digest: string): string { return `aapw:${id}:${digest.slice(0, 24)}`; }

/** Validates downloaded asset metadata/content before it reaches ResourceRegistry. */
export class AssetIntegrityPipeline {
  readonly maxBytes: number;
  readonly maxTextureBytes: number;
  readonly maxAudioBytes: number;
  readonly maxModelBytes: number;
  readonly security: RuntimeSecurityBoundary;
  #manifest = new Map<string, AssetIntegrityEntry>();
  #failures = new Map<string, number>();

  constructor(options: AssetPipelineOptions = {}) {
    this.maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? 256 * 1024 * 1024));
    this.maxTextureBytes = Math.max(1024, Math.min(this.maxBytes, Math.trunc(options.maxTextureBytes ?? 64 * 1024 * 1024)));
    this.maxAudioBytes = Math.max(1024, Math.min(this.maxBytes, Math.trunc(options.maxAudioBytes ?? 32 * 1024 * 1024)));
    this.maxModelBytes = Math.max(1024, Math.min(this.maxBytes, Math.trunc(options.maxModelBytes ?? 96 * 1024 * 1024)));
    this.security = options.security ?? new RuntimeSecurityBoundary({ maxPayloadBytes: 64 * 1024 });
  }

  register(entry: Omit<AssetIntegrityEntry, 'cacheKey'> & Partial<Pick<AssetIntegrityEntry, 'cacheKey'>>): Result<AssetIntegrityEntry> {
    if (!entry.id || entry.id.length > 256) return { ok: false, error: { code: 'ASSET_ID_INVALID', message: 'Invalid asset id', retryable: false } };
    const url = this.security.checkUrl(entry.url, 'asset');
    if (!url.accepted) return { ok: false, error: { code: 'ASSET_URL_REJECTED', message: `Asset URL rejected: ${url.reason}`, retryable: false } };
    if (!Number.isFinite(entry.bytes) || entry.bytes < 0 || entry.bytes > this.maxBytes) return { ok: false, error: { code: 'ASSET_BYTES_INVALID', message: 'Asset byte declaration exceeds the pipeline limit', retryable: false } };
    const expected = extension(entry.url) ? typeFor(entry.url) : entry.type;
    if (expected !== entry.type && entry.type !== 'binary') return { ok: false, error: { code: 'ASSET_TYPE_MISMATCH', message: 'Asset type does not match its URL extension', retryable: false } };
    const entryLimit = entry.type === 'texture' ? this.maxTextureBytes : entry.type === 'audio' ? this.maxAudioBytes : entry.type === 'model' ? this.maxModelBytes : this.maxBytes;
    if (entry.bytes > entryLimit) return { ok: false, error: { code: 'ASSET_TYPE_BUDGET', message: `Asset exceeds ${entry.type} byte budget`, retryable: false } };
    if (!/^[a-f0-9]{8,128}$/i.test(entry.digest)) return { ok: false, error: { code: 'ASSET_DIGEST_INVALID', message: 'Asset digest is malformed', retryable: false } };
    const normalized: AssetIntegrityEntry = Object.freeze({ ...entry, url: url.normalized!, cacheKey: entry.cacheKey ?? stableCacheKey(entry.id, entry.digest) });
    this.#manifest.set(entry.id, normalized);
    return { ok: true, value: normalized };
  }

  validateDownloaded(entryId: string, data: ArrayBuffer | Uint8Array, declaredDigest?: string): Result<AssetValidationResult> {
    const manifest = this.#manifest.get(entryId);
    if (!manifest) return { ok: false, error: { code: 'ASSET_NOT_REGISTERED', message: 'Asset is not present in the integrity manifest', retryable: false } };
    const bytes = data.byteLength;
    if (bytes !== manifest.bytes) return this.#failure(entryId, 'ASSET_SIZE_MISMATCH', `Expected ${manifest.bytes} bytes, received ${bytes}`);
    const digest = checksum(Array.from(new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))));
    if (declaredDigest && declaredDigest !== digest) return this.#failure(entryId, 'ASSET_DECLARED_DIGEST', 'Downloaded bytes do not match the declared digest');
    if (manifest.digest !== digest) return this.#failure(entryId, 'ASSET_INTEGRITY_MISMATCH', 'Downloaded bytes do not match the integrity manifest');
    this.#failures.delete(entryId);
    return { ok: true, value: Object.freeze({ accepted: true, id: entryId, bytes, digest, cacheKey: manifest.cacheKey }) };
  }

  manifest(): AssetIntegrityManifest {
    const entries = Object.freeze([...this.#manifest.values()].sort((a, b) => a.id.localeCompare(b.id)));
    return Object.freeze({ version: 1, generatedAt: new Date(0).toISOString(), entries, digest: checksum(entries) });
  }

  entry(id: string): AssetIntegrityEntry | null { return this.#manifest.get(id) ?? null; }
  failureCount(id: string): number { return this.#failures.get(id) ?? 0; }
  clearFailures(): void { this.#failures.clear(); }
  clear(): void { this.#manifest.clear(); this.#failures.clear(); }

  #failure(id: string, code: string, message: string): Result<AssetValidationResult> {
    this.#failures.set(id, (this.#failures.get(id) ?? 0) + 1);
    return { ok: false, error: { code, message, retryable: this.failureCount(id) < 3 } };
  }
}
