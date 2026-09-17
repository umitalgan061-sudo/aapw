import { describe, expect, it } from 'vitest';
import { PLAYER_CONFIG, playerAnimationUrl, playerSpawnMapPosition, validatePlayerConfig } from '../../src/3d/gameplay/playerConfig.ts';

describe('typed PLAYER_CONFIG', () => {
  it('validates the shipped model, animation family and camera envelope', () => {
    expect(() => validatePlayerConfig()).not.toThrow();
    expect(Object.isFrozen(PLAYER_CONFIG)).toBe(true);
    expect(Object.isFrozen(PLAYER_CONFIG.ANIMATION_URLS)).toBe(true);
    expect(Object.isFrozen(PLAYER_CONFIG.CAMERA_INITIAL_OFFSET_METERS)).toBe(true);
    expect(PLAYER_CONFIG.MODEL_URL).toBe('assets/models/characters/peasant_girl.fbx');
    expect(PLAYER_CONFIG.ANIMATION_URLS).toEqual({
      idle: 'assets/animations/peasant_girl/idle.fbx',
      walking: 'assets/animations/peasant_girl/walking.fbx',
      running: 'assets/animations/peasant_girl/running.fbx',
    });
    expect(playerAnimationUrl('idle')).toContain('/idle.fbx');
    expect(playerSpawnMapPosition()).toEqual({ x: 3885, y: 5404 });
  });

  it('rejects malformed movement/camera contracts', () => {
    expect(() => validatePlayerConfig({ ...PLAYER_CONFIG, WALK_SPEED_MPS: 8, RUN_SPEED_MPS: 7 })).toThrow(/speed ordering/);
    expect(() => validatePlayerConfig({ ...PLAYER_CONFIG, CAMERA_MAX_DISTANCE_METERS: 2 })).toThrow(/camera distance/);
    expect(() => validatePlayerConfig({ ...PLAYER_CONFIG, GRAVITY_MPS2: 20 })).toThrow(/jump arc/);
  });

  it('keeps the serialized config deterministic', () => {
    const first = JSON.stringify(PLAYER_CONFIG);
    const second = JSON.stringify({ ...PLAYER_CONFIG, ANIMATION_URLS: { ...PLAYER_CONFIG.ANIMATION_URLS }, CAMERA_INITIAL_OFFSET_METERS: { ...PLAYER_CONFIG.CAMERA_INITIAL_OFFSET_METERS } });
    expect(second).toBe(first);
  });
});
