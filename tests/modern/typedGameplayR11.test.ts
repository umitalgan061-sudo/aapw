import { describe, expect, it } from 'vitest';
import { getR11GameplayCoverage, R11_GAMEPLAY_MIGRATION } from '../../src/3d/modern/migrationLedgerR11Gameplay.ts';
import { INTERACTION_FACTIONS, INTERACTION_PROGRESSION } from '../../src/3d/gameplay/interaction.ts';
import { DRAGON_CONFIG } from '../../src/3d/gameplay/dragonConfig.ts';
import { CART_CONFIG } from '../../src/3d/gameplay/cartBrain.ts';
import { CREATURE_BEHAVIOR_PROFILES } from '../../src/3d/gameplay/creatureBrain.ts';

describe('R11 gameplay TypeScript ownership', () => {
  it('records the complete typed gameplay migration', () => {
    const coverage = getR11GameplayCoverage();
    expect(coverage.version).toBe(11);
    expect(coverage.migrated).toBe(R11_GAMEPLAY_MIGRATION.length);
    expect(coverage.coveragePercent).toBe(100);
  });

  it('preserves gameplay configuration contracts', () => {
    expect(INTERACTION_FACTIONS.DRAGONSTONE).toBe('dragonstone');
    expect(INTERACTION_PROGRESSION.START_LEVEL).toBe(1);
    expect(INTERACTION_PROGRESSION.MAX_LEVEL).toBeGreaterThan(INTERACTION_PROGRESSION.START_LEVEL);
    expect(typeof DRAGON_CONFIG.MODEL_URL).toBe('string');
    expect(CART_CONFIG).toBeDefined();
    expect(Object.keys(CREATURE_BEHAVIOR_PROFILES).length).toBeGreaterThan(0);
  });
});
