import { describe, expect, it } from 'vitest';
import { R20_STRICT_POLICY_MODULES, getR20StrictPolicySnapshot } from '../../src/3d/modern/migrationLedgerR20.ts';

describe('R20 strict policy ledger', () => {
  it('reports complete strict ownership without escape hatches', () => {
    const snapshot = getR20StrictPolicySnapshot();
    expect(snapshot.version).toBe(20);
    expect(snapshot.coveragePercent).toBe(100);
    expect(snapshot.strictOwners).toBe(R20_STRICT_POLICY_MODULES.length);
    expect(snapshot.escapeHatches).toBe(0);
  });
});
