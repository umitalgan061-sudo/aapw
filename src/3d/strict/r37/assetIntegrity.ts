import { SecurityBoundaryR37 } from './securityBoundary.ts';
import { finite } from './math.ts';

export interface AssetIntegrityManifest {
  readonly id: string;
  readonly url: string;
  readonly contentType?: string;
  readonly byteLength: number;
  readonly sha256?: string;
  readonly version: number;
}

export interface AssetIntegrityResult {
  readonly accepted: boolean;
  readonly id: string;
  readonly reason: string;
  readonly normalized: AssetIntegrityManifest;
}

export interface AssetIntegrityConfig {
  readonly maxBytes: number;
  readonly allowedProtocols: readonly string[];
  readonly allowedTypes: readonly string[];
}

const DEFAULT_CONFIG: AssetIntegrityConfig = Object.freeze({
  maxBytes: 128 * 1024 * 1024,
  allowedProtocols: Object.freeze(['https:', 'http:', 'blob:', 'data:']),
  allowedTypes: Object.freeze([
    'model/gltf-binary',
    'model/gltf+json',
    'application/octet-stream',
    'audio/mpeg',
    'audio/wav',
    'image/png',
    'image/jpeg',
    'text/plain',
  ]),
});

export class AssetIntegrityR37 {
  readonly config: AssetIntegrityConfig;
  readonly security: SecurityBoundaryR37;

  constructor(config: Partial<AssetIntegrityConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      maxBytes: Math.max(1024, finite(config.maxBytes, DEFAULT_CONFIG.maxBytes)),
      allowedProtocols: Object.freeze([...(config.allowedProtocols ?? DEFAULT_CONFIG.allowedProtocols)]),
      allowedTypes: Object.freeze([...(config.allowedTypes ?? DEFAULT_CONFIG.allowedTypes)]),
    });
    this.security = new SecurityBoundaryR37();
  }

  validate(manifest: AssetIntegrityManifest): AssetIntegrityResult {
    const id = String(manifest.id).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 96);
    let url: URL;
    try {
      url = new URL(manifest.url, 'https://local.invalid');
    } catch {
      return this.reject(id, 'invalid-url', manifest);
    }
    if (!this.config.allowedProtocols.includes(url.protocol)) return this.reject(id, 'protocol-not-allowed', manifest);
    if (url.username || url.password) return this.reject(id, 'credentials-in-url', manifest);
    const byteLength = Math.max(0, Math.trunc(finite(manifest.byteLength)));
    if (byteLength > this.config.maxBytes) return this.reject(id, 'asset-too-large', manifest);
    const contentType = manifest.contentType ? String(manifest.contentType).toLowerCase().slice(0, 128) : undefined;
    if (contentType && !this.config.allowedTypes.includes(contentType)) return this.reject(id, 'content-type-not-allowed', manifest);
    const sha256 = manifest.sha256 ? String(manifest.sha256).toLowerCase().slice(0, 64) : undefined;
    if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) return this.reject(id, 'invalid-sha256', manifest);
    const normalized = Object.freeze({
      id,
      url: manifest.url.slice(0, 2048),
      ...(contentType ? { contentType } : {}),
      byteLength,
      ...(sha256 ? { sha256 } : {}),
      version: Math.max(1, Math.trunc(finite(manifest.version, 1))),
    });
    return Object.freeze({ accepted: true, id, reason: 'asset-integrity-valid', normalized });
  }

  assert(manifest: AssetIntegrityManifest): AssetIntegrityManifest {
    const result = this.validate(manifest);
    if (!result.accepted) throw new TypeError('asset integrity rejected: ' + result.reason);
    return result.normalized;
  }

  #reject(id: string, reason: string, manifest: AssetIntegrityManifest): AssetIntegrityResult {
    return Object.freeze({
      accepted: false,
      id,
      reason,
      normalized: Object.freeze({
        id,
        url: String(manifest.url).slice(0, 2048),
        byteLength: 0,
        version: 1,
      }),
    });
  }
}
