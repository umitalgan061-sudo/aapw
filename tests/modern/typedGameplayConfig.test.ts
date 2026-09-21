import { describe, expect, it } from 'vitest';

import {
  ANIMAL_CONFIG,
  INTERACTION_CONFIG,
  NPC_CONFIG,
  getGameplayConfigSnapshot,
  validateGameplayConfig,
} from '../../src/3d/gameplay/gameplayConfig.ts';
import { CREATURE_SPECIES } from '../../src/3d/gameplay/creatureSpeciesConfig.ts';

describe('typed gameplay configuration boundary', () => {
  it('validates the production configuration graph without legacy-owned imports', () => {
    expect(() => validateGameplayConfig()).not.toThrow();

    const snapshot = getGameplayConfigSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.playerMaxHealth).toBeGreaterThan(0);
    expect(snapshot.npcSpawnCount).toBeGreaterThan(0);
    expect(snapshot.animalSpeciesCount).toBeGreaterThanOrEqual(3);
    expect(snapshot.animalSpawnCount).toBeGreaterThan(0);
    expect(snapshot.dragonSpawnCount).toBeGreaterThan(0);
    expect(snapshot.interactionConfigFrozen).toBe(true);
  });

  it('exposes immutable runtime registries and stable public keys', () => {
    expect(Object.isFrozen(ANIMAL_CONFIG)).toBe(true);
    expect(Object.isFrozen(NPC_CONFIG)).toBe(true);
    expect(Object.isFrozen(INTERACTION_CONFIG)).toBe(true);
    expect(Object.isFrozen(CREATURE_SPECIES)).toBe(true);

    expect(CREATURE_SPECIES.ejderha.id).toBe('ejderha');
    expect(CREATURE_SPECIES.kedi.locomotion).toBe('quadruped');
    expect(CREATURE_SPECIES.kus.locomotion).toBe('flying');
  });
});
