import { describe, expect, it } from 'vitest';
import { sanitizeId, sanitizeText, validateSnapshotAge } from '../../src/3d/modern/runtimeSecurityV2.ts';
import { TransitionGuardV2 } from '../../src/3d/modern/worldInvariantV2.ts';

describe('runtime safety edge cases v2', () => {
  it('sanitizes control characters and unstable identifiers', () => {
    expect(sanitizeText('alpha\u0000beta\u0007gamma')).toBe('alphabetagamma');
    expect(sanitizeId('north west/keep')).toBe('north_west_keep');
  });

  it('rejects stale snapshots but accepts the exact age boundary', () => {
    expect(validateSnapshotAge(80, 100, 20)).toBe(true);
    expect(validateSnapshotAge(79, 100, 20)).toBe(false);
  });

  it('keeps lifecycle transitions monotonic and bounded', () => {
    const guard = new TransitionGuardV2();
    expect(guard.transition('running')).toBe(true);
    expect(guard.transition('disposed')).toBe(true);
    expect(guard.transition('recovering')).toBe(false);
    expect(guard.state().phase).toBe('disposed');
  });
});
