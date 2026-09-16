import { describe, expect, it } from 'vitest';
import { asEntityId, asTick, vec3 } from '../../src/3d/modern/v7/primitives.js';
import { RuntimeSecurity } from '../../src/3d/modern/v7/security.js';
import { DeterministicEventBus } from '../../src/3d/modern/v7/eventBus.js';
import { RuntimeTaskGraph } from '../../src/3d/modern/v7/taskGraph.js';
import { ResourceResidency } from '../../src/3d/modern/v7/resourceResidency.js';
import { SnapshotReplicationRuntime } from '../../src/3d/modern/v7/snapshotReplication.js';
import { QuestRuntime } from '../../src/3d/modern/v7/questRuntime.js';
import { SpatialAudioGraph } from '../../src/3d/modern/v7/audioGraph.js';
import { SceneLifecycleCoordinator } from '../../src/3d/modern/v7/sceneLifecycle.js';
import { PerformanceBudgetRuntime } from '../../src/3d/modern/v7/performanceBudget.js';
import { ReleaseGate } from '../../src/3d/modern/v7/releaseGate.js';
import { RecoveryCoordinator } from '../../src/3d/modern/v7/recovery.js';
import { TypedEcsWorld } from '../../src/3d/modern/v7/ecs.js';
import { TransactionalEditorRuntime, createEditorTransform } from '../../src/3d/modern/v7/editorRuntime.js';
import { RenderGraphCompiler } from '../../src/3d/modern/v7/rendererAdapter.js';
import { PresentationDirector } from '../../src/3d/modern/v7/presentationDirector.js';
import { LegacyModernBridge } from '../../src/3d/modern/v7/legacyBridge.js';
import { WorldStreamingDirector } from '../../src/3d/modern/v7/streamingDirector.js';
import { BoundedNavigationRuntime } from '../../src/3d/modern/v7/navigationRuntime.js';
import { MaterialRuntime } from '../../src/3d/modern/v7/materialRuntime.js';
import { DeterministicGameplaySimulation } from '../../src/3d/modern/v7/gameplaySimulation.js';
import { DeterministicCombatRuntime } from '../../src/3d/modern/v7/combatRuntime.js';

describe('security boundaries', () => {
  it('rejects cyclic payloads', () => { const value: any = {}; value.self = value; expect(new RuntimeSecurity().validatePayload(value).ok).toBe(false); });
  it('rejects oversized strings', () => { const security = new RuntimeSecurity({ maxStringLength: 64 }); expect(security.validatePayload({ value: 'x'.repeat(65) }).ok).toBe(false); });
  it('rejects oversized arrays', () => { const security = new RuntimeSecurity({ maxArrayLength: 3 }); expect(security.validatePayload([1, 2, 3, 4]).ok).toBe(false); });
  it('rejects URL credentials', () => expect(new RuntimeSecurity().checkUrl('https://u:p@example.com/a', 'asset').accepted).toBe(false));
  it('rejects worker URLs with unsupported extension', () => expect(new RuntimeSecurity().checkUrl('https://example.com/worker.txt', 'worker').accepted).toBe(false));
  it('rate limits repeated operations', () => { const security = new RuntimeSecurity(); expect(security.consumeRateLimit('x', { capacity: 1, refillPerSecond: .01 }, 0)).toBe(true); expect(security.consumeRateLimit('x', { capacity: 1, refillPerSecond: .01 }, 0)).toBe(false); });
});

describe('event and task pressure', () => {
  it('rejects huge event payloads', () => { const bus = new DeterministicEventBus({ payloadBytes: 16 }); expect(bus.publish('x', asTick(1), 't', { value: 'this is larger' }).ok).toBe(false); });
  it('keeps wildcard subscribers isolated', () => { const bus = new DeterministicEventBus(); let count = 0; bus.subscribe('*', () => { count += 1; }); bus.publish('a', asTick(1), 't', {}); bus.publish('b', asTick(2), 't', {}); expect(count).toBe(2); });
  it('detects dependency cycles', async () => { const graph = new RuntimeTaskGraph(); graph.register({ id: 'a', deps: [asTask('b')], priority: 1, costMs: 1, run: () => undefined }); graph.register({ id: 'b', deps: [asTask('a')], priority: 1, costMs: 1, run: () => undefined }); graph.enqueue(asTask('a')); graph.enqueue(asTask('b')); expect((await graph.run()).cycles.length).toBeGreaterThan(0); });
  it('cancels queued work', () => { const graph = new RuntimeTaskGraph(); graph.register({ id: 'a', deps: [], priority: 1, costMs: 1, run: () => undefined }); graph.enqueue(asTask('a')); expect(graph.cancel(asTask('a'))).toBe(true); expect(graph.stats().cancelled).toBe(1); });
});

describe('resources and streaming', () => {
  it('promotes a loading resource to resident', () => { const manager = new ResourceResidency({ maxBytes: 64 * 1024 * 1024 }); manager.register({ id: 'm', bytes: 1024, priority: 1, required: false, kind: 'model', dependencies: [], digest: 'aa' }); expect(manager.request('m' as any)).toBe(true); expect(manager.markLoading('m' as any)).toBe(true); expect(manager.complete('m' as any, 1024, 4, true)).toBe(true); expect(manager.get('m' as any)?.state).toBe('resident'); });
  it('does not evict required resources', () => { const manager = new ResourceResidency({ maxBytes: 8 * 1024 * 1024 }); manager.register({ id: 'core', bytes: 1024, priority: 100, required: true, kind: 'data', dependencies: [], digest: 'aa' }); manager.request('core' as any); manager.markLoading('core' as any); manager.complete('core' as any, 1024, 1); expect(manager.evict('core' as any)).toBe(false); });
  it('requires stream dependencies before start', () => { const stream = new WorldStreamingDirector(8 * 1024 * 1024, 2); stream.register({ id: 'dep' as any, priority: 10, bytes: 1024, required: false, dependencies: [], state: 'cold', lastUsedTick: 0 }); stream.register({ id: 'child' as any, priority: 20, bytes: 1024, required: false, dependencies: ['dep' as any], state: 'cold', lastUsedTick: 0 }); stream.request('child' as any, 'visible'); expect(stream.startNext(1)).toBe(null); });
  it('returns a bounded stream plan', () => { const stream = new WorldStreamingDirector(4096, 1); for (let i = 0; i < 10; i += 1) stream.register({ id: `r${i}` as any, priority: i, bytes: 1024, required: false, dependencies: [], state: 'cold', lastUsedTick: 0 }); for (let i = 0; i < 10; i += 1) stream.request(`r${i}` as any, 'prefetch'); expect(stream.plan(2048).loads.length).toBeLessThanOrEqual(1); });
});

describe('snapshots, quests and audio', () => {
  it('verifies snapshot checksums', () => { const snapshots = new SnapshotReplicationRuntime(); const snapshot = snapshots.capture(1, [{ id: asEntityId('a'), revision: 1, position: vec3(), velocity: vec3(), flags: 0 }]); expect(snapshots.verify(snapshot)).toBe(true); expect(snapshots.verify({ ...snapshot, checksum: 'x' })).toBe(false); });
  it('generates compact world deltas', () => { const snapshots = new SnapshotReplicationRuntime(); snapshots.capture(1, [{ id: asEntityId('a'), revision: 1, position: vec3(), velocity: vec3(), flags: 0 }]); snapshots.capture(2, [{ id: asEntityId('a'), revision: 2, position: vec3(1), velocity: vec3(), flags: 0 }]); const delta = snapshots.delta(1, 2); expect(delta?.changed).toHaveLength(1); });
  it('unlocks quest dependencies', () => { const quests = new QuestRuntime(); quests.register({ id: 'a', title: 'A', prerequisites: [], objectives: [{ id: 'o', kind: 'reach', target: 'x', required: 1, optional: false }], reward: {}, expiresAtTick: null }); quests.register({ id: 'b', title: 'B', prerequisites: ['a'], objectives: [{ id: 'o', kind: 'reach', target: 'y', required: 1, optional: false }], reward: {}, expiresAtTick: null }); const actor = asEntityId('hero'); expect(quests.accept(actor, 'a', 1)).toBe(true); quests.progress(actor, 'a', 'o', 1, 2); expect(quests.available(actor).map((quest) => quest.id)).toContain('b'); });
  it('virtualizes distant audio voices', () => { const audio = new SpatialAudioGraph(); audio.registerEmitter({ id: 'far', entity: null, position: vec3(1000, 0, 0), radius: 10, bus: 'sfx', gain: 1, priority: 0, occlusion01: 0, loop: false }); audio.play('far', 'clip'); const frame = audio.frame(); expect(frame.voices[0]?.virtualized).toBe(true); });
});

describe('scene and performance', () => {
  it('enforces scene transition order', async () => { const scene = new SceneLifecycleCoordinator(); scene.register({ name: 'renderer', priority: 1 }); expect(await scene.transition('ready')).toBe(false); expect(await scene.transition('loading')).toBe(true); expect(await scene.transition('ready')).toBe(true); });
  it('detects critical performance pressure', () => { const perf = new PerformanceBudgetRuntime(); perf.sample({ tick: 1, frameMs: 40, cpuMs: 30, gpuMs: 30, drawCalls: 2000, triangles: 3_000_000, memoryBytes: 1_000_000_000, networkBytes: 2_000_000, simulationMs: 20, audioVoices: 160 }); expect(perf.summary().budgetHealthy).toBe(false); });
  it('keeps release gate failures blocking', () => { const release = new ReleaseGate(); release.record({ name: 'typecheck', status: 'pass', blocking: true }); release.record({ name: 'tests', status: 'fail', blocking: true }); expect(release.evaluate('build', 'v7').ready).toBe(false); });
  it('respects recovery cooldown', () => { const recovery = new RecoveryCoordinator(1, 10); recovery.register({ domain: 'render', diagnose: () => true, quiesce: () => undefined, reset: () => undefined, restore: () => undefined, resume: () => undefined }); expect(recovery.recover(['render'], 0).success).toBe(true); expect(recovery.recover(['render'], 1).success).toBe(false); });
});

describe('ECS and editor', () => {
  it('rejects duplicate component registration', () => { const ecs = new TypedEcsWorld(); expect(ecs.registerComponent({ name: 'health', defaults: { value: 1 } }).ok).toBe(true); expect(ecs.registerComponent({ name: 'health', defaults: { value: 1 } }).ok).toBe(false); });
  it('supports component removal', () => { const ecs = new TypedEcsWorld(); ecs.registerComponent({ name: 'health', defaults: { value: 1 } }); const entity = ecs.create('hero'); if (entity.ok) { ecs.add(entity.value, 'health'); expect(ecs.remove(entity.value, 'health')).toBe(true); expect(ecs.has(entity.value, 'health')).toBe(false); } });
  it('creates and updates editor entities transactionally', () => { const editor = new TransactionalEditorRuntime(); const created = editor.create({ type: 'mesh', name: 'Hero', transform: createEditorTransform(), properties: {} }, 'designer'); expect(created.ok).toBe(true); if (created.ok) { editor.update(created.value.id, { name: 'Hero2' }, 'designer'); expect(editor.get(created.value.id)?.name).toBe('Hero2'); expect(editor.undo()).toBe(true); expect(editor.get(created.value.id)?.name).toBe('Hero'); } });
});

describe('render, materials and presentation', () => {
  it('compiles only resident render resources', () => { const renderer = new RenderGraphCompiler(); renderer.registerResource({ id: 'mesh', kind: 'buffer', bytes: 10, label: 'mesh' }); renderer.registerResource({ id: 'mat', kind: 'buffer', bytes: 10, label: 'mat' }); renderer.addPass({ name: 'opaque', reads: [], writes: [], packets: [{ id: 'draw', pipeline: 'p', material: 'mat', mesh: 'mesh', instances: 2, distance: 2, transparent: false, priority: 1 }], estimatedDraws: 0, estimatedTriangles: 0 }); expect(renderer.compile().passes[0]?.estimatedDraws).toBe(2); });
  it('rejects duplicate materials', () => { const materials = new MaterialRuntime(); const base = { id: 'mat', blend: 'opaque' as const, baseColor: [1, 1, 1, 1] as const, metallic: 0, roughness: .5, emissive: [0, 0, 0] as const, textureIds: [], doubleSided: false, alphaCutoff: .5 }; expect(materials.register(base).ok).toBe(true); expect(materials.register(base).ok).toBe(false); });
  it('produces a presentation camera behind the actor', () => { const director = new PresentationDirector(); const state = director.evaluate({ actor: asEntityId('hero'), position: vec3(0, 0, 0), velocity: vec3(0, 0, 1), facing: vec3(0, 0, 1), cue: 'locomotion' }); expect(state?.camera.position.z).toBeLessThan(0); });
});

describe('navigation and gameplay', () => {
  it('finds a deterministic grid path', () => { const nav = new BoundedNavigationRuntime({ width: 4, height: 4, cellSize: 1, walkable: () => true }); const path = nav.findPath(vec3(.1, 0, .1), vec3(2.1, 0, 2.1)); expect(path.complete).toBe(true); expect(path.points.length).toBeGreaterThan(1); });
  it('handles blocked navigation cells', () => { const nav = new BoundedNavigationRuntime({ width: 2, height: 2, cellSize: 1, walkable: (x, z) => !(x === 1 && z === 1) }); expect(nav.findPath(vec3(.1, 0, .1), vec3(1.1, 0, 1.1)).complete).toBe(false); });
  it('updates deterministic gameplay state', () => { const sim = new DeterministicGameplaySimulation({ tickRate: 60 }); sim.registerActor({ id: 'hero', position: vec3(), velocity: vec3(), facing: vec3(0, 0, 1), health: 100, stamina: 100, poise: 100, grounded: true, locomotion: 'idle', action: null, actionProgress: 0 }); sim.setInput(asEntityId('hero'), { move: vec3(1, 0, 0), look: vec3(1, 0, 0), sprint: false, jump: false, action: null }); sim.tick(4); expect(sim.actor(asEntityId('hero'))?.position.x).toBeGreaterThan(0); });
  it('enforces combat stamina costs', () => { const combat = new DeterministicCombatRuntime(); combat.register({ id: 'hero', health: 100, stamina: 10, poise: 100, phase: 'idle', action: null, progress: 0 }); expect(combat.request(asEntityId('hero'), 'heavy').accepted).toBe(false); expect(combat.request(asEntityId('hero'), 'light').accepted).toBe(true); });
});

describe('migration bridge invariants', () => {
  it('blocks failed parity', () => { const bridge = new LegacyModernBridge(); bridge.register({ id: 'world', owner: 'world', legacyPath: 'old', modernPath: 'new' }); bridge.markShadow('world'); const result = bridge.recordParity('world', 'a', 'b'); expect(result?.state).toBe('blocked'); expect(bridge.promote('world')).toBe(false); });
  it('requires verified parity before promotion', () => { const bridge = new LegacyModernBridge(); bridge.register({ id: 'audio', owner: 'audio', legacyPath: 'old', modernPath: 'new' }); bridge.markShadow('audio'); bridge.recordParity('audio', 'same', 'same'); expect(bridge.promote('audio')).toBe(true); });
});

function asTask(id: string) { return id as any; }
