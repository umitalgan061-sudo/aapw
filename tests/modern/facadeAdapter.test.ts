import { describe, expect, it } from 'vitest';
import { RuntimeFacadeAdapter } from '../../src/3d/modern/runtimeFacadeAdapter';

describe('RuntimeFacadeAdapter', () => {
  it('normalizes missing live values into safe defaults', () => {
    const adapter = new RuntimeFacadeAdapter({ read: () => ({}) , viewport: () => ({ width: 100, height: 50, dpr: 2 }) });
    expect(adapter.capturePlayer().position).toEqual({ x: 0, y: 0, z: 0 });
    expect(adapter.capturePlayer().health).toBe(100);
    expect(adapter.captureCamera().zoom).toBe(6);
    expect(adapter.getViewport()).toEqual({ width: 100, height: 50, dpr: 2 });
  });

  it('reads live player and world values without returning mutable source references', () => {
    const source = {
      player: { object3D: { position: { x: 1, y: 2, z: 3 } }, velocity: { x: 4, y: 5, z: 6 }, health: 80, maxHealth: 100, grounded: false },
      camera: { position: { x: 5, y: 6, z: 7 }, target: { x: 1, y: 1, z: 1 } },
      world: { loadedCells: ['0:0'], discoveredSettlements: ['winterfell'], weather: 'rain', timeOfDaySeconds: 120 },
      renderer: { info: { render: { calls: 12, triangles: 300 }, memory: { textures: 4 } } },
    };
    const adapter = new RuntimeFacadeAdapter({ read: () => source });
    const player = adapter.capturePlayer();
    const world = adapter.captureWorld();
    expect(player.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(player.velocity).toEqual({ x: 4, y: 5, z: 6 });
    expect(world.loadedCells).toEqual(['0:0']);
    expect(adapter.getRenderMetrics().drawCalls).toBe(12);
    player.position.x = 99;
    expect(source.player.object3D.position.x).toBe(1);
  });

  it('forwards quality changes through a typed callback', () => {
    let selected = 'high';
    const adapter = new RuntimeFacadeAdapter({ read: () => null, writeQuality: (quality) => { selected = quality; } });
    adapter.setQuality('minimal');
    expect(selected).toBe('minimal');
  });
});
