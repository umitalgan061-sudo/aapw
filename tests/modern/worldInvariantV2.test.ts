import { describe, expect, it } from 'vitest';
import { TransitionGuardV2, validateWorldInvariants } from '../../src/3d/modern/worldInvariantV2.ts';

describe('world invariants v2', () => {
  it('normalizes bounded runtime state and reports memory violations', () => {
    const healthy = validateWorldInvariants({ tick: 4.9, entityCount: 12, activeChunks: 3, residentBytes: 100, memoryBudgetBytes: 200, playerHealth: 101, playerStamina: -1, selectedKingdomId: 'north' });
    expect(healthy.valid).toBe(true);
    expect(healthy.normalized.tick).toBe(4);
    expect(healthy.normalized.playerHealth).toBe(100);
    expect(healthy.normalized.playerStamina).toBe(0);
    const broken = validateWorldInvariants({ tick: 1, entityCount: 1, activeChunks: 1, residentBytes: 300, memoryBudgetBytes: 200, playerHealth: 50, playerStamina: 50, selectedKingdomId: null });
    expect(broken.valid).toBe(false);
    expect(broken.violations).toContain('resident memory exceeds configured budget');
  });

  it('prevents illegal runtime lifecycle transitions', () => {
    const guard = new TransitionGuardV2();
    expect(guard.transition('running')).toBe(true);
    expect(guard.transition('boot')).toBe(false);
    expect(guard.transition('paused')).toBe(true);
    expect(guard.transition('recovering')).toBe(true);
    expect(guard.transition('running')).toBe(true);
    expect(guard.state().revision).toBe(4);
    expect(guard.transition('disposed')).toBe(true);
    expect(guard.transition('running')).toBe(false);
  });
});
