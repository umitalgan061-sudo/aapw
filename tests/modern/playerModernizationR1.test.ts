import { describe, expect, it } from 'vitest';
import { PLAYER_CONFIG } from '../../src/3d/gameplay/playerConfig.ts';

describe('Kızıl Ufuk player modernization R1', () => {
  it('keeps the shipped player asset family explicit and typed', () => {
    expect(PLAYER_CONFIG.MODEL_URL).toBe('assets/models/characters/peasant_girl.fbx');
    expect(Object.keys(PLAYER_CONFIG.ANIMATION_URLS).sort()).toEqual(['idle', 'running', 'walking']);
    expect(PLAYER_CONFIG.WALK_SPEED_MPS).toBeGreaterThan(0);
    expect(PLAYER_CONFIG.RUN_SPEED_MPS).toBeGreaterThan(PLAYER_CONFIG.WALK_SPEED_MPS);
  });

  it('keeps combat-safe grounding and camera bounds finite', () => {
    expect(PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS).toBeGreaterThan(1);
    expect(PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS).toBeGreaterThan(PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS);
    expect(PLAYER_CONFIG.CAMERA_COLLISION_MIN_DISTANCE_METERS).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(PLAYER_CONFIG.GRAVITY_MPS2)).toBe(true);
    expect(Number.isFinite(PLAYER_CONFIG.JUMP_SPEED_MPS)).toBe(true);
  });
});