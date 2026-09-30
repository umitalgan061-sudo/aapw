import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA_LIMITS, StrictCameraRuntime, buildCameraIntent, cameraCollisionDebug, cameraPointToTarget, resolveCameraCollisionPosition, validateCameraState } from '../../../src/3d/strict/cameraRuntime.ts';
import { entityId, vec3 } from '../../../src/3d/strict/liveCoreTypes.ts';

const target = { position: vec3(0,1,0), lookAt: vec3(0,1.4,0), yaw:0, pitch:.45 };

describe('cameraRuntime', () => {
  it('maps stable mode presets', () => {
    expect(buildCameraIntent('combat', target).distance).toBeCloseTo(6.2);
    expect(buildCameraIntent('lock-on', target).recenter).toBe(true);
    expect(buildCameraIntent('dodge', target).cameraCut).toBe(true);
    expect(buildCameraIntent('explore', target).fov).toBeCloseTo(65);
  });
  it('clamps distance and height', () => {
    const runtime = new StrictCameraRuntime(target);
    const min=runtime.setDistance(-10); const max=runtime.setDistance(100); const height=runtime.setHeight(100);
    expect(min.ok && max.ok && height.ok).toBe(true);
    if(!min.ok || !max.ok || !height.ok)return;
    expect(min.value).toBe(DEFAULT_CAMERA_LIMITS.minDistance);
    expect(max.value).toBe(DEFAULT_CAMERA_LIMITS.maxDistance);
    expect(height.value).toBe(12);
  });
  it('rejects after disposal', () => { const runtime=new StrictCameraRuntime(target); runtime.dispose(); const result=runtime.setOrbit(0,.5); expect(result.ok).toBe(false); if(!result.ok)expect(result.error.code).toBe('RUNTIME_DISPOSED'); });
  it('resolves an obstruction on the camera ray', () => { const candidate={id:entityId('wall'),center:vec3(0,1.4,4),radius:1,height:2}; const resolved=resolveCameraCollisionPosition(vec3(0,1.4,10),target.lookAt,[candidate]); expect(resolved.z).toBeLessThan(10); });
  it('leaves off-axis obstructions untouched', () => { const desired=vec3(10,4,10); const resolved=resolveCameraCollisionPosition(desired,target.lookAt,[{id:entityId('off-axis'),center:vec3(-20,1,4),radius:1}]); expect(resolved).toEqual(desired); });
  it('updates smoothly toward moving target', () => { const runtime=new StrictCameraRuntime(target); const initial=runtime.snapshot(); const result=runtime.update(1/60,{...target,lookAt:vec3(2,1.4,0)}); expect(result.ok).toBe(true); if(!result.ok)return; expect(result.value.position).not.toEqual(initial.position); });
  it('supports lock-on identity', () => { const runtime=new StrictCameraRuntime(target); expect(runtime.setMode('lock-on',target,entityId('enemy')).ok).toBe(true); expect(runtime.snapshot().lockOnEntity).toBe('enemy'); });
  it('produces normalized look direction', () => { const result=new StrictCameraRuntime(target).update(1/60,target); expect(result.ok).toBe(true); if(!result.ok)return; const direction=cameraPointToTarget(result.value); expect(Math.hypot(direction.x,direction.y,direction.z)).toBeCloseTo(1); });
  it('validates initial state', () => expect(validateCameraState(new StrictCameraRuntime(target).snapshot()).ok).toBe(true));
  it('exposes collision diagnostics', () => { const debug=cameraCollisionDebug(vec3(0,1,10),vec3(0,1,0),[]); expect(debug.hit).toBe(false); expect(debug.distanceAfter).toBeCloseTo(debug.distanceBefore); });
});