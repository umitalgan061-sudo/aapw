import { describe, expect, it } from 'vitest';
import { defaultAssetIntegrityPolicy, inspectAssetResponse, normalizeIntegrityManifest, validateAssetDescriptor } from '../../src/3d/modern/assetIntegrityV2.ts';

describe('asset integrity v2', () => {
  it('rejects credential-bearing or unsupported asset URLs', () => {
    expect(validateAssetDescriptor({ id: 'a', url: 'javascript:alert(1)', critical: true })).toContain('protocol javascript: is not allowed');
    expect(validateAssetDescriptor({ id: 'b', url: 'https://user:pass@example.com/file', critical: false })).toContain('credential-bearing asset URLs are forbidden');
    expect(validateAssetDescriptor({ id: 'c', url: 'https://example.com/file', critical: false })).toEqual([]);
  });

  it('verifies response type, size and deterministic digest', async () => {
    const body = '{"ok":true}';
    const digest = (() => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < body.length; index += 1) {
        hash ^= body.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    })();
    const result = await inspectAssetResponse(
      { id: 'manifest', url: 'https://example.com/manifest.json', expectedBytes: new TextEncoder().encode(body).byteLength, expectedDigest: digest, critical: true },
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      defaultAssetIntegrityPolicy,
    );
    expect(result.ok).toBe(true);
    expect(result.digest).toBe(digest);
  });

  it('normalizes manifest entries and caps untrusted fields', () => {
    const manifest = normalizeIntegrityManifest({ generatedAt: 42.9, assets: [{ id: ' x ', url: ' https://example.com/x ', critical: true }, ...Array.from({ length: 20_100 }, (_, index) => ({ id: String(index), url: 'https://example.com/x', critical: false }))] });
    expect(manifest.version).toBe(1);
    expect(manifest.generatedAt).toBe(42);
    expect(manifest.assets.length).toBe(20_000);
    expect(manifest.assets[0]?.id).toBe('x');
  });
});
