import { describe, expect, it } from 'vitest';
import { asEntityId, asTick } from '../../src/3d/modern/v5/domain.ts';
import { GameServiceV5 } from '../../src/3d/modern/v5/service.ts';

describe('modern-v5 game service', () => {
  it('creates and tracks a player through the typed facade', () => {
    const service = new GameServiceV5();
    const player = service.spawnPlayer({ x: 4, y: 2, z: -1 });
    expect(player).toBe(1);
    expect(service.entities()).toHaveLength(1);
    expect(service.status().ready).toBe(false);
  });

  it('preserves legacy import/export as a reversible bridge', () => {
    const service = new GameServiceV5();
    const id = service.importLegacy({ id: 7, position: { x: 1, y: 2, z: 3 }, name: 'legacy' });
    expect(id).toBe(asEntityId(7));
    expect(service.exportLegacy(asEntityId(7))?.name).toBe('legacy');
  });

  it('advances simulation while keeping the runtime tick monotonic', async () => {
    const service = new GameServiceV5();
    service.start();
    const before = service.status().tick;
    await service.frame(1 / 30, []);
    expect(Number(service.status().tick)).toBeGreaterThan(Number(before));
  });

  it('keeps tick values branded and non-negative', () => {
    expect(asTick(-5)).toBe(0);
    expect(Number(asEntityId(9))).toBe(9);
  });
});
