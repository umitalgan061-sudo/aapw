export interface AssetIntegrityRecord {
  readonly id: string;
  readonly url: string;
  readonly expectedBytes?: number;
  readonly expectedDigest?: string;
  readonly contentType?: string;
  readonly critical: boolean;
}

export interface AssetIntegrityResult {
  readonly id: string;
  readonly ok: boolean;
  readonly bytes: number;
  readonly digest: string;
  readonly reasons: readonly string[];
}

export interface AssetIntegrityPolicy {
  readonly maxBytes: number;
  readonly allowedProtocols: readonly string[];
  readonly allowedContentTypes: readonly string[];
}

export const defaultAssetIntegrityPolicy: AssetIntegrityPolicy = Object.freeze({
  maxBytes: 128 * 1024 * 1024,
  allowedProtocols: Object.freeze(['https:', 'http:']),
  allowedContentTypes: Object.freeze(['application/json', 'application/octet-stream', 'text/plain', 'image/', 'audio/', 'model/']),
});

const digestText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const contentTypeAllowed = (contentType: string, policy: AssetIntegrityPolicy): boolean => {
  const clean = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return policy.allowedContentTypes.some((allowed) => allowed.endsWith('/') ? clean.startsWith(allowed) : clean === allowed);
};

export const validateAssetDescriptor = (record: AssetIntegrityRecord, policy: AssetIntegrityPolicy = defaultAssetIntegrityPolicy): readonly string[] => {
  const reasons: string[] = [];
  try {
    const url = new URL(record.url, typeof location !== 'undefined' ? location.href : 'http://localhost/');
    if (!policy.allowedProtocols.includes(url.protocol)) reasons.push(`protocol ${url.protocol} is not allowed`);
    if (url.username || url.password) reasons.push('credential-bearing asset URLs are forbidden');
  } catch {
    reasons.push('invalid asset URL');
  }
  if (record.expectedBytes !== undefined && (!Number.isFinite(record.expectedBytes) || record.expectedBytes < 0 || record.expectedBytes > policy.maxBytes)) reasons.push('expected byte size exceeds policy');
  return Object.freeze(reasons);
};

export const inspectAssetResponse = async (record: AssetIntegrityRecord, response: Response, policy: AssetIntegrityPolicy = defaultAssetIntegrityPolicy): Promise<AssetIntegrityResult> => {
  const reasons = [...validateAssetDescriptor(record, policy)];
  if (!response.ok) reasons.push(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
  if (contentType && !contentTypeAllowed(contentType, policy)) reasons.push(`content type ${contentType} is not allowed`);
  if (contentLength > policy.maxBytes) reasons.push(`content length exceeds ${policy.maxBytes} bytes`);
  const body = await response.text();
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > policy.maxBytes) reasons.push(`decoded body exceeds ${policy.maxBytes} bytes`);
  if (record.expectedBytes !== undefined && bytes !== Math.floor(record.expectedBytes)) reasons.push(`byte size ${bytes} does not match expected ${Math.floor(record.expectedBytes)}`);
  const digest = digestText(body);
  if (record.expectedDigest && digest !== record.expectedDigest) reasons.push('asset digest mismatch');
  return Object.freeze({ id: record.id, ok: reasons.length === 0, bytes, digest, reasons: Object.freeze(reasons) });
};

export interface IntegrityManifest {
  readonly version: 1;
  readonly generatedAt: number;
  readonly assets: readonly AssetIntegrityRecord[];
}

export const normalizeIntegrityManifest = (manifest: Partial<IntegrityManifest>): IntegrityManifest => Object.freeze({
  version: 1,
  generatedAt: Number.isFinite(manifest.generatedAt) ? Math.max(0, Math.floor(manifest.generatedAt as number)) : 0,
  assets: Object.freeze((manifest.assets ?? []).slice(0, 20_000).map((asset) => Object.freeze({
    id: String(asset.id ?? '').trim().slice(0, 128),
    url: String(asset.url ?? '').trim().slice(0, 2048),
    expectedBytes: asset.expectedBytes === undefined ? undefined : Math.max(0, Math.floor(asset.expectedBytes)),
    expectedDigest: asset.expectedDigest?.trim().slice(0, 64),
    contentType: asset.contentType?.trim().slice(0, 128),
    critical: asset.critical === true,
  }))),
});
