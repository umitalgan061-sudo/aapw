import { describe, expect, it } from 'vitest';
import {
  PLAYER_THIRD_PERSON_CAMERA_VERSION,
  resolvePlayerThirdPersonCameraFrame,
  resolvePlayerThirdPersonCameraPolicy,
  resolvePlayerThirdPersonCameraPosition,
} from '../../src/3d/gameplay/playerThirdPersonCameraPolicy.ts';

describe('Kızıl Ufuk strict third-person camera policy', () => {
  it('preserves idle/move/sprint framing semantics', () => {
    expect(resolvePlayerThirdPersonCameraPolicy({ movementSpeed: 0 }).locomotion).toBe('idle');
    expect(resolvePlayerThirdPersonCameraPolicy({ movementSpeed: 2 }).locomotion).toBe('move');
    expect(resolvePlayerThirdPersonCameraPolicy({ movementSpeed: 6.2 }).locomotion).toBe('sprint');
  });

  it('tightens combat and lock-on framing without losing finite bounds', () => {
    const normal = resolvePlayerThirdPersonCameraPolicy({ distance: 5.8, shoulderOffset: 0.85 });
    const combat = resolvePlayerThirdPersonCameraPolicy({
      distance: 5.8,
      shoulderOffset: 0.85,
      movementSpeed: 7.5,
      combatActive: true,
      lockOn: true,
    });
    expect(combat.distance).toBeLessThan(normal.distance);
    expect(Math.abs(combat.shoulderOffset)).toBeLessThan(Math.abs(normal.shoulderOffset));
    expect(combat.distance).toBeGreaterThanOrEqual(2.5);
    expect(combat.distance).toBeLessThanOrEqual(12);
    expect(Number.isFinite(combat.yawRadians)).toBe(true);
  });

  it('normalizes hostile angles and coordinates deterministically', () => {
    const a = resolvePlayerThirdPersonCameraFrame(
      { yawRadians: Number.POSITIVE_INFINITY, pitchRadians: Number.NaN, distance: Number.NEGATIVE_INFINITY },
      { x: Number.NaN, y: 3, z: Number.POSITIVE_INFINITY },
    );
    const b = resolvePlayerThirdPersonCameraFrame(
      { yawRadians: Number.POSITIVE_INFINITY, pitchRadians: Number.NaN, distance: Number.NEGATIVE_INFINITY },
      { x: Number.NaN, y: 3, z: Number.POSITIVE_INFINITY },
    );
    expect(a.version).toBe(PLAYER_THIRD_PERSON_CAMERA_VERSION);
    expect(a).toEqual(b);
    expect(Object.values(a.position).every(Number.isFinite)).toBe(true);
    expect(Object.values(a.lookAt).every(Number.isFinite)).toBe(true);
  });

  it('keeps world position math reproducible', () => {
    const policy = resolvePlayerThirdPersonCameraPolicy({ yawRadians: 0.75, shoulderOffset: 0.4 });
    expect(resolvePlayerThirdPersonCameraPosition(policy, { x: 10, y: 3, z: -4 }))
      .toEqual(resolvePlayerThirdPersonCameraPosition(policy, { x: 10, y: 3, z: -4 }));
  });
});
