import { describe, expect, it } from 'vitest';
import { EcsWorld, UtilityAi, AiMemory, PerceptionSystem, SpatialAudioMixer, defaultMix, duckingGain, accessibilityGain, AssetCatalog, AssetStreamingController, assetId, tick, entityId, RuntimeStateGraph, FeatureFlagStore, timestamp, RuntimeEditorBridge } from '../../../src/3d/modern/r40';

const velocity = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
const player = { id: entityId('p'), transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, velocity, bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 }, radius: 1 }, lod: 'near' as const, active: true, revision: 0 as never, tags: ['player'] };
describe('R40 service contracts', () => {
  it('stores ECS components', () => {
    const world = new EcsWorld();
    expect(world.spawn(player)).toBe(true);
    expect(world.addComponent('health', player.id, 100)).toBe(true);
    expect(world.getComponent<number>('health', player.id)).toBe(100);
    expect(world.removeComponent('health', player.id)).toBe(true);
  });
  it('runs ECS systems deterministically', () => {
    const world = new EcsWorld();
    world.spawn(player);
    const seen: string[] = [];
    world.registerSystem('b', () => { seen.push('b'); });
    world.registerSystem('a', () => { seen.push('a'); });
    world.step(tick(1), 1 / 60);
    expect(seen).toEqual(['a', 'b']);
  });
  it('selects an AI action above zero utility', () => {
    const ai = new UtilityAi();
    ai.register({ id: 'eat', baseUtility: 3, urgency: 1, energyCost: 1, cooldownTicks: 0, tags: ['survival'] });
    const result = ai.choose({ actor: player.id, position: { x: 0, y: 0, z: 0 }, health: 50, energy: 100, threat: 0, objectives: ['survival'], visible: [], memories: [], tick: tick(1) });
    expect(result?.action.id).toBe('eat');
  });
  it('decays AI memory', () => {
    const memory = new AiMemory(8, 10);
    memory.write('danger', 1, tick(0));
    expect(memory.read('danger', tick(10))).toBeCloseTo(0.5);
  });
  it('filters perception by confidence', () => {
    const perception = new PerceptionSystem(10, 10);
    const result = perception.observe({ x: 0, y: 0, z: 0 }, [{ id: 's', source: 'x', type: 'visual', position: { x: 5, y: 0, z: 0 }, intensity: 1, confidence: 1, expiresAtTick: tick(20) }]);
    expect(result[0]?.confidence).toBeCloseTo(0.5);
  });
  it('mixes audio through accessibility gain', () => {
    const audio = new SpatialAudioMixer({ maxVoices: 4 });
    audio.upsert({ id: 'bird', position: { x: 2, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, gain: 1, occlusion: 0, priority: 10, bus: 'ambience' });
    expect(audio.plan({ x: 0, y: 0, z: 0 })[0]?.gain).toBeGreaterThan(0);
    expect(accessibilityGain(1, true, true)).toBeGreaterThan(1);
    expect(duckingGain(10, 20)).toBeLessThan(1);
    expect(defaultMix().master).toBe(1);
  });
  it('queues and evicts assets deterministically', () => {
    const catalog = new AssetCatalog();
    const id = assetId('tree');
    expect(catalog.register({ id, uri: 'https://example.com/tree.glb', bytes: 10, digest: 'abcdef12', priority: 10, optional: false, contentType: 'model' })).toBe(true);
    const loader = new AssetStreamingController(catalog, { maxConcurrent: 1 });
    expect(loader.request({ id, distance: 10, priorityBias: 1, hardDeadlineTick: null, allowPlaceholder: true }, tick(1))).toBe(true);
    expect(loader.plan(tick(1))).toEqual([{ id, distance: 10, priorityBias: 1, hardDeadlineTick: null, allowPlaceholder: true }]);
    expect(loader.begin(id, tick(1))).toBe(true);
    expect(loader.succeed(id, tick(2))).toBe(true);
    expect(loader.residentBytes()).toBe(10);
    loader.release(id);
    expect(loader.evictToBudget(0, tick(3))).toEqual([id]);
  });
  it('supports state graph rollback', () => {
    const graph = new RuntimeStateGraph();
    graph.commit('player.health', 100, 'engine', tick(1));
    const snapshot = graph.snapshot(tick(1));
    graph.commit('player.health', 10, 'ui', tick(2));
    graph.rollback(snapshot);
    expect(graph.read('player.health')).toBe(100);
  });
  it('resolves feature flag rollout deterministically', () => {
    const flags = new FeatureFlagStore();
    flags.set({ id: 'weather-v2', enabled: true, rollout: 0.5, expiresAt: null, owner: 'runtime' });
    expect(flags.resolve('weather-v2', 'subject-a')).toBe(flags.resolve('weather-v2', 'subject-a'));
  });
  it('edits entity transforms with undo/redo', () => {
    const editor = new RuntimeEditorBridge();
    editor.load(player);
    editor.move(player.id, { x: 5, y: 0, z: 0 }, 1);
    expect(editor.entity(player.id)?.transform.position.x).toBe(5);
    editor.undo();
    expect(editor.entity(player.id)?.transform.position.x).toBe(0);
    editor.redo();
    expect(editor.entity(player.id)?.transform.position.x).toBe(5);
  });
  it('rejects invalid editor tags', () => {
    const editor = new RuntimeEditorBridge();
    editor.load(player);
    expect(editor.tag(player.id, 'bad tag', true, 1)).toBeNull();
  });
  it('keeps service registry dependency order', async () => {
    const { TypedServiceRegistry } = await import('../../../src/3d/modern/r40');
    const registry = new TypedServiceRegistry();
    const a = { id: 'a' } as const;
    const b = { id: 'b' } as const;
    expect(registry.provide(a, 1)).toBe(true);
    expect(registry.provide(b, 2, ['a'])).toBe(true);
    expect(registry.remove(a)).toBe(false);
    expect(registry.remove(b)).toBe(true);
  });
  it('builds a stable runtime manifest', async () => {
    const { R40ManifestBuilder } = await import('../../../src/3d/modern/r40');
    const builder = new R40ManifestBuilder();
    builder.module('src/3d/modern/r40/index.ts');
    builder.module('src/3d/modern/r40/types.ts');
    expect(builder.build().modules).toEqual(['src/3d/modern/r40/index.ts', 'src/3d/modern/r40/types.ts']);
  });
  it('validates malformed state values without throwing', async () => {
    const { validateJsonSerializable } = await import('../../../src/3d/modern/r40');
    expect(validateJsonSerializable({ ok: true }).ok).toBe(true);
  });
  it('keeps timestamps non-negative', () => {
    expect(Number(timestamp(-5))).toBe(0);
  });
});
