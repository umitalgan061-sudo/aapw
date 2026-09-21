import { describe, expect, it } from 'vitest';
import { getR10StrictSnapshot, R10_STRICT_MODULES } from '../../src/3d/modern/migrationLedgerR10.ts';
import { updateSystemSafely } from '../../src/3d/safeMode.ts';

describe('R10 strict TypeScript hardening', () => {
  it('records complete strict ownership for the hardened runtime-facing set', () => {
    const snapshot = getR10StrictSnapshot();
    expect(snapshot.version).toBe(10);
    expect(snapshot.strictCount).toBe(R10_STRICT_MODULES.length);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('latches safe mode failures without retry storms', () => {
    let calls = 0;
    let cleanupCalls = 0;
    const first = updateSystemSafely({
      disabled: false,
      label: 'test',
      update: () => { calls += 1; throw new Error('boom'); },
      disposeOnError: () => { cleanupCalls += 1; throw new Error('cleanup-boom'); },
    });
    const second = updateSystemSafely({
      disabled: first,
      label: 'test',
      update: () => { calls += 1; },
      disposeOnError: () => { cleanupCalls += 1; },
    });
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(calls).toBe(1);
    expect(cleanupCalls).toBe(1);
  });
});
