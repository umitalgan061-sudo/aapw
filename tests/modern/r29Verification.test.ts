import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { R29_RUNTIME_VERSION } from '../../src/3d/modern/r29/index.ts';

describe('R29 repository verification surface', () => {
  it('exports the expected runtime version', () => {
    expect(R29_RUNTIME_VERSION).toBe('r29');
  });

  it('contains no ambient randomness or dynamic code evaluation in the new runtime', () => {
    const files = [
      'src/3d/modern/r29/contracts.ts',
      'src/3d/modern/r29/runtime.ts',
      'src/3d/modern/r29/worldRuntime.ts',
      'src/3d/modern/r29/networkCoordinator.ts',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/Math\.random\s*\(/);
      expect(source).not.toMatch(/new Function\s*\(/);
      expect(source).not.toMatch(/eval\s*\(/);
    }
  });
});
