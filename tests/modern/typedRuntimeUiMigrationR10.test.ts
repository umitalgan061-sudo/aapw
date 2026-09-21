import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computePlayerLockViewForward, evaluatePlayerLockTarget, selectPlayerLockTarget } from '../../src/3d/gameLoopHelpers.ts';
import { updateEntitiesSafely, updateSystemSafely } from '../../src/3d/safeMode.ts';
import { getR10MigrationSnapshot, R10_MIGRATION_MODULES } from '../../src/3d/modern/migrationLedgerR10.ts';

describe('R10 typed runtime/UI migration', () => {
  it('records complete R10 ownership coverage', () => {
    const snapshot = getR10MigrationSnapshot();
    expect(snapshot.version).toBe(10);
    expect(snapshot.migratedCount).toBe(R10_MIGRATION_MODULES.length);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('keeps lock-on math deterministic and tie-broken by stable id', () => {
    const forward = computePlayerLockViewForward({ x: 0, z: -10 }, { x: 0, z: 0 });
    expect(forward.x).toBe(0);
    expect(forward.z).toBe(1);
    const makeEntity = (id: string, x: number, z: number) => {
      const object3D = new THREE.Object3D();
      object3D.name = id;
      object3D.position.set(x, 0, z);
      return { id, object3D };
    };
    const left = makeEntity('alpha', -4, 8);
    const right = makeEntity('beta', 4, 8);
    const selected = selectPlayerLockTarget({
      playerPosition: { x: 0, y: 0, z: 0 },
      forward: { x: 0, z: 1 },
      candidates: [right, left],
      maxDistanceMeters: 20,
      halfAngleDegrees: 90,
    });
    expect(selected?.id).toBe('alpha');
    expect(evaluatePlayerLockTarget({
      playerPosition: { x: 0, y: 0, z: 0 },
      forward: { x: 0, z: 1 },
      entity: left,
      maxDistanceMeters: 20,
      halfAngleDegrees: 90,
    }).eligible).toBe(true);
  });

  it('keeps safe mode isolated when both update and cleanup throw', () => {
    const scene = new THREE.Scene();
    const failing = new THREE.Object3D();
    failing.name = 'failing';
    const healthy = new THREE.Object3D();
    healthy.name = 'healthy';
    scene.add(failing, healthy);
    let healthyTicks = 0;
    const entities = [
      { object3D: failing, dispose() { throw new Error('cleanup'); } },
      { object3D: healthy, dispose() {} },
    ];
    const remaining = updateEntitiesSafely({
      entities,
      scene,
      label: 'test',
      update(entity) {
        if (entity === entities[0]) throw new Error('update');
        healthyTicks += 1;
      },
    });
    expect(healthyTicks).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(healthy);
    let systemTicks = 0;
    const disabled = updateSystemSafely({
      disabled: false,
      label: 'test-system',
      update() { systemTicks += 1; throw new Error('system'); },
      disposeOnError() { throw new Error('cleanup'); },
    });
    expect(disabled).toBe(true);
    expect(systemTicks).toBe(1);
  });
});
