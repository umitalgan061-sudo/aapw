import { describe, expect, it } from 'vitest';
import { entityId, vec3, type CameraVolume } from '../../../src/3d/modern/r27/contracts.ts';
import { RuntimeRenderAdapter } from '../../../src/3d/modern/r27/renderAdapter.ts';
import { DeterministicRenderScheduler } from '../../../src/3d/modern/r28/renderScheduler.ts';
import { BrowserWorldBridge } from '../../../src/3d/modern/r28/worldBridge.ts';

describe('R28 render scheduling and world bridge', () => {
  it('runs high-priority render submissions inside deterministic budget', () => {
    const scheduler = new DeterministicRenderScheduler({ maxSubmissions: 2 });
    const called: string[] = [];
    scheduler.enqueue({ id: 'low', priority: 1, cost: 2, execute: () => called.push('low') });
    scheduler.enqueue({ id: 'high', priority: 10, cost: 1, execute: () => called.push('high') });
    scheduler.enqueue({ id: 'medium', priority: 5, cost: 2, execute: () => called.push('medium') });

    const schedule = scheduler.run(3);
    expect(schedule.submitted).toEqual(['high', 'low']);
    expect(schedule.deferred).toEqual(['medium']);
    expect(called).toEqual(['high', 'low']);
  });

  it('converts runtime snapshots into renderer-neutral packets', () => {
    const adapter = new RuntimeRenderAdapter();
    const frame = adapter.buildFrame({
      schema: 1,
      tick: 20,
      timeSeconds: 0.33,
      qualityLevel: 3,
      checksum: 'x',
      entities: [{
        id: entityId(1),
        transform: {
          position: vec3(2, 4, 6),
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: vec3(1, 2, 1),
        },
        tags: ['player'],
      }],
    });
    expect(frame.visibleCount).toBe(1);
    expect(frame.proxies[0]?.interaction).toBe('none');
    expect(frame.proxies[0]?.rotation).toEqual([0, 0, 0, 1]);
  });

  it('bridges indexed entities into nearby and visibility snapshots', () => {
    const bridge = new BrowserWorldBridge(4);
    bridge.upsert({
      entity: entityId(1),
      bounds: { min: vec3(-1, 0, -1), max: vec3(1, 2, 1) },
      position: vec3(0, 1, 0),
      tags: ['player'],
      layer: 0,
      enabled: true,
    });
    const camera: CameraVolume = {
      position: vec3(0, 2, 8),
      forward: vec3(0, 0, -1),
      up: vec3(0, 1, 0),
      fovYRadians: Math.PI / 3,
      aspect: 16 / 9,
      near: 0.1,
      far: 100,
    };
    const snapshot = bridge.frame(camera, 3, vec3(0, 0, 0), 20);
    expect(snapshot.nearby.map((entry) => Number(entry.entity))).toEqual([1]);
    expect(snapshot.visible.map((entry) => Number(entry.entity))).toEqual([1]);
    expect(snapshot.shadowCasters).toEqual([entityId(1)]);
  });
});
