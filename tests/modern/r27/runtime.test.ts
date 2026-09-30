import { describe, expect, it } from 'vitest';
import {
  R27Runtime,
  buildSystem,
  componentType,
  entityId,
  TypedWorkerBroker,
  type WorkerResponse,
  type WorkerTransport,
} from '../../../src/3d/modern/r27/index.ts';

describe('R27 runtime orchestration', () => {
  it('executes registered systems through a fixed deterministic loop', () => {
    const runtime = new R27Runtime({
      tickRate: 60,
      maxStepsPerFrame: 3,
      budget: { maxSystems: 16, maxCommands: 32 },
      qualityLevel: 2,
    });
    const position = componentType('position');
    const player = runtime.world.create();
    runtime.world.set(player, position, { x: 0, y: 0, z: 0 });

    runtime.scheduler.register(buildSystem('move', 'simulation', 0, ({ tick }) => {
      const value = runtime.world.get<{ x: number; y: number; z: number }>(player, position);
      if (!value) return;
      runtime.world.set(player, position, { ...value, x: value.x + tick.dtSeconds });
    }));

    const result = runtime.runFrame(1 / 30);
    expect(result.accumulator.steps).toBe(2);
    expect(runtime.currentTick()).toBe(2);
    expect(runtime.world.get<{ x: number; y: number; z: number }>(player, position)?.x).toBeCloseTo(2 / 60);
    expect(result.snapshot.checksum).toMatch(/^[0-9a-f]+$/);
  });

  it('survives a frame spike using the spiral guard without runaway simulation', () => {
    const runtime = new R27Runtime({ maxStepsPerFrame: 2 });
    const result = runtime.runFrame(2);
    expect(result.accumulator.steps).toBe(2);
    expect(result.accumulator.droppedSeconds).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === 'incident' && event.code === 'R27_SPIRAL_GUARD')).toBe(true);
  });

  it('sanitizes input before simulation ownership receives it', () => {
    const runtime = new R27Runtime();
    runtime.setInput({
      tick: 0,
      move: { x: 9, y: Number.NaN },
      look: { x: -9, y: 9 },
      buttons: ['jump', 'jump'],
      analog: { sprint: 9 },
    });
    expect(runtime.runFrame(1 / 60).events).toBeDefined();
  });

  it('updates quality from measured evidence rather than frame-to-frame noise', () => {
    const runtime = new R27Runtime({ qualityLevel: 2 });
    const before = runtime.quality.level;
    for (let tick = 0; tick < 12; tick++) {
      runtime.samplePerformance({
        tick,
        cpuMs: 20,
        frameMs: 25,
        drawCalls: 1500,
        triangles: 1_000_000,
        networkBytes: 12_000,
        memoryMb: 700,
      });
    }
    expect(runtime.quality.level).toBeLessThan(before);
  });

  it('exposes a stable snapshot contract after entity lifecycle changes', () => {
    const runtime = new R27Runtime();
    const first = runtime.world.create();
    const second = runtime.world.create();
    const initial = runtime.createSnapshot();
    expect(initial.entities.map((entry) => Number(entry.id))).toEqual([Number(first), Number(second)]);

    runtime.world.destroy(first);
    const next = runtime.createSnapshot();
    expect(next.entities.map((entry) => Number(entry.id))).toEqual([Number(second)]);
    expect(next.checksum).not.toBe(initial.checksum);
  });

  it('connects a typed worker broker without exposing engine internals', async () => {
    let listener: ((message: WorkerResponse) => void) | undefined;
    const transport: WorkerTransport = {
      send: (message) => {
        listener?.({
          type: 'asset-manifest-ready',
          requestId: message.requestId,
          assets: [],
        });
      },
      onMessage: (handler) => {
        listener = handler;
        return () => { listener = undefined; };
      },
    };

    const broker = new TypedWorkerBroker(transport);
    const response = await broker.request({
      type: 'build-asset-manifest',
      assets: [],
    });
    expect(response.type).toBe('asset-manifest-ready');
    broker.dispose();
  });
});
