import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyPlayerLockFacing,
  combineAxes,
  computeCameraRelativeMove,
  evaluatePlayerLockTarget,
  findNearestPlayerLockCandidate,
} from '../../src/3d/gameLoopHelpers.ts';

describe('typed game-loop helpers', () => {
  it('selects a valid lock target by angle and distance', () => {
    const object = new THREE.Group();
    object.position.set(0, 0, -10);
    object.userData.npcId = 'north-guard';
    const evaluation = evaluatePlayerLockTarget({
      playerPosition: { x: 0, y: 0, z: 0 },
      forward: { x: 0, z: -1 },
      entity: { object3D: object },
    });
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.id).toBe('north-guard');
  });

  it('provides deterministic nearest-candidate tie breaking', () => {
    const left = new THREE.Group();
    left.position.set(-5, 0, -5);
    const right = new THREE.Group();
    right.position.set(5, 0, -5);
    const result = findNearestPlayerLockCandidate({
      playerPosition: { x: 0, y: 0, z: 0 },
      forward: { x: 0, z: -1 },
      candidates: [{ id: 'b', object3D: right }, { id: 'a', object3D: left }],
    });
    expect(result?.id).toBe('a');
  });

  it('turns the player toward a lock target at a bounded angular rate', () => {
    const player = new THREE.Group();
    player.rotation.y = 0;
    expect(applyPlayerLockFacing(player, { x: 10, y: 0, z: 0 }, 0.1, 2)).toBe(true);
    expect(player.rotation.y).toBeGreaterThan(0);
    expect(player.rotation.y).toBeLessThanOrEqual(0.2);
  });

  it('merges keyboard and joystick intent without exceeding unit input', () => {
    expect(combineAxes(
      { forward: 0.8, strafe: 0.6, running: false, guarding: false, lockOnRequested: true },
      { forward: 0.8, strafe: -0.6, running: true, guarding: true, lockOnRequested: false },
    )).toMatchObject({
      forward: 1,
      strafe: 0,
      running: true,
      guarding: true,
      lockOnRequested: true,
    });
  });

  it('computes camera-relative motion from the camera target direction', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 3, 10);
    const controls = {
      target: new THREE.Vector3(0, 0, 0),
      minPolarAngle: 0.08,
      maxPolarAngle: Math.PI / 2 - 0.05,
      minDistance: 1,
      maxDistance: 100,
    } as never;
    const result = computeCameraRelativeMove(camera, controls, {
      forward: 1, strafe: 0, running: false, guarding: false, lockOnRequested: false,
    });
    expect(result.z).toBeLessThan(0);
  });
});
