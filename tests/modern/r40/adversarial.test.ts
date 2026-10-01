import { describe, expect, it } from 'vitest';
import { SecurityGate, RuntimeStateGraph, SpatialEntityWorld, AssetCatalog, entityId, assetId, tick, commandId, commandReplayKey, validateJsonSerializable } from '../../../src/3d/modern/r40';

describe('R40 adversarial and bounded-failure behavior', () => {
  it('caps object keys', () => {
    const value = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['k' + i, i]));
    expect(new SecurityGate({ maxKeys: 32 }).validatePayload(value).accepted).toBe(false);
  });
  it('caps array items', () => {
    expect(new SecurityGate({ maxArray: 8 }).validatePayload(Array.from({ length: 9 }, (_, i) => i)).accepted).toBe(false);
  });
  it('caps strings', () => {
    expect(new SecurityGate({ maxString: 8 }).validatePayload('123456789').accepted).toBe(false);
  });
  it('caps serialized bytes', () => {
    expect(new SecurityGate({ maxPayloadBytes: 16 }).validatePayload({ value: '123456789' }).accepted).toBe(false);
  });
  it('rejects invalid command types', () => {
    const gate = new SecurityGate();
    expect(gate.checkCommandType('../escape').accepted).toBe(false);
    expect(gate.checkCommandType('player.move').accepted).toBe(true);
  });
  it('rejects malformed runtime paths', () => {
    const graph = new RuntimeStateGraph();
    expect(graph.commit('../escape', true, 'system', tick(1))).toBeNull();
  });
  it('allows bounded nested graph paths', () => {
    const graph = new RuntimeStateGraph({ maxDepth: 4 });
    expect(graph.commit('a.b.c.d', true, 'system', tick(1))).not.toBeNull();
    expect(graph.commit('a.b.c.d.e', true, 'system', tick(1))).toBeNull();
  });
  it('rejects conflicting graph child shapes', () => {
    const graph = new RuntimeStateGraph();
    expect(graph.commit('a', true, 'system', tick(1))).not.toBeNull();
    expect(graph.commit('a.b', true, 'system', tick(2))).toBeNull();
  });
  it('caps world entities', () => {
    const world = new SpatialEntityWorld({ maxEntities: 1 });
    const make = (id: string) => ({ id: entityId(id), transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, velocity: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }, bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 }, radius: 1 }, lod: 'near' as const, active: true, revision: 0 as never, tags: [] as string[] });
    expect(world.upsert(make('a'))).toBe(true);
    expect(world.upsert(make('b'))).toBe(false);
  });
  it('caps asset queue depth', () => {
    const catalog = new AssetCatalog();
    const loader = new (await import('../../../src/3d/modern/r40')).AssetStreamingController(catalog, { maxQueue: 1 });
    const entry = (id: string) => ({ id: assetId(id), uri: 'https://example.com/' + id + '.glb', bytes: 10, digest: 'abcdef12', priority: 1, optional: true, contentType: 'model' as const });
    catalog.register(entry('a')); catalog.register(entry('b'));
    expect(loader.request({ id: assetId('a'), distance: 1, priorityBias: 0, hardDeadlineTick: null, allowPlaceholder: true }, tick(1))).toBe(true);
    expect(loader.request({ id: assetId('b'), distance: 1, priorityBias: 0, hardDeadlineTick: null, allowPlaceholder: true }, tick(1))).toBe(false);
  });
  it('keeps replay keys deterministic', () => {
    const key = commandReplayKey({ id: commandId('x'), tick: tick(2), actor: null, type: 'x', payload: {}, sequence: 3, predictionKey: null });
    expect(key).toBe('2:3:x');
  });
  it('returns validation report for normal values', () => {
    expect(validateJsonSerializable({ x: 1 }).ok).toBe(true);
  });
});
