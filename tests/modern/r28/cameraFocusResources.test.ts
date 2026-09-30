import { describe, expect, it } from 'vitest';
import { RuntimeCameraController } from '../../../src/3d/modern/r28/cameraController.ts';
import { RuntimeFocusManager } from '../../../src/3d/modern/r28/focusManager.ts';
import { RuntimeResourceRegistry } from '../../../src/3d/modern/r28/resourceRegistry.ts';

describe('R28 camera, focus and resources', () => {
  it('tracks a target with bounded damping and valid camera volume', () => {
    const camera = new RuntimeCameraController({ minDistance: 3, maxDistance: 20 });
    camera.zoom(-50);
    expect(camera.state().distance).toBe(3);
    camera.update({ position: { x: 10, y: 2, z: -4 }, velocity: { x: 1, y: 0, z: 0 } }, 1 / 60);
    const volume = camera.volume(Math.PI / 3, 16 / 9);
    expect(volume.far).toBeGreaterThan(volume.near);
    expect(Number.isFinite(volume.forward.x)).toBe(true);
  });

  it('cycles focus targets inside an explicit scope', () => {
    const manager = new RuntimeFocusManager();
    manager.register({ id: 'a', scope: 'game', order: 2 });
    manager.register({ id: 'b', scope: 'game', order: 1 });
    manager.register({ id: 'menu', scope: 'menu', order: 0 });
    manager.setScope('game');
    expect(manager.focusNext()?.id).toBe('b');
    expect(manager.focusNext()?.id).toBe('a');
    manager.setScope('menu');
    expect(manager.focusNext()?.id).toBe('menu');
  });

  it('disposes replaced and bulk resources deterministically', () => {
    const registry = new RuntimeResourceRegistry();
    const disposed: string[] = [];
    registry.register({ id: 'tex', kind: 'texture', bytes: 10, dispose: () => disposed.push('tex-1') });
    registry.register({ id: 'tex', kind: 'texture', bytes: 20, dispose: () => disposed.push('tex-2') });
    registry.register({ id: 'mesh', kind: 'geometry', bytes: 30, dispose: () => disposed.push('mesh') });

    expect(registry.stats().bytes).toBe(50);
    expect(registry.release('mesh')).toBe(true);
    registry.dispose();
    expect(disposed).toEqual(['tex-1', 'mesh', 'tex-2']);
  });
});
