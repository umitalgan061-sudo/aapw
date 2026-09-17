import { describe, expect, it } from 'vitest';
import {
  ANIMAL_CONFIG,
  DRAGON_CONFIG,
  INTERACTION_CONFIG,
  NPC_CONFIG,
  PLAYER_CONFIG,
  getGameplayConfigSnapshot,
  validateGameplayConfig,
} from '../../src/3d/gameplay/gameplayConfig.ts';
import { DRAGON_CONFIG as LEGACY_DRAGON_CONFIG } from '../../src/3d/gameplay/dragonConfig.js';
import { PLAYER_CONFIG as LEGACY_PLAYER_CONFIG } from '../../src/3d/gameplay/playerConfig.js';

const stableJson = (value: unknown): string => JSON.stringify(value);

describe('typed gameplay configuration contracts', () => {
  it('validates every gameplay domain through one facade', () => {
    expect(() => validateGameplayConfig()).not.toThrow();
    expect(Object.isFrozen(PLAYER_CONFIG)).toBe(true);
    expect(Object.isFrozen(DRAGON_CONFIG)).toBe(true);
    expect(Object.isFrozen(INTERACTION_CONFIG)).toBe(true);
  });

  it('keeps legacy barrels equivalent to the typed authorities', () => {
    expect(LEGACY_PLAYER_CONFIG).toBe(PLAYER_CONFIG);
    expect(LEGACY_DRAGON_CONFIG).toBe(DRAGON_CONFIG);
  });

  it('locks the authored domain envelope', () => {
    expect(NPC_CONFIG.SPAWNS.length).toBeGreaterThan(0);
    expect(ANIMAL_CONFIG.SPAWNS.length).toBeGreaterThan(0);
    expect(Object.keys(ANIMAL_CONFIG.SPECIES).length).toBeGreaterThanOrEqual(10);
    expect(DRAGON_CONFIG.SPAWNS[0]?.noticeToast.title).toBe('Ejderha Görüldü!');
  });

  it('produces a deterministic diagnostic snapshot', () => {
    const first = getGameplayConfigSnapshot();
    const second = getGameplayConfigSnapshot();

    expect(stableJson(first)).toBe(stableJson(second));
    expect(first).toEqual({
      schemaVersion: 1,
      domains: ['player', 'npc', 'animal', 'dragon', 'interaction'],
      playerMaxHealth: 100,
      playerSpawn: { x: 3885, y: 5404 },
      npcSpawnCount: expect.any(Number),
      animalSpeciesCount: expect.any(Number),
      animalSpawnCount: expect.any(Number),
      dragonSpawnCount: 1,
      interactionConfigFrozen: true,
    });
  });

  it('keeps cross-domain speed ordering sane', () => {
    expect(PLAYER_CONFIG.RUN_SPEED_MPS).toBeGreaterThan(PLAYER_CONFIG.WALK_SPEED_MPS);
    expect(ANIMAL_CONFIG.FLEE_SPEED_MPS).toBeGreaterThan(ANIMAL_CONFIG.PATROL_SPEED_MPS);
  });
});
