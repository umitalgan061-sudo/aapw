import { describe, expect, it } from 'vitest';
import { CameraRuntimeV3, cameraForward, createDefaultCameraConfig, validateCameraPose, type CameraPose } from '../../src/3d/nextgen/cameraRuntimeV3';

const pose = (distance = 5): CameraPose => ({
  position: { x: 0, y: 3, z: -distance },
  target: { x: 0, y: 1, z: 0 },
  yaw: 0,
  pitch: 0.2,
  distance,
  roll: 0,
});

describe('camera runtime v3', () => {
  it('keeps output bounded and deterministic for identical inputs', () => {
    const a = new CameraRuntimeV3(undefined, pose());
    const b = new CameraRuntimeV3(undefined, pose());
    a.setTarget(11, { position: { x: 4, y: 1, z: 2 }, radius: 0.6 });
    b.setTarget(11, { position: { x: 4, y: 1, z: 2 }, radius: 0.6 });
    a.setInput({ lookX: 0.4, lookY: -0.2, orbit: true, zoom: 0.25 });
    b.setInput({ lookX: 0.4, lookY: -0.2, orbit: true, zoom: 0.25 });
    a.setShake(123, 0.35); b.setShake(123, 0.35);
    const first = a.update(1 / 60);
    const second = b.update(1 / 60);
    expect(first).toEqual(second);
    expect(first.pose.distance).toBeGreaterThanOrEqual(createDefaultCameraConfig().minDistance);
    expect(first.pose.distance).toBeLessThanOrEqual(createDefaultCameraConfig().maxDistance);
    expect(validateCameraPose(first.pose).valid).toBe(true);
  });

  it('respects pitch, zoom and collision bounds', () => {
    const camera = new CameraRuntimeV3(undefined, pose(5));
    camera.setInput({ orbit: true, lookY: 100, zoom: 100 });
    const snapshot = camera.update(1 / 60, { maxDistance: 2 });
    const config = createDefaultCameraConfig();
    expect(snapshot.pose.pitch).toBeLessThanOrEqual(config.pitchMax);
    expect(snapshot.pose.distance).toBeGreaterThanOrEqual(config.minDistance);
    expect(snapshot.collisionLimited).toBe(true);
  });

  it('supports reduced-motion accessibility by eliminating camera shake', () => {
    const camera = new CameraRuntimeV3(undefined, pose());
    camera.setShake(99, 1);
    camera.setReducedMotion(true);
    const snapshot = camera.update(1 / 60);
    expect(snapshot.shakeScale).toBe(0);
  });

  it('supports deterministic cinematic keyframes and transitions', () => {
    const camera = new CameraRuntimeV3(undefined, pose());
    camera.setCinematic([
      { at: 0, pose: pose(4) },
      { at: 1, pose: { ...pose(10), target: { x: 2, y: 2, z: 0 }, yaw: 0.8 } },
    ]);
    const first = camera.update(1 / 60);
    expect(first.mode).toBe('cinematic');
    expect(first.cinematicWeight).toBe(1);

    camera.clearCinematic();
    camera.beginTransition(pose(8), 0.5);
    const transitioned = camera.update(1 / 60);
    expect(transitioned.mode).toBe('follow');
    expect(transitioned.pose.distance).toBeGreaterThan(4);
    expect(transitioned.pose.distance).toBeLessThan(8.1);
  });

  it('exposes a stable forward vector and safe disposal', () => {
    const camera = new CameraRuntimeV3(undefined, pose());
    const snapshot = camera.update(1 / 60);
    const forward = cameraForward(snapshot.pose);
    expect(forward.z).toBeGreaterThan(0);
    camera.dispose();
    expect(camera.disposed).toBe(true);
    expect(camera.snapshot().tick).toBe(snapshot.tick);
    camera.setInput({ lookX: 100, orbit: true });
    expect(camera.snapshot().pose).toEqual(snapshot.pose);
  });

  it('rejects malformed poses without mutating configuration', () => {
    const config = createDefaultCameraConfig();
    const bad = { ...pose(), distance: Infinity };
    const result = validateCameraPose(bad, config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('non-finite camera pose');
    expect(config.maxDistance).toBe(18);
  });

  it('interpolates positions and look targets monotonically', () => {
    const camera = new CameraRuntimeV3();
    camera.setTarget(1, { position: { x: 0, y: 1, z: 0 } });
    const before = camera.snapshot();
    camera.setInput({ orbit: true, lookX: 0.1 });
    const after = camera.update(1 / 60);
    expect(after.tick).toBe(before.tick + 1);
    expect(after.pose.yaw).toBeGreaterThanOrEqual(before.pose.yaw);
    expect(after.pose.yaw).toBeLessThanOrEqual(before.pose.yaw + 0.01);
  });
});
