import { describe, expect, it } from 'vitest';
import { RuntimeEventBusR42 } from '../../../src/3d/strict/r42/events.ts';
import { StreamingPlannerR42 } from '../../../src/3d/strict/r42/streaming.ts';
import { HudModelR42 } from '../../../src/3d/strict/r42/ui.ts';

describe('R42 app-layer services', () => {
  it('publishes bounded typed events to subscribers', () => {
    const bus = new RuntimeEventBusR42(4);
    const received: string[] = [];
    const unsubscribe = bus.subscribe('*', event => received.push(event.type));
    bus.publish('runtime.tick', 1, { dt: 1 / 60 });
    bus.publish('custom', 1, { action: 'x' });
    unsubscribe();
    bus.publish('runtime.tick', 2);
    expect(received).toEqual(['runtime.tick', 'custom']);
    expect(bus.peek()).toHaveLength(3);
  });

  it('creates deterministic interest-based stream plans', () => {
    const planner = new StreamingPlannerR42({ cellSizeMeters: 10, prefetchRadiusCells: 2, maxLoadsPerTick: 10 });
    const a = planner.plan({ x: 0, y: 0, z: 0 });
    planner.clear();
    const b = planner.plan({ x: 0, y: 0, z: 0 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.loads.length).toBeGreaterThan(0);
  });

  it('tracks notices and accessibility settings in a typed HUD model', () => {
    const hud = new HudModelR42(2);
    const notice = hud.notify('warning', '<warning>', 10, 2);
    expect(hud.state.notifications).toHaveLength(1);
    expect(notice.message).toBe('warning');
    hud.setAccessibility({ reducedMotion: true, largeText: true });
    expect(hud.accessibility.reducedMotion).toBe(true);
    hud.expire(12);
    expect(hud.state.notifications).toHaveLength(0);
  });
});
