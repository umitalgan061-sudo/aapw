import { describe, expect, it, beforeEach } from 'vitest';
import { tick } from '../../src/3d/modern/next/types.ts';
import { InputButton } from '../../src/3d/modern/next/input.ts';
import { ProductionEntityRegistry } from '../../src/3d/modern/next/production/entityRegistry.ts';
import { ProductionRenderPlanner } from '../../src/3d/modern/next/production/renderRuntime.ts';
import { ProductionNetworkRuntime } from '../../src/3d/modern/next/production/networkRuntime.ts';
import { MemoryPersistenceStore, ProductionPersistenceRuntime } from '../../src/3d/modern/next/production/persistenceRuntime.ts';
import { ProductionObservability } from '../../src/3d/modern/next/production/observability.ts';
import { ProductionLifecycleSupervisor, createLifecycleIdentity } from '../../src/3d/modern/next/production/lifecycle.ts';
import { ProductionRuntimeController } from '../../src/3d/modern/next/production/runtimeController.ts';
import { LegacyRuntimeBridge } from '../../src/3d/modern/next/production/browserBridge.ts';
import { ProductionDiagnosticsService } from '../../src/3d/modern/next/production/diagnostics.ts';

describe('ProductionEntityRegistry', () => {
  it('keeps bounded visibility deterministic', () => {
    const registry = new ProductionEntityRegistry({ maxEntities: 100, maxVisibleEntities: 2 });
    registry.create({ id: 1, position: { x: 0, y: 0, z: 0 } });
    registry.create({ id: 2, position: { x: 5, y: 0, z: 0 } });
    registry.create({ id: 3, position: { x: 10, y: 0, z: 0 } });
    registry.frameUpdate(1, tick(1), { x: 0, y: 0, z: 0 }, 100);
    expect(registry.visibleIds()).toEqual([1,2]);
    expect(registry.stats().visible).toBe(2);
  });

  it('restores bounded entity snapshots', () => {
    const registry = new ProductionEntityRegistry({ maxEntities: 4 });
    registry.create({ id: 1, health: 10 });
    registry.create({ id: 2, health: 20 });
    const snapshot = registry.snapshot();
    registry.clear();
    registry.restore(snapshot);
    expect(registry.all()).toHaveLength(2);
    expect(registry.get(2)?.health).toBe(20);
  });
});

describe('ProductionRenderPlanner', () => {
  it('sorts critical entities ahead of distant entities', () => {
    const registry = new ProductionEntityRegistry({ maxEntities: 10, maxVisibleEntities: 10 });
    registry.create({ id: 3, position: { x: 200, y: 0, z: 0 } });
    registry.create({ id: 1, position: { x: 2, y: 0, z: 0 } });
    registry.create({ id: 2, position: { x: 50, y: 0, z: 0 } });
    registry.frameUpdate(1, tick(1), { x:0, y:0, z:0 }, 700);
    const planner = new ProductionRenderPlanner({ maxVisibleEntities: 10 });
    const plan = planner.plan({
      tick: tick(1),
      alpha: 0.5,
      camera: { x:0, y:0, z:0 },
      entities: registry.all(),
      tier: 'high',
      capabilities: { maxTextureSize: 4096, supportsInstancing: true, supportsWebGL2: true },
    });
    expect(plan.commands[0]?.id).toBe(1);
    expect(planner.stats().visibleEntities).toBe(3);
  });
});

describe('ProductionNetworkRuntime', () => {
  it('creates initial snapshot packets and a later delta', () => {
    const runtime = new ProductionNetworkRuntime({ session: 'test', snapshotRateHz: 20 });
    runtime.connect('peer-a', 'loopback', 0);
    const first = {
      tick: tick(4),
      entities: [{ id: 1 as any, x:0, y:0, z:0, yaw:0, flags:0 }],
    };
    const second = {
      tick: tick(8),
      entities: [{ id: 1 as any, x:1, y:0, z:0, yaw:0, flags:0 }],
    };
    const p1 = runtime.createSnapshotPacket('peer-a', first, 100);
    const p2 = runtime.createSnapshotPacket('peer-a', second, 200);
    expect(p1?.payload.kind).toBe('snapshot');
    expect(p2?.payload.kind).toBe('delta');
    expect(runtime.stats().generatedSnapshots).toBe(2);
  });

  it('rejects packets from the wrong session', () => {
    const runtime = new ProductionNetworkRuntime({ session: 'good' });
    runtime.connect('peer', 'loopback', 0);
    const accepted = runtime.receive('peer', {
      protocol: 3,
      session: 'bad',
      sequence: 1,
      ack: 0,
      sentTick: tick(1),
      kind: 'event',
      payload: {},
    }, tick(1), 10);
    expect(accepted).toBe(false);
  });
});

describe('ProductionPersistenceRuntime', () => {
  let store: MemoryPersistenceStore;
  let persistence: ProductionPersistenceRuntime;

  beforeEach(() => {
    store = new MemoryPersistenceStore();
    persistence = new ProductionPersistenceRuntime(store, { application: 'aapw' });
  });

  it('round-trips a versioned save envelope', async () => {
    const identity = createLifecycleIdentity({ build: 'test' });
    const descriptor = await persistence.save('slot-1', 'manual', identity, {
      position: { x:1,y:2,z:3 },
      health: 90,
      stamina: 80,
      flags: 2,
      entities: [],
      tick: tick(9),
    }, 1234);
    const loaded = await persistence.load('slot-1');
    expect(descriptor.checksum).toBe(loaded?.descriptor.checksum);
    expect(loaded?.state.health).toBe(90);
  });

  it('rejects checksum corruption without throwing into callers', async () => {
    const identity = createLifecycleIdentity();
    await persistence.save('slot-1', 'manual', identity, {
      position: {x:0,y:0,z:0},
      health: 50,
      stamina: 50,
      flags: 0,
      entities: [],
      tick: tick(1),
    }, 1);
    const encoded = await persistence.exportSlot('slot-1');
    await store.write('slot-1', encoded!.replace('"health":50','"health":51'));
    expect(await persistence.load('slot-1')).toBeUndefined();
    expect(persistence.stats().failures).toBe(1);
  });
});

describe('ProductionLifecycleSupervisor', () => {
  it('orders hooks deterministically and pauses in reverse order', async () => {
    const order: string[] = [];
    const lifecycle = new ProductionLifecycleSupervisor({ identity:createLifecycleIdentity(), recoveryAttempts:2, faultAfterFailures:3 });
    lifecycle.register({ id:'a', subsystem:'simulation', priority:10, failurePolicy:'fault-runtime', start:()=>order.push('start-a'), pause:()=>order.push('pause-a'), resume:()=>order.push('resume-a'), stop:()=>order.push('stop-a') });
    lifecycle.register({ id:'b', subsystem:'render', priority:20, failurePolicy:'degrade', start:()=>order.push('start-b'), pause:()=>order.push('pause-b'), resume:()=>order.push('resume-b'), stop:()=>order.push('stop-b') });
    await lifecycle.start();
    await lifecycle.pause();
    await lifecycle.resume();
    await lifecycle.stop();
    expect(order).toEqual(['start-a','start-b','pause-b','pause-a','resume-a','resume-b','stop-b','stop-a']);
  });
});

describe('ProductionObservability', () => {
  it('records failures and produces subsystem health', () => {
    const identity = createLifecycleIdentity();
    const observability = new ProductionObservability();
    observability.recordFailure({ subsystem:'network', policy:'degrade', message:'x', tick:tick(1), recoverable:true });
    const health = observability.frame(
      {tick:tick(1), simTimeSeconds:0.016, wallTimeMs:16, frameIndex:1, deltaSeconds:0.016},
      {targetFrameMs:16.6, frame:{simulationMs:2,renderMs:8,streamingMs:1,networkMs:2,totalMs:13},workerMs:0,memoryBytes:0,render:{tier:'high',pixelRatio:1.75,shadowMapSize:3072,visibleDistance:0.9,vegetationDensity:0.85,effectsDensity:0.9,lodBias:0.15}},
      identity,
      {render:{maxTextureSize:4096,supportsInstancing:true,supportsWebGL2:true},crossOriginIsolated:false,hardwareConcurrency:4,deviceMemoryGb:4,maxTouchPoints:0,supportsWorkers:true,supportsSharedArrayBuffer:false,prefersReducedMotion:false},
      3, 2, 1, 0, [],
    );
    expect(health.subsystems.find((entry)=>entry.subsystem==='network')?.level).toBe('degraded');
  });
});

describe('ProductionRuntimeController', () => {
  it('coordinates simulation, input, entity, render and diagnostics', async () => {
    const runtime = new ProductionRuntimeController({ identity:{build:'test'}, maxEntities:16, maxVisibleEntities:8 });
    const started: string[] = [];
    runtime.events.on('started', () => started.push('started'));
    runtime.createEntity({ id:1, position:{x:0,y:0,z:0} });
    await runtime.start();
    expect(started).toEqual(['started']);
    expect(runtime.submitInput({ tick:tick(0), moveX:1, moveZ:0, lookX:0, lookY:0, buttons:InputButton.Sprint })).toBe(true);
    const frame = await runtime.frame({
      deltaSeconds: 1/60,
      input:{tick:tick(0),moveX:1,moveZ:0,lookX:0,lookY:0,buttons:InputButton.Sprint},
      budget:{simulationMs:2,renderMs:7,streamingMs:1,networkMs:1,totalMs:11},
    });
    expect(frame.mode).toBe('running');
    expect(frame.renderPlan.commands.length).toBeGreaterThanOrEqual(0);
    expect(runtime.stats().entities).toBe(1);
    await runtime.dispose();
  });

  it('creates and persists a snapshot', async () => {
    const store = new MemoryPersistenceStore();
    const runtime = new ProductionRuntimeController({}, {}, store);
    runtime.createEntity({ id:5, position:{x:5,y:0,z:2}, health:77 });
    await runtime.start();
    const saved = await runtime.save('quick', 'manual');
    expect(saved.slot).toBe('quick');
    const loaded = await runtime.load('quick');
    expect(loaded?.state.health).toBe(77);
    await runtime.dispose();
  });
});

describe('LegacyRuntimeBridge', () => {
  it('imports a legacy player-shaped object and mirrors frame state', async () => {
    const legacy = {
      paused:false,
      elapsedSeconds:0,
      camera:{position:{x:0,y:0,z:0}},
      player:{object3D:{position:{x:4,y:2,z:-1},rotation:{y:0.5}}},
      entities:[],
    };
    const controller = new ProductionRuntimeController({maxEntities:8,maxVisibleEntities:8});
    const bridge = new LegacyRuntimeBridge(controller, legacy);
    bridge.attach(legacy);
    await bridge.start();
    const result = await bridge.frame({
      deltaSeconds:1/60,
      nowMs:16,
      budget:{simulationMs:1,renderMs:2,streamingMs:1,networkMs:0},
    });
    expect(result.health.identity.application).toBe('aapw');
    expect(legacy.qualityTier).toBe(result.renderPlan.tier);
    expect(legacy.elapsedSeconds).toBeGreaterThanOrEqual(0);
    bridge.dispose();
  });
});

describe('ProductionDiagnosticsService', () => {
  it('builds deterministic JSON snapshots and recommendations', async () => {
    const runtime = new ProductionRuntimeController({maxEntities:4});
    runtime.createEntity({id:1});
    await runtime.start();
    const diagnostics = new ProductionDiagnosticsService(runtime, {historySize:8});
    await runtime.frame({
      deltaSeconds:1/60,
      budget:{simulationMs:3,renderMs:12,streamingMs:1,networkMs:0,totalMs:16},
    });
    const snapshot = diagnostics.capture();
    const exported = diagnostics.exportJson();
    const evaluation = diagnostics.evaluate();
    expect(snapshot.identity.application).toBe('aapw');
    expect(exported).toContain('"identity"');
    expect(evaluation.overall).toMatch(/ok|degraded|critical/);
    await runtime.dispose();
  });
});
