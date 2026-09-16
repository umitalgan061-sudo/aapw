import { describe, expect, it } from 'vitest';
import { encodeJson, decodeJson, encodeChunk, decodeChunk, mergeBuffers, validateBuffer } from '../src/3d/modern/serialization';
import { selectRuntimeProfile, mergeRuntimeLimits, priorityForSubsystem } from '../src/3d/modern/runtimeConfig';
import { InputRecorder, createReplayCursor, replayDigest } from '../src/3d/modern/inputReplay';
import { SnapshotCodec } from '../src/3d/modern/networkSnapshot';
import { SpatialHash } from '../src/3d/modern/spatialHash';
import { planFrameBudget, FramePacer } from '../src/3d/modern/budgetPlanner';
import { AudioBusGraph } from '../src/3d/modern/audioBus';
import { WorldClock, createWindField } from '../src/3d/modern/worldSimulation';
import { validateAssetUrl, validateManifest, manifestDigest } from '../src/3d/modern/assetPolicy';
import { findPath } from '../src/3d/modern/navigationPlanner';

describe('serialization contracts', () => {
  it('round-trips json with an integrity envelope', () => {
    const bytes = encodeJson('test', { z: 2, a: 1 });
    const decoded = decodeJson<{ z: number; a: number }>(bytes, 'test');
    expect(decoded).toEqual({ ok: true, value: { z: 2, a: 1 } });
  });

  it('rejects corrupted chunk data', () => {
    const encoded = encodeChunk('world', { seed: 7, cells: [1, 2, 3] });
    encoded[encoded.length - 1] ^= 255;
    const decoded = decodeChunk(encoded, 'world');
    expect(decoded.ok).toBe(false);
  });

  it('merges buffers under an explicit budget', () => {
    const merged = mergeBuffers([new Uint8Array([1, 2]), new Uint8Array([3, 4])], 4);
    expect(merged).toEqual({ ok: true, value: new Uint8Array([1, 2, 3, 4]) });
    expect(validateBuffer(new Uint8Array(5), 4).ok).toBe(false);
  });
});

describe('runtime profiles', () => {
  it('uses conservative mobile and low-end profiles', () => {
    expect(selectRuntimeProfile({ coarsePointer: true, hardwareConcurrency: 8, deviceMemoryGb: 8 }).name).toBe('mobile');
    expect(selectRuntimeProfile({ hardwareConcurrency: 2, deviceMemoryGb: 2 }).name).toBe('low-end');
    expect(selectRuntimeProfile({ preferredBackend: 'headless' }).name).toBe('headless');
  });

  it('validates override limits and maps subsystem priorities', () => {
    const base = selectRuntimeProfile().limits;
    expect(mergeRuntimeLimits(base, { maxEntities: base.maxEntities + 1 }).maxEntities).toBe(base.maxEntities + 1);
    expect(() => mergeRuntimeLimits(base, { maxEntities: 0 })).toThrow();
    expect(priorityForSubsystem('input')).toBeGreaterThan(priorityForSubsystem('streaming'));
  });
});

describe('input replay', () => {
  it('records normalized intent and replays it in timestamp order', () => {
    const recorder = new InputRecorder();
    recorder.start();
    recorder.push({ action: 'move.right', value: 1, source: 'keyboard', timestamp: 3 as never });
    recorder.push({ action: 'move.forward', value: 1, source: 'touch', timestamp: 2 as never });
    const replay = recorder.stop();
    const cursor = createReplayCursor(replay);
    expect(cursor.next()?.action).toBe('move.forward');
    expect(cursor.next()?.action).toBe('move.right');
    expect(cursor.done()).toBe(true);
    expect(replayDigest(replay.actions)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('network snapshots', () => {
  it('produces deterministic deltas against a remembered baseline', () => {
    const codec = new SnapshotCodec(4);
    const base = codec.encode(1, [{ id: 'a' as never, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, flags: 1 }]);
    codec.remember(base);
    const current = codec.encode(2, [{ id: 'a' as never, position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 1, y: 0, z: 0 }, flags: 1 }, { id: 'b' as never, position: { x: 0, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, flags: 0 }]);
    const delta = codec.delta(current, 1);
    expect(delta.ok).toBe(true);
    if (delta.ok) expect(delta.value.changed.map((entity) => entity.id)).toEqual(['a', 'b']);
  });
});

describe('spatial hash and navigation', () => {
  it('returns only nearby entities in stable order', () => {
    const hash = new SpatialHash(2);
    hash.upsert('b' as never, { x: 9, y: 0, z: 0 });
    hash.upsert('a' as never, { x: 1, y: 0, z: 1 });
    expect(hash.query({ x: 0, y: 0, z: 0 }, 3).map((hit) => hit.id)).toEqual(['a']);
  });

  it('routes around blocked navigation cells', () => {
    const blocked = Array<boolean>(25).fill(false);
    blocked[7] = true; blocked[12] = true; blocked[17] = true;
    const path = findPath({ width: 5, height: 5, origin: { x: 0, y: 0 }, cellSize: 1, blocked }, { x: 0, z: 2 }, { x: 4, z: 2 });
    expect(path).not.toBeNull();
    expect(path?.nodes.some((node) => node.x === 2 && node.z === 2)).toBe(false);
  });
});

describe('frame budget and pacing', () => {
  it('reduces budgets under pressure', () => {
    const calm = planFrameBudget({ pressure: 0.1 });
    const stressed = planFrameBudget({ pressure: 0.9 });
    expect(stressed.cpuMs).toBeLessThan(calm.cpuMs);
    expect(stressed.maxVisibleObjects).toBeLessThan(calm.maxVisibleObjects);
  });

  it('tracks sustained over-budget frames', () => {
    const pacer = new FramePacer(16.67, 0.5);
    const result = pacer.observe(40);
    expect(result.overBudget).toBe(true);
    expect(result.consecutiveOver).toBe(1);
  });
});

describe('audio and world simulation', () => {
  it('applies master mute and child buses consistently', () => {
    const audio = new AudioBusGraph();
    const node = { gain: { value: 0 } };
    audio.attach('effects', node);
    audio.setVolume('effects', 0.5);
    expect(node.gain.value).toBe(0.5);
    audio.setVolume('master', 0.6);
    expect(node.gain.value).toBeCloseTo(0.3);
    audio.setMuted(true);
    expect(node.gain.value).toBe(0);
  });

  it('keeps world clock and wind field deterministic for equal inputs', () => {
    const a = new WorldClock({ secondsPerDay: 100, seed: 42 });
    const b = new WorldClock({ secondsPerDay: 100, seed: 42 });
    expect(a.update(12)).toEqual(b.update(12));
    const windA = createWindField(42).sample({ x: 1, y: 2, z: 3 }, 7);
    const windB = createWindField(42).sample({ x: 1, y: 2, z: 3 }, 7);
    expect(windA).toEqual(windB);
  });
});

describe('asset policy', () => {
  it('blocks cross-origin and invalid assets under strict policy', () => {
    expect(validateAssetUrl('/assets/a.glb', 'https://game.example/').ok).toBe(true);
    expect(validateAssetUrl('https://evil.example/a.glb', 'https://game.example/').ok).toBe(false);
    const manifest = [{ id: 'a', url: '/a.glb', kind: 'mesh', priority: 2 as const, tags: [], cache: 'immutable' as const, bytes: 128 }];
    expect(validateManifest(manifest).ok).toBe(true);
    expect(manifestDigest(manifest)).toMatch(/^[0-9a-f]{8}$/);
  });
});
