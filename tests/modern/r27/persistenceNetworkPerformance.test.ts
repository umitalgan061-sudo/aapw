import { describe, expect, it } from 'vitest';
import {
  SaveCodec,
  InMemorySaveRepository,
  AdaptiveQualityController,
  RollingPerformance,
  SnapshotBuffer,
  TokenBucket,
  entityId,
  saveSlotId,
  zeroInputFrame,
} from '../../../src/3d/modern/r27/index.ts';

describe('R27 persistence, network and performance', () => {
  it('round-trips versioned saves and detects tampering', () => {
    type State = { score: number; name: string };
    const codec = new SaveCodec<State>(2);
    codec.registerMigration({
      fromVersion: 1,
      toVersion: 2,
      migrate: (value) => ({ ...(value as { score: number; name: string }), score: (value as { score: number }).score + 1 }),
    });

    const record = codec.encode(saveSlotId('slot1'), 40, { score: 9, name: 'hero' });
    expect(codec.decode(record)).toEqual({ score: 9, name: 'hero' });

    const tampered = {
      ...record,
      data: { score: 10, name: 'hero' },
    };
    expect(() => codec.decode(tampered)).toThrow(/checksum/i);
  });

  it('keeps save repository bounded and newest-first', () => {
    const codec = new SaveCodec<{ value: number }>(1);
    const repo = new InMemorySaveRepository<{ value: number }>(2);
    repo.put(codec.encode('a', 1, { value: 1 }));
    repo.put(codec.encode('b', 2, { value: 2 }));
    repo.put(codec.encode('c', 3, { value: 3 }));
    expect(repo.list().map((record) => String(record.header.slot))).toEqual(['c', 'b']);
  });

  it('interpolates snapshots and bounds token budget', () => {
    const buffer = new SnapshotBuffer(4);
    const base = {
      schema: 1 as const,
      tick: 1,
      timeSeconds: 1,
      qualityLevel: 2 as const,
      checksum: 'a',
      entities: [{
        id: entityId(1),
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        tags: [],
      }],
    };
    buffer.push({ sequence: { value: 1 }, acknowledgedInput: 1, serverTick: 1, sentAtTick: 1, state: base });
    buffer.push({ sequence: { value: 2 }, acknowledgedInput: 2, serverTick: 2, sentAtTick: 2, state: {
      ...base,
      tick: 2,
      timeSeconds: 2,
      entities: [{
        ...base.entities[0],
        transform: {
          ...base.entities[0]?.transform,
          position: { x: 10, y: 0, z: 0 },
        },
      }],
      checksum: 'b',
    }});

    const sampled = buffer.sample(1.5);
    expect(sampled?.entities[0]?.transform?.position.x).toBeCloseTo(5);

    const bucket = new TokenBucket({ bytesPerSecond: 1000, burstBytes: 100 });
    bucket.refill(60);
    expect(bucket.tryConsume(90)).toBe(true);
    expect(bucket.tryConsume(20)).toBe(false);
  });

  it('changes quality only after sustained evidence', () => {
    const controller = new AdaptiveQualityController(2, 16, 1000, { downshiftFrames: 3, upshiftFrames: 5 });
    for (let i = 0; i < 2; i++) {
      const decision = controller.update({
        tick: i,
        cpuMs: 25,
        frameMs: 25,
        drawCalls: 2000,
        triangles: 2000000,
        networkBytes: 10000,
        memoryMb: 500,
      });
      expect(decision.changed).toBe(false);
    }
    expect(controller.update({
      tick: 2,
      cpuMs: 25,
      frameMs: 25,
      drawCalls: 2000,
      triangles: 2000000,
      networkBytes: 10000,
      memoryMb: 500,
    }).level).toBe(1);

    const rolling = new RollingPerformance({ windowSize: 4 });
    rolling.push({
      tick: 1,
      cpuMs: 5,
      frameMs: 12,
      drawCalls: 100,
      triangles: 1000,
      networkBytes: 100,
      memoryMb: 100,
      gpuMs: 4,
    });
    expect(rolling.average()?.frameMs).toBe(12);
  });
});
