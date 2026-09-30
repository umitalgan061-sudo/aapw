import { describe, expect, it } from 'vitest';
import * as nextgen from '../../../src/3d/modern/nextgen/index.ts';

describe('modern nextgen public surface', () => {
  it('exports the deterministic foundation', () => {
    expect(typeof nextgen.stableStringify).toBe('function');
    expect(typeof nextgen.stableChecksum).toBe('function');
    expect(typeof nextgen.hashString).toBe('function');
    expect(typeof nextgen.entityId).toBe('function');
    expect(typeof nextgen.tickValue).toBe('function');
    expect(typeof nextgen.revisionValue).toBe('function');
    expect(typeof nextgen.vec3).toBe('function');
    expect(typeof nextgen.quatIdentity).toBe('function');
    expect(typeof nextgen.transformIdentity).toBe('function');
    expect(typeof nextgen.normalizeVec3).toBe('function');
  });

  it('exports the runtime authority modules', () => {
    const required = [
      'CommandBus',
      'EcsWorld',
      'FixedStepController',
      'RuntimeKernel',
      'Scheduler',
      'ResourceCache',
      'WorkerProtocol',
      'StateMachine',
      'RuntimeManifest',
      'ActorSimulationV2',
      'InteractionRuntimeV2',
      'InventoryRuntimeV2',
      'DialogueRuntimeV2',
      'NetworkTransportV2',
      'WorldStreamingOrchestratorV2',
      'AdaptiveRenderPipelineV2',
      'RuntimePolicyV2',
      'WorldEventJournalV2',
      'SaveSlotManagerV2',
      'WorkerSchedulerV2',
      'SimulationCoordinatorV2',
      'AssetLifecycleV2',
      'WorldStateCodecV2',
      'NextGenRuntimeFacadeV2',
    ];

    for (const symbol of required) expect(symbol in nextgen).toBe(true);
  });

  it('rejects invalid entity identifiers', () => {
    expect(() => nextgen.entityId(0)).toThrow();
    expect(() => nextgen.entityId(-1)).toThrow();
    expect(() => nextgen.entityId(1.5)).toThrow();
    expect(nextgen.entityId(1)).toBe(1);
  });

  it('rejects invalid time identifiers', () => {
    expect(() => nextgen.tickValue(-1)).toThrow();
    expect(() => nextgen.tickValue(1.25)).toThrow();
    expect(() => nextgen.revisionValue(-1)).toThrow();
    expect(nextgen.tickValue(0)).toBe(0);
    expect(nextgen.revisionValue(7)).toBe(7);
  });

  it('creates canonical transform defaults', () => {
    expect(nextgen.vec3()).toEqual({ x: 0, y: 0, z: 0 });
    expect(nextgen.quatIdentity()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(nextgen.transformIdentity()).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it('clamps and interpolates deterministically', () => {
    expect(nextgen.clamp(-1, 0, 1)).toBe(0);
    expect(nextgen.clamp(2, 0, 1)).toBe(1);
    expect(nextgen.saturate(-2)).toBe(0);
    expect(nextgen.saturate(2)).toBe(1);
    expect(nextgen.lerp(0, 10, 0.25)).toBe(2.5);
    expect(nextgen.lerp(0, 10, -1)).toBe(0);
    expect(nextgen.lerp(0, 10, 2)).toBe(10);
  });

  it('normalizes vectors without NaN propagation', () => {
    expect(nextgen.normalizeVec2({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(nextgen.normalizeVec3({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    const value = nextgen.normalizeVec3({ x: 3, y: 4, z: 0 });
    expect(value.x).toBeCloseTo(0.6);
    expect(value.y).toBeCloseTo(0.8);
    expect(value.z).toBe(0);
    expect(Number.isFinite(value.x)).toBe(true);
    expect(Number.isFinite(value.y)).toBe(true);
    expect(Number.isFinite(value.z)).toBe(true);
  });

  it('preserves object key ordering in canonical serialization', () => {
    const left = { z: 3, nested: { b: 2, a: 1 }, a: 1 };
    const right = { a: 1, nested: { a: 1, b: 2 }, z: 3 };
    expect(nextgen.stableStringify(left)).toBe(nextgen.stableStringify(right));
    expect(nextgen.stableChecksum(left)).toBe(nextgen.stableChecksum(right));
  });

  it('keeps arrays ordered while canonicalizing object members', () => {
    const first = { items: [{ b: 2, a: 1 }, { value: 9 }] };
    const second = { items: [{ a: 1, b: 2 }, { value: 9 }] };
    const reordered = { items: [{ value: 9 }, { a: 1, b: 2 }] };
    expect(nextgen.stableStringify(first)).toBe(nextgen.stableStringify(second));
    expect(nextgen.stableStringify(first)).not.toBe(nextgen.stableStringify(reordered));
  });

  it('keeps hashes bounded to unsigned integer space', () => {
    const values = ['', 'a', 'A', 'runtime', 'runtime:42', '世界'];
    for (const value of values) {
      const hash = nextgen.hashString(value);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('returns identical checksums across repeated runs', () => {
    const payload = {
      version: 3,
      tick: 1024,
      actors: [
        { id: 12, state: 'running', energy: 0.8 },
        { id: 18, state: 'sleeping', energy: 0.2 },
      ],
    };
    const expected = nextgen.stableChecksum(payload);
    for (let i = 0; i < 100; i += 1) expect(nextgen.stableChecksum(payload)).toBe(expected);
  });
});
