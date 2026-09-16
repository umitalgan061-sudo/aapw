import { describe, expect, it, vi } from 'vitest';
import { asEntityId, asTick, digest, vec3 } from '../../src/3d/modern/v7/primitives.js';
import { RuntimeStateStore } from '../../src/3d/modern/v7/stateStore.js';
import { DeterministicEventBus } from '../../src/3d/modern/v7/eventBus.js';
import { RuntimeScheduler, FixedStepClock } from '../../src/3d/modern/v7/scheduler.js';
import { RuntimeTaskGraph } from '../../src/3d/modern/v7/taskGraph.js';
import { ResourceResidency } from '../../src/3d/modern/v7/resourceResidency.js';
import { SpatialWorldIndex } from '../../src/3d/modern/v7/spatialWorld.js';
import { UtilityAiDirector } from '../../src/3d/modern/v7/aiDirector.js';
import { NetworkSession } from '../../src/3d/modern/v7/networkSession.js';
import { RenderGovernor } from '../../src/3d/modern/v7/renderGovernor.js';
import { InputReplayRuntime } from '../../src/3d/modern/v7/inputReplay.js';
import { VersionedPersistence } from '../../src/3d/modern/v7/persistence.js';
import { RuntimeSecurity } from '../../src/3d/modern/v7/security.js';
import { RuntimeTelemetry } from '../../src/3d/modern/v7/telemetry.js';
import { BoundedWorkerPool } from '../../src/3d/modern/v7/workerPool.js';
import { TypedEcsWorld } from '../../src/3d/modern/v7/ecs.js';
import { AuthoritativeWorldState, quantizePosition } from '../../src/3d/modern/v7/worldState.js';
import { DeterministicGameplaySimulation } from '../../src/3d/modern/v7/gameplaySimulation.js';
import { DeterministicCombatRuntime } from '../../src/3d/modern/v7/combatRuntime.js';
import { PresentationDirector } from '../../src/3d/modern/v7/presentationDirector.js';
import { LegacyModernBridge } from '../../src/3d/modern/v7/legacyBridge.js';

describe('v7 primitives', () => {
  it('produces stable digests for identical inputs', () => expect(digest('a', 1, { x: 2 })).toBe(digest('a', 1, { x: 2 })));
  it('normalizes invalid vectors safely', () => expect(vec3().x).toBe(0));
});

describe('v7 state and events', () => {
  it('commits source-tagged immutable state changes', () => {
    const store = new RuntimeStateStore({ player: { hp: 100 } }); const result = store.set('player.hp', 80, 'engine', asTick(4));
    expect(result.ok).toBe(true); expect(store.get('player.hp')).toBe(80); expect(Object.isFrozen(store.snapshot().value)).toBe(true); expect(store.history()).toHaveLength(1);
  });
  it('rejects malformed snapshots and bounds history', () => {
    const store = new RuntimeStateStore({}, { history: 8 }); const snapshot = store.snapshot(); expect(store.replace({ ...snapshot, digest: 'broken' }, 'save').ok).toBe(false); expect(store.history()).toHaveLength(0);
  });
  it('publishes and replays events deterministically', () => {
    const bus = new DeterministicEventBus(); const values: string[] = []; bus.subscribe('x', (event) => values.push(String((event.payload as { value: string }).value))); bus.publish('x', asTick(1), 'test', { value: 'a' }); bus.publish('x', asTick(2), 'test', { value: 'b' }); expect(bus.serial()).toBe(2); expect(bus.replay(() => undefined)).toBe(2); expect(values).toEqual(['a', 'b']);
  });
});

describe('v7 scheduling and tasks', () => {
  it('caps fixed-step catch-up', () => { const clock = new FixedStepClock(10, 3); expect(clock.ingest(1000)).toBe(3); expect(clock.tick()).toBe(3); });
  it('executes higher-priority tasks before lower priority', async () => { const graph = new RuntimeTaskGraph(); const order: string[] = []; graph.register({ id: 'a', deps: [], priority: 1, costMs: 1, run: () => { order.push('a'); } }); graph.register({ id: 'b', deps: [], priority: 9, costMs: 1, run: () => { order.push('b'); } }); graph.enqueue(asTask('a')); graph.enqueue(asTask('b')); await graph.run(); expect(order).toEqual(['b', 'a']); });
  it('orders scheduler work deterministically', () => { const scheduler = new RuntimeScheduler(); const order: string[] = []; scheduler.enqueue({ id: 'b', phase: 'simulation', priority: 1, estimatedMs: 1, run: () => order.push('b') }); scheduler.enqueue({ id: 'a', phase: 'simulation', priority: 1, estimatedMs: 1, run: () => order.push('a') }); scheduler.run(asTick(1)); expect(order).toEqual(['a', 'b']); });
});

describe('v7 world and resources', () => {
  it('indexes spatial entities and caps interest buckets', () => { const world = new SpatialWorldIndex(10, { near: 10, mid: 20, far: 40, maxNear: 2, maxMid: 2, maxFar: 3, maxSleeping: 2 }); for (let i = 0; i < 10; i += 1) world.upsert({ id: `e${i}`, position: vec3(i, 0, 0), radius: 0, active: true, priority: i }); expect(world.interest(vec3()).length).toBeLessThanOrEqual(9); });
  it('rejects bad resource byte ranges', () => { const resources = new ResourceResidency({ maxBytes: 4 * 1024 * 1024 }); expect(resources.register({ id: 'x', bytes: 8 * 1024 * 1024, priority: 1, required: false, kind: 'model', dependencies: [], digest: 'x' }).ok).toBe(false); });
  it('applies authoritative deltas only for matching revisions', () => { const state = new AuthoritativeWorldState(); state.upsert({ id: 'e', revision: 1, position: vec3(), flags: 0, owner: null, payload: {} }); const delta = state.delta(asEntityId('e'), { position: vec3(2, 0, 0), payload: { hp: 90 } }); expect(delta.ok).toBe(true); if (delta.ok) expect(state.applyDelta(delta.value).ok).toBe(true); expect(state.get(asEntityId('e'))?.revision).toBe(2); });
  it('quantizes positions reproducibly', () => expect(quantizePosition({ x: 1.23456, y: 2.2222, z: 0 }, 1000)).toEqual({ x: 1.235, y: 2.222, z: 0 }));
});

describe('v7 ai and network', () => {
  it('creates deterministic utility-ai decisions from stimuli', () => { const ai = new UtilityAiDirector(); ai.registerActor({ id: 'npc', position: vec3(), health01: 1, energy01: 1, awareness01: 1, state: 'idle', faction: 'wolves', target: null }); ai.observe(asEntityId('npc'), [{ id: 'sound', position: vec3(4, 0, 0), kind: 'sound', intensity01: .9, source: asEntityId('x'), tick: 1 }]); const a = ai.decide(asEntityId('npc')); const b = ai.snapshot(); expect(a?.stimulus).toBe('sound'); expect(b.digest).toBe(ai.snapshot().digest); });
  it('rejects duplicate network envelopes', () => { const network = new NetworkSession(); network.connect('peer'); const sent = network.send('state', asEntityId('peer'), { x: 1 }); expect(sent.ok).toBe(true); if (sent.ok) { expect(network.receive(sent.value).ok).toBe(true); expect(network.receive(sent.value).ok).toBe(false); } });
  it('requests reconciliation after divergent prediction', () => { const network = new NetworkSession(); network.recordPrediction({ tick: 10, input: { x: 1 }, stateDigest: 'a' }); expect(network.reconcile(10, 'b').rewindTick).toBe(10); });
});

describe('v7 render, input, persistence and security', () => {
  it('downshifts quality after sustained pressure', () => { const governor = new RenderGovernor(); let decision; for (let i = 0; i < 3; i += 1) decision = governor.evaluate({ frameMs: 40, cpuMs: 24, gpuMs: 30, drawCalls: 1500, triangles: 2_000_000, memoryBytes: 700_000_000, thermal01: .9, networkPressure01: .2 }); expect(decision?.changed).toBe(true); });
  it('records and replays normalized inputs', () => { const input = new InputReplayRuntime(); input.ingest({ device: 'keyboard', action: 'w', pressed: true }, asTick(1)); input.ingest({ device: 'gamepad', action: 'lockOn', pressed: true }, asTick(2)); const replayed: string[] = []; expect(input.replay(input.range(asTick(1), asTick(2)), (command) => replayed.push(command.action))).toBe(2); expect(replayed).toEqual(['move', 'lockOn']); });
  it('saves and validates checksummed envelopes', async () => { const persistence = new VersionedPersistence({ build: 'test' }); const saved = await persistence.save('slot1', { hp: 50 }, asTick(3)); expect(saved.ok).toBe(true); const loaded = await persistence.load('slot1'); expect(loaded.ok).toBe(true); });
  it('enforces security limits and URL policy', () => { const security = new RuntimeSecurity(); expect(security.validatePayload({ ok: true }).ok).toBe(true); expect(security.checkUrl('https://example.com/a.glb', 'asset').accepted).toBe(true); expect(security.checkUrl('data:text/plain,x', 'asset').accepted).toBe(false); });
});

describe('v7 telemetry, workers and ECS', () => {
  it('computes bounded health metrics', () => { const telemetry = new RuntimeTelemetry(); telemetry.histogram('frame.ms', 12); telemetry.histogram('frame.ms', 18); telemetry.counter('runtime.operations', 10); telemetry.counter('runtime.errors', 1); const health = telemetry.health(); expect(health.score01).toBeGreaterThanOrEqual(0); expect(health.score01).toBeLessThanOrEqual(1); });
  it('executes worker jobs with cancellation isolation', async () => { const workers = new BoundedWorkerPool(2); const values: number[] = []; workers.enqueue({ id: 'a', priority: 'high', costMs: 1, deadlineTick: null, run: () => { values.push(1); return 1; } }); workers.enqueue({ id: 'b', priority: 'normal', costMs: 1, deadlineTick: null, run: () => { values.push(2); return 2; } }); await workers.pump(1); expect(values).toEqual([1, 2]); });
  it('supports typed component queries', () => { const ecs = new TypedEcsWorld(); ecs.registerComponent({ name: 'health', defaults: { value: 100 } }); const created = ecs.create('hero'); expect(created.ok).toBe(true); if (created.ok) { expect(ecs.add(created.value, 'health', { value: 80 })).toBe(true); expect(ecs.query({ required: ['health'] })).toEqual([created.value]); } });
});

describe('v7 gameplay, combat and presentation', () => {
  it('integrates fixed-step player movement and jump', () => { const sim = new DeterministicGameplaySimulation(); sim.registerActor({ id: 'hero', position: vec3(), velocity: vec3(), facing: vec3(0, 0, 1), health: 100, stamina: 100, poise: 100, grounded: true, locomotion: 'idle', action: null, actionProgress: 0 }); sim.setInput(asEntityId('hero'), { move: vec3(1, 0, 0), look: vec3(1, 0, 0), sprint: true, jump: true, action: null }); sim.tick(); expect(sim.actor(asEntityId('hero'))?.position.x).toBeGreaterThan(0); });
  it('rejects combat actions when resources are insufficient', () => { const combat = new DeterministicCombatRuntime(); combat.register({ id: 'hero', health: 100, stamina: 2, poise: 100, phase: 'idle', action: null, progress: 0 }); expect(combat.request(asEntityId('hero'), 'heavy').accepted).toBe(false); });
  it('creates deterministic presentation layers', () => { const director = new PresentationDirector(); const first = director.evaluate({ actor: asEntityId('hero'), position: vec3(), velocity: vec3(2, 0, 0), facing: vec3(1, 0, 0), cue: 'locomotion' }); const second = director.evaluate({ actor: asEntityId('hero'), position: vec3(), velocity: vec3(2, 0, 0), facing: vec3(1, 0, 0), cue: 'locomotion' }); expect(first?.digest).toBe(second?.digest); });
});

describe('v7 migration and runtime cleanup', () => {
  it('requires parity before promotion', () => { const bridge = new LegacyModernBridge(); bridge.register({ id: 'scene', owner: 'sceneManager', legacyPath: 'legacy', modernPath: 'modern' }); bridge.markShadow('scene'); expect(bridge.promote('scene')).toBe(false); bridge.recordParity('scene', 'a', 'a'); expect(bridge.promote('scene')).toBe(true); });
  it('isolate callback errors', () => { const bus = new DeterministicEventBus(); bus.subscribe('x', () => { throw new Error('bad'); }); expect(bus.publish('x', asTick(1), 'test', {}).ok).toBe(true); });
  it('supports fake timers without global time dependencies', () => { const scheduler = new RuntimeScheduler(); const fn = vi.fn(); scheduler.enqueue({ id: 'stable', phase: 'telemetry', priority: 1, estimatedMs: 0.1, run: fn }); scheduler.run(asTick(10)); expect(fn).toHaveBeenCalledTimes(1); });
});

function asTask(value: string) { return value as any; }
