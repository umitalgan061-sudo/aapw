import { describe, expect, it } from 'vitest';
import { classifyImports, LegacySurfaceAudit } from '../../../src/3d/modern/r28/legacyAudit.ts';
import { TokenBucket } from '../../../src/3d/modern/r27/network.ts';
import { assetId } from '../../../src/3d/modern/r27/contracts.ts';

describe('R28 network and migration policy', () => {
  it('classifies import boundaries deterministically', () => {
    const result = classifyImports([
      { source: './foo.ts', kind: 'static' },
      { source: './compat.js', kind: 'static' },
      { source: './legacy/player.js', kind: 'static' },
      { source: 'three', kind: 'static' },
    ]);
    expect(result.typed).toEqual(['./foo.ts']);
    expect(result.shim).toEqual(['./compat.js']);
    expect(result.legacy).toEqual(['./legacy/player.js']);
    expect(result.unknown).toEqual(['three']);
  });

  it('fails migration audit when legacy ownership remains active', () => {
    const audit = new LegacySurfaceAudit();
    audit.register({
      legacy: 'src/3d/gameplay/player.js',
      typed: 'src/3d/gameplay/player.ts',
      shim: 'src/3d/gameplay/player.js',
      owner: 'legacy',
      importBoundary: 'shim',
    });
    expect(audit.audit().ready).toBe(false);
    expect(audit.audit().violations).toContain('legacy-production-owner:src/3d/gameplay/player.js');
  });

  it('keeps bandwidth budget bounded under repeated consumption', () => {
    const bucket = new TokenBucket({ bytesPerSecond: 600, burstBytes: 600 });
    bucket.refill(60);
    expect(bucket.tryConsume(600)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
    expect(assetId('network')).toBe('network');
  });
});
