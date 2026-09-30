import { describe, expect, it } from 'vitest';
import {
  PLAYER_COMBAT_ANIMATION_BLEND_VERSION,
  resolvePlayerCombatAnimationBlend,
  validatePlayerCombatAnimationBlend,
} from '../../src/3d/gameplay/playerCombatAnimationBlend.ts';

describe('Kızıl Ufuk strict combat animation blend', () => {
  it('keeps locomotion blending smooth and bounded', () => {
    const idle = resolvePlayerCombatAnimationBlend({ semanticState: 'idle', planarSpeedMps: 0 });
    const walk = resolvePlayerCombatAnimationBlend({ semanticState: 'locomotion', planarSpeedMps: 2.5 });
    const sprint = resolvePlayerCombatAnimationBlend({ semanticState: 'locomotion', planarSpeedMps: 6.5 });
    expect(idle.locomotionWeight).toBe(0);
    expect(walk.locomotionWeight).toBeGreaterThan(0);
    expect(sprint.locomotionWeight).toBeGreaterThan(walk.locomotionWeight);
    expect(validatePlayerCombatAnimationBlend(sprint)).toBe(true);
  });

  it('layers combat states without exceeding mixer weight budgets', () => {
    for (const semanticState of ['light-attack', 'heavy-attack', 'guard', 'dodge', 'hit-stagger']) {
      const blend = resolvePlayerCombatAnimationBlend({ semanticState, planarSpeedMps: 4, attackPhase: 0.7, guardWeight: 0.8 });
      expect(blend.version).toBe(PLAYER_COMBAT_ANIMATION_BLEND_VERSION);
      expect(validatePlayerCombatAnimationBlend(blend)).toBe(true);
      expect(blend.locomotionWeight + blend.combatOverlayWeight).toBeLessThanOrEqual(1.0001);
      expect(Object.values(blend).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
    }
  });

  it('is deterministic and immutable for identical inputs', () => {
    const input = { semanticState: 'heavy-attack', planarSpeedMps: 3.2, attackPhase: 0.65, additiveFeedbackWeight: 0.25 };
    const a = resolvePlayerCombatAnimationBlend(input);
    const b = resolvePlayerCombatAnimationBlend(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('fails malformed numeric input closed', () => {
    const blend = resolvePlayerCombatAnimationBlend({
      semanticState: 'dodge',
      planarSpeedMps: Number.POSITIVE_INFINITY,
      attackPhase: Number.NaN,
      guardWeight: Number.POSITIVE_INFINITY,
      combatOverlayWeight: Number.NEGATIVE_INFINITY,
      additiveFeedbackWeight: Number.NaN,
    });
    expect(validatePlayerCombatAnimationBlend(blend)).toBe(true);
    expect(Object.values(blend).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
  });

  it('rejects receipts from a different policy version', () => {
    const blend = resolvePlayerCombatAnimationBlend();
    expect(validatePlayerCombatAnimationBlend({ ...blend, version: 'old' as never })).toBe(false);
  });
});
