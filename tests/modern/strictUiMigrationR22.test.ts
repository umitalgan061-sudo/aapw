import { describe, expect, it } from 'vitest';
import { getR22StrictUiSnapshot, R22_STRICT_UI_MODULES } from '../../src/3d/modern/migrationLedgerR22.ts';

describe('R22 strict UI migration', () => {
  it('tracks every promoted HUD surface as strict TypeScript', () => {
    const snapshot = getR22StrictUiSnapshot();
    expect(snapshot.version).toBe(22);
    expect(snapshot.totalTracked).toBe(R22_STRICT_UI_MODULES.length);
    expect(snapshot.strictCount).toBe(R22_STRICT_UI_MODULES.length);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('keeps legacy compatibility paths explicit', () => {
    expect(R22_STRICT_UI_MODULES.every((module) => module.legacyPath.endsWith('.js'))).toBe(true);
    expect(R22_STRICT_UI_MODULES.every((module) => module.typedPath.endsWith('.ts'))).toBe(true);
    expect(R22_STRICT_UI_MODULES.every((module) => module.implementationPath.endsWith('Legacy.ts'))).toBe(true);
  });
});
