import { describe, expect, it } from 'vitest';
import { MigrationGuardRegistry } from '../../src/3d/modern/migrationGuards';
import { AssetIntegrityPipeline } from '../../src/3d/modern/assetIntegrityPipeline';
import { checksum } from '../../src/3d/modern/deterministic';

describe('MigrationGuardRegistry', () => {
  it('requires parity evidence before promotion', () => {
    const registry = new MigrationGuardRegistry();
    registry.register({ id: 'player', legacyPath: 'src/3d/gameplay/player.js', modernPath: 'src/3d/modern/player.ts', status: 'shadow' });
    expect(registry.promote('player').ok).toBe(false);
    registry.reportParity('player', true);
    expect(registry.promote('player').ok).toBe(true);
    expect(registry.report().activeCount).toBe(1);
  });

  it('blocks a surface after a parity failure', () => {
    const registry = new MigrationGuardRegistry();
    registry.register({ id: 'world', legacyPath: 'src/3d/world.js', modernPath: 'src/3d/modern/world.ts', status: 'shadow' });
    registry.reportParity('world', false, 'position drift');
    expect(registry.surface('world')?.status).toBe('blocked');
    expect(registry.promote('world').ok).toBe(false);
    expect(registry.report().blockedCount).toBe(1);
  });

  it('rejects unsafe migration paths', () => {
    const registry = new MigrationGuardRegistry();
    expect(registry.register({ id: 'bad', legacyPath: '../secret.js', modernPath: 'src/3d/modern.ts', status: 'legacy' }).ok).toBe(false);
  });
});

describe('AssetIntegrityPipeline', () => {
  it('accepts bytes matching manifest size and checksum', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const digest = checksum(Array.from(bytes));
    const pipeline = new AssetIntegrityPipeline();
    const registered = pipeline.register({ id: 'blob', url: 'https://cdn.example.test/blob.bin', type: 'binary', bytes: bytes.byteLength, digest, required: true });
    expect(registered.ok).toBe(true);
    expect(pipeline.validateDownloaded('blob', bytes, digest).ok).toBe(true);
  });

  it('rejects size and digest mismatch', () => {
    const pipeline = new AssetIntegrityPipeline();
    const digest = checksum([1, 2, 3, 4]);
    pipeline.register({ id: 'blob', url: 'https://cdn.example.test/blob.bin', type: 'binary', bytes: 4, digest, required: true });
    expect(pipeline.validateDownloaded('blob', new Uint8Array([1, 2]), digest).ok).toBe(false);
    expect(pipeline.failureCount('blob')).toBe(1);
  });

  it('produces sorted deterministic manifest output', () => {
    const pipeline = new AssetIntegrityPipeline();
    const digest = checksum([1]);
    pipeline.register({ id: 'z', url: 'https://cdn.example.test/z.bin', type: 'binary', bytes: 1, digest, required: false });
    pipeline.register({ id: 'a', url: 'https://cdn.example.test/a.bin', type: 'binary', bytes: 1, digest, required: true });
    const manifest = pipeline.manifest();
    expect(manifest.entries.map((entry) => entry.id)).toEqual(['a', 'z']);
    expect(manifest.digest).toEqual(expect.any(String));
  });
});
