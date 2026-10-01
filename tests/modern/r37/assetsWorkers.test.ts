import { describe, expect, it } from 'vitest';
import { AssetIntegrityR37 } from '../../../src/3d/strict/r37/assetIntegrity.ts';
import { AssetSessionR37 } from '../../../src/3d/strict/r37/assetSession.ts';
import { WorkerSchedulerR37 } from '../../../src/3d/strict/r37/workerScheduler.ts';
import { ContentCatalogR37 } from '../../../src/3d/strict/r37/contentCatalog.ts';

describe('R37 assets/workers/content', () => {
  it('validates bounded GLB manifests', () => {
    const integrity = new AssetIntegrityR37();
    const valid = integrity.validate({
      id: 'wall',
      url: 'https://cdn.invalid/wall.glb',
      contentType: 'model/gltf-binary',
      byteLength: 1024,
      sha256: 'a'.repeat(64),
      version: 3,
    });
    expect(valid.accepted).toBe(true);
    const invalid = integrity.validate({
      id: 'bad',
      url: 'ftp://invalid/bad',
      byteLength: 1024,
      version: 1,
    });
    expect(invalid.accepted).toBe(false);
  });

  it('honours asset concurrency and timeout cancellation signal', async () => {
    const session = new AssetSessionR37({ concurrency: 2, timeoutMs: 50 });
    expect(session.enqueue({ id: 'a', url: 'https://cdn.invalid/a', priority: 2, estimatedBytes: 10, critical: true })).toBe(true);
    expect(session.enqueue({ id: 'b', url: 'https://cdn.invalid/b', priority: 1, estimatedBytes: 10, critical: false })).toBe(true);
    const results = await session.drain(async (_ticket, signal) => {
      if (signal.aborted) throw new Error('aborted');
      return 10;
    });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.length).toBe(2);
  });

  it('orders worker tasks deterministically and catalogs content', async () => {
    const workers = new WorkerSchedulerR37({ concurrency: 1 });
    workers.enqueue({ id: 'low', priority: 1, run: () => 'low' });
    workers.enqueue({ id: 'high', priority: 10, run: () => 'high' });
    const results = await workers.drain();
    expect(results[0]?.id).toBe('high');

    const catalog = new ContentCatalogR37();
    expect(catalog.register({ id: 'castle', kind: 'structure', url: 'castle.glb', version: 1, bytes: 2, tags: ['hero'] })).toBe(true);
    expect(catalog.byTag('hero')[0]?.id).toBe('castle');
  });
});
