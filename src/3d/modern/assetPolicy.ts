import type { PlatformError, ResourceDescriptor, Result } from './types';
import { checksum } from './deterministic';

export interface AssetPolicy {
  readonly allowedProtocols: readonly string[];
  readonly maxUrlLength: number;
  readonly maxAssetBytes: number;
  readonly sameOriginOnly: boolean;
}

export interface AssetManifestEntry extends ResourceDescriptor {
  readonly sha256?: string;
  readonly cache: 'immutable' | 'stale-while-revalidate' | 'no-store';
}

export const DEFAULT_ASSET_POLICY: AssetPolicy = {
  allowedProtocols: ['http:', 'https:', 'blob:'],
  maxUrlLength: 2048,
  maxAssetBytes: 256 * 1024 * 1024,
  sameOriginOnly: true,
};

/** Validates asset URLs before a loader touches the network or filesystem. */
export function validateAssetUrl(url: string, baseUrl: string, policy = DEFAULT_ASSET_POLICY): Result<URL> {
  if (!url || url.length > policy.maxUrlLength) return fail('ASSET_URL_INVALID', 'Asset URL is empty or too long');
  try {
    const resolved = new URL(url, baseUrl);
    if (!policy.allowedProtocols.includes(resolved.protocol)) return fail('ASSET_PROTOCOL_BLOCKED', `Protocol ${resolved.protocol} is not allowed`);
    if (policy.sameOriginOnly && resolved.origin !== new URL(baseUrl).origin && resolved.protocol !== 'blob:') {
      return fail('ASSET_ORIGIN_BLOCKED', 'Cross-origin asset blocked by manifest policy');
    }
    return { ok: true, value: resolved };
  } catch (cause) {
    return { ok: false, error: { code: 'ASSET_URL_PARSE_FAILED', message: 'Invalid asset URL', retryable: false, cause } };
  }
}

export function validateManifest(entries: readonly AssetManifestEntry[], policy = DEFAULT_ASSET_POLICY): Result<number> {
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (ids.has(entry.id)) return fail('ASSET_DUPLICATE_ID', `Duplicate asset id ${entry.id}`);
    ids.add(entry.id);
    if (entry.bytes !== undefined && (entry.bytes < 0 || entry.bytes > policy.maxAssetBytes)) {
      return fail('ASSET_SIZE_INVALID', `Asset ${entry.id} exceeds size policy`);
    }
    totalBytes += entry.bytes ?? 0;
    if (totalBytes > policy.maxAssetBytes * 8) return fail('ASSET_BUNDLE_TOO_LARGE', 'Asset manifest exceeds aggregate budget');
  }
  return { ok: true, value: entries.length };
}

export function manifestDigest(entries: readonly AssetManifestEntry[]): string {
  return checksum(entries.map((entry) => ({ id: entry.id, url: entry.url, bytes: entry.bytes ?? 0, sha256: entry.sha256 ?? '', cache: entry.cache })));
}

function fail(code: string, message: string): Result<never> {
  const error: PlatformError = { code, message, retryable: false };
  return { ok: false, error };
}
