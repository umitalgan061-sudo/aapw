import { describe, expect, it } from 'vitest';
import { getR12MigrationSnapshot, R12_MIGRATION_MODULES } from '../../src/3d/modern/migrationLedgerR12.ts';
import { PLAYER_DIRECTIONAL_LOCOMOTION_VERSION, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS } from '../../src/3d/gameplay/playerDirectionalLocomotionPolicy.ts';
import { PLAYER_ANIMATION_TEMPORAL_POLICY_VERSION, PLAYER_ANIMATION_TEMPORAL_LIMITS } from '../../src/3d/gameplay/playerAnimationTemporalPolicy.ts';
import { SETTLEMENT_CAMPAIGN_RUNTIME_VERSION, SETTLEMENT_CAMPAIGN_LIMITS } from '../../src/3d/gameplay/settlementCampaignRuntime.ts';
import { NATURAL_GEOLOGY_RENDER_POLICY } from '../../src/3d/world/naturalGeology.ts';
import { TERRAIN_MACRO_WEATHERING_POLICY } from '../../src/3d/world/terrainMacroWeathering.ts';

describe('R12 production TypeScript migration', () => {
  it('tracks all promoted legacy payloads as active TypeScript owners', () => {
    const snapshot = getR12MigrationSnapshot();
    expect(snapshot.version).toBe(12);
    expect(snapshot.totalModules).toBe(16);
    expect(R12_MIGRATION_MODULES.every((entry) => entry.typedPath.endsWith('.ts'))).toBe(true);
    expect(snapshot.domains.gameplay).toBe(11);
    expect(snapshot.domains.world).toBe(4);
    expect(snapshot.domains.editor).toBe(1);
  });

  it('preserves production policy versions and bounded tuning contracts', () => {
    expect(PLAYER_DIRECTIONAL_LOCOMOTION_VERSION).toMatch(/^2026-/);
    expect(PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS).toBeDefined();
    expect(PLAYER_ANIMATION_TEMPORAL_POLICY_VERSION).toMatch(/^2026-/);
    expect(PLAYER_ANIMATION_TEMPORAL_LIMITS).toBeDefined();
    expect(SETTLEMENT_CAMPAIGN_RUNTIME_VERSION).toBeGreaterThanOrEqual(1);
    expect(SETTLEMENT_CAMPAIGN_LIMITS).toBeDefined();
    expect(NATURAL_GEOLOGY_RENDER_POLICY).toBeDefined();
    expect(TERRAIN_MACRO_WEATHERING_POLICY).toBeDefined();
  });
});
