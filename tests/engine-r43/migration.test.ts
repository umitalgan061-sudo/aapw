import { describe, expect, it } from 'vitest';
import { OwnershipLedger, createCoreR43OwnershipLedger, normalizePath } from '../../src/engine-ts/r43/migration.ts';

describe('r43 TypeScript ownership', () => {
  it('normalizes cross-platform repository paths', () => {
    expect(normalizePath('./src\\3d\\game3d.ts')).toBe('src/3d/game3d.ts');
    expect(normalizePath('src///3d///player.ts')).toBe('src/3d/player.ts');
  });

  it('tracks typed, compatibility and vendor ownership separately', () => {
    const ledger = new OwnershipLedger();
    ledger.register({ path: './src/a.ts', status: 'typed', reason: 'owner', critical: true });
    ledger.register({ path: './src/a.js', ownerPath: './src/a.ts', status: 'compatibility', reason: 'legacy import surface', critical: true });
    ledger.register({ path: './src/vendor.js', status: 'vendor', reason: 'third-party', critical: false });
    const summary = ledger.summary();
    expect(summary.total).toBe(3);
    expect(summary.typed).toBe(1);
    expect(summary.compatibility).toBe(1);
    expect(summary.vendor).toBe(1);
    expect(summary.criticalTypedCoverage).toBe(0.5);
  });

  it('builds a stable core ownership ledger', () => {
    const ledger = createCoreR43OwnershipLedger();
    expect(ledger.get('src/3d/game3d.ts')?.status).toBe('typed');
    expect(ledger.get('src/3d/vendor/three/three.module.js')?.status).toBe('vendor');
    expect(ledger.summary().digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('exposes a migration backlog with compatibility files first', () => {
    const ledger = new OwnershipLedger();
    ledger.register({ path: 'src/a.js', ownerPath: 'src/a.ts', status: 'compatibility', reason: 'bridge', critical: true });
    ledger.register({ path: 'src/b.js', status: 'legacy', reason: 'not migrated', critical: false });
    ledger.register({ path: 'src/c.ts', status: 'typed', reason: 'owner', critical: false });
    expect(ledger.migrationBacklog().map((item) => item.path)).toEqual(['src/a.js', 'src/b.js']);
  });

  it('enforces explicit critical coverage thresholds', () => {
    const ledger = new OwnershipLedger();
    ledger.register({ path: 'src/a.ts', status: 'typed', reason: 'owner', critical: true });
    ledger.register({ path: 'src/b.ts', status: 'typed', reason: 'owner', critical: true });
    expect(() => ledger.assertCriticalCoverage(1)).not.toThrow();
    ledger.register({ path: 'src/c.js', status: 'legacy', reason: 'pending', critical: true });
    expect(() => ledger.assertCriticalCoverage(1)).toThrow(/coverage/i);
  });
});
