import { describe, expect, it } from 'vitest';
import { getR13MigrationSnapshot, R13_MIGRATION_MODULES } from '../../src/3d/modern/migrationLedgerR13.ts';
import { LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY, deterministicFaunaEcologyId, getFaunaEcologyLod } from '../../src/3d/gameplay/livingWorldFaunaEcologyDirector.ts';
import { LIVING_WORLD_REACTION_RUNTIME_POLICY } from '../../src/3d/gameplay/livingWorldReactionRuntime.ts';
import { PLAYER_WEAPON_PROFILES, resolvePlayerEquipmentCombatProfile, resolvePlayerAttackTuning } from '../../src/3d/gameplay/playerEquipmentCombatProfile.ts';
import { WORLD_SURFACE_POLICY_PRESETS, validateWorldSurfacePolicy } from '../../src/3d/world/WorldAssetPlacementPipeline.ts';

describe('R13 typed gameplay/world runtime', () => {
  it('tracks complete migration coverage', () => {
    const snapshot = getR13MigrationSnapshot();
    expect(snapshot.version).toBe(13);
    expect(snapshot.migratedCount).toBe(R13_MIGRATION_MODULES.length);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('keeps fauna identifiers and LOD decisions deterministic', () => {
    expect(deterministicFaunaEcologyId(1337, 'wolf', 12, 4)).toBe(deterministicFaunaEcologyId(1337, 'wolf', 12, 4));
    expect(getFaunaEcologyLod(20)).toBe('near');
    expect(getFaunaEcologyLod(500)).toBe('culled');
    expect(LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxActors).toBeGreaterThan(0);
  });

  it('keeps reaction runtime budgets explicit', () => {
    expect(LIVING_WORLD_REACTION_RUNTIME_POLICY.deterministic).toBe(true);
    expect(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors).toBe(128);
    expect(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxEventsPerTick).toBeLessThanOrEqual(6);
  });

  it('derives stable equipment combat tuning', () => {
    const profile = resolvePlayerEquipmentCombatProfile({ weapon: 'dagger', armor: 'leather' });
    const repeat = resolvePlayerEquipmentCombatProfile({ weapon: 'dagger', armor: 'leather' });
    expect(profile).toEqual(repeat);
    expect(profile.weaponId).toBe('dagger');
    expect(profile.armorId).toBe('leather');
    const tuning = resolvePlayerAttackTuning({ damage: 10, staminaCost: 10 }, profile, 'light');
    expect(tuning.damage).toBeGreaterThan(0);
    expect(tuning.staminaCost).toBeGreaterThan(0);
    expect(PLAYER_WEAPON_PROFILES.dagger).toBeTruthy();
  });

  it('keeps world placement policies valid and explicit', () => {
    expect(WORLD_SURFACE_POLICY_PRESETS.building.maxSlopeDegrees).toBeLessThan(15);
    expect(validateWorldSurfacePolicy(WORLD_SURFACE_POLICY_PRESETS.building).valid).toBe(true);
  });
});
