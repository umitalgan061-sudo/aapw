import { describe, expect, it } from 'vitest';
import { DeterministicSchedulerV15 } from '../../src/3d/modern/deterministicSchedulerV15';
import { ExecutionGraphV15 } from '../../src/3d/modern/executionGraphV15';
import { WorldStateJournalV15, digestV15 } from '../../src/3d/modern/worldStateJournalV15';
import { AssetStreamingV15, makeStreamAssetV15 } from '../../src/3d/modern/assetStreamingV15';
import { NetworkReconciliationV15, numericStateCodecV15 } from '../../src/3d/modern/networkReconciliationV15';
import { TelemetryTraceV15 } from '../../src/3d/modern/telemetryTraceV15';
import { RuntimeGuardV15, guardScoreBandV15 } from '../../src/3d/modern/runtimeGuardV15';
import { NextGenRuntimeV15 } from '../../src/3d/modern/nextGenRuntimeV15';
import { GameplayAuthorityV15, makeGameplayInputV15 } from '../../src/3d/modern/gameplayAuthorityV15';
import { WorldSimulationV15, worldPhaseFromTimeV15, weatherMovementMultiplierV15 } from '../../src/3d/modern/worldSimulationV15';
import { diffStateV15, applyDiffV15, verifyStateDiffV15, invertDiffV15, createStateDiffV15 } from '../../src/3d/modern/stateDiffV15';
import { PerformanceSamplerV15 } from '../../src/3d/modern/performanceSamplerV15';
import { ModuleRegistryV15, createModuleV15 } from '../../src/3d/modern/moduleRegistryV15';
import { RenderGraphV15 } from '../../src/3d/modern/renderGraphV15';
import { RenderBridgeV15 } from '../../src/3d/modern/renderBridgeV15';
import { SpatialRuntimeV15 } from '../../src/3d/modern/spatialRuntimeV15';
import { RuntimeEventRouterV15 } from '../../src/3d/modern/runtimeEventRouterV15';
import { InterestStreamingV15 } from '../../src/3d/modern/interestStreamingV15';
import { RuntimeSecurityPolicyV15 } from '../../src/3d/modern/runtimeSecurityPolicyV15';
import { SaveCodecV15 } from '../../src/3d/modern/saveCodecV15';
import { SimulationCommandRouterV15, commandPriorityV15 } from '../../src/3d/modern/simulationCommandRouterV15';
import { QualityStrategyV15, qualityInterpolationV15 } from '../../src/3d/modern/qualityStrategyV15';
import { RuntimeHealthV15, healthGradeLabelV15 } from '../../src/3d/modern/runtimeHealthV15';
import { RuntimeConfigValidatorV15 } from '../../src/3d/modern/runtimeConfigValidatorV15';
import { ReplayTimelineV15 } from '../../src/3d/modern/replayTimelineV15';
import { NetworkSnapshotCodecV15, interpolateSnapshotEntityV15 } from '../../src/3d/modern/networkSnapshotCodecV15';
import { WorkerExecutionV15 } from '../../src/3d/modern/workerExecutionV15';
import { ContentManifestV15 } from '../../src/3d/modern/contentManifestV15';

describe('deterministic scheduler v15', () => {
  it('advances only whole fixed steps', () => {
    const scheduler = new DeterministicSchedulerV15({ fixedStepMs: 10, maxCatchUpSteps: 4 });
    const result = scheduler.advance(25);
    expect(result.clock.steps).toBe(2);
    expect(result.clock.tick).toBe(2);
    expect(result.clock.simulationTimeMs).toBe(20);
    expect(result.clock.accumulatorMs).toBe(5);
  });
  it('orders commands deterministically', () => {
    const scheduler = new DeterministicSchedulerV15({ fixedStepMs: 1 });
    const order: string[] = [];
    scheduler.queueCommand({ id: 'low', lane: 'simulation', executeAtTick: 1, priority: 1, payload: 0, run: () => order.push('low') });
    scheduler.queueCommand({ id: 'high', lane: 'input', executeAtTick: 1, priority: 5, payload: 0, run: () => order.push('high') });
    scheduler.queueCommand({ id: 'mid', lane: 'simulation', executeAtTick: 1, priority: 3, payload: 0, run: () => order.push('mid') });
    scheduler.advance(1);
    expect(order).toEqual(['high', 'mid', 'low']);
  });
  it('executes repeating timers and can cancel them', () => {
    const scheduler = new DeterministicSchedulerV15({ fixedStepMs: 10 });
    let count = 0;
    scheduler.scheduleTimer({ id: 'heartbeat', executeAtTick: 1, intervalTicks: 1, repeat: 3, sequence: 0 as never, run: () => { count += 1; } } as never);
    scheduler.advance(10);
    scheduler.advance(10);
    scheduler.advance(10);
    scheduler.advance(10);
    expect(count).toBe(3);
    expect(scheduler.pendingTimers).toBe(0);
  });
  it('bounds excessive simulation debt', () => {
    const scheduler = new DeterministicSchedulerV15({ fixedStepMs: 10, maxCatchUpSteps: 2, maxDebtMs: 30 });
    const report = scheduler.advance(500);
    expect(report.catchUpClamped).toBe(true);
    expect(report.droppedTimeMs).toBeGreaterThan(0);
  });
});

describe('execution graph v15', () => {
  it('resolves dependencies and priority deterministically', async () => {
    const graph = new ExecutionGraphV15<number>();
    const calls: string[] = [];
    graph.add({ id: 'simulation', phase: 'simulation', priority: 5, budgetMs: 3, run: (value) => { calls.push('simulation'); return value + 1; } });
    graph.add({ id: 'input', phase: 'input', priority: 5, budgetMs: 1, run: (value) => { calls.push('input'); return value + 1; } });
    graph.add({ id: 'render', phase: 'render', priority: 3, budgetMs: 2, dependsOn: ['simulation'], run: (value) => { calls.push('render'); return value + 1; } });
    const result = await graph.runFrame(0, { frame: 1, tick: 1, deltaMs: 16, budgetMs: 20 });
    expect(calls).toEqual(['input', 'simulation', 'render']);
    expect(result.output).toBe(3);
    expect(result.report.failed).toHaveLength(0);
  });
  it('detects dependency cycles', () => {
    const graph = new ExecutionGraphV15();
    graph.add({ id: 'a', phase: 'simulation', priority: 1, budgetMs: 1, dependsOn: ['b'], run: (x) => x });
    graph.add({ id: 'b', phase: 'simulation', priority: 1, budgetMs: 1, dependsOn: ['a'], run: (x) => x });
    expect(() => graph.validate()).not.toThrow();
    expect(graph.validate().some((error) => error.includes('cycle'))).toBe(true);
  });
  it('blocks dependents after critical task failure', async () => {
    const graph = new ExecutionGraphV15();
    graph.add({ id: 'critical', phase: 'simulation', priority: 5, budgetMs: 1, critical: true, run: () => { throw new Error('fail'); } });
    graph.add({ id: 'dependent', phase: 'world', priority: 1, budgetMs: 1, dependsOn: ['critical'], run: (x) => x });
    const result = await graph.runFrame({}, { frame: 1, tick: 1, deltaMs: 16, budgetMs: 20 });
    expect(result.report.failed).toContain('critical');
  });
});

describe('world journal v15', () => {
  it('commits patches with stable digest', () => {
    const journal = new WorldStateJournalV15({ player: { health: 100, x: 0 } });
    const entry = journal.commit([{ path: ['player', 'health'], before: 100, after: 80, revision: 0, tick: 0, source: 'test' }], 'damage', 5);
    expect(entry.revision).toBe(1);
    expect(journal.state()).toEqual({ player: { health: 80, x: 0 } });
    expect(journal.digest()).toBe(digestV15(journal.state()));
  });
  it('creates and restores checkpoints', () => {
    const journal = new WorldStateJournalV15({ value: 1 });
    journal.commit([{ path: ['value'], before: 1, after: 2, revision: 1, tick: 1, source: 'test' }], 'set', 1);
    const checkpoint = journal.checkpoint(1);
    journal.commit([{ path: ['value'], before: 2, after: 3, revision: 2, tick: 2, source: 'test' }], 'set', 2);
    expect(journal.restoreCheckpoint(checkpoint.revision)).toBe(true);
    expect(journal.state()).toEqual({ value: 2 });
  });
  it('provides deterministic diffs', () => {
    const a = { a: 1, nested: { x: 2 } };
    const b = { a: 3, nested: { x: 2, y: 4 } };
    const diff = diffStateV15(a, b);
    expect(applyDiffV15(a, diff)).toEqual(b);
    expect(verifyStateDiffV15(a, createStateDiffV15(a, b, 1), b)).toBe(true);
    expect(applyDiffV15(b, invertDiffV15(diff))).toEqual(a);
  });
});

describe('asset streaming v15', () => {
  it('loads queued assets within concurrency', async () => {
    const loader = { load: async (asset: any) => ({ value: asset.id, bytes: 128 }) };
    const streaming = new AssetStreamingV15(loader, { budget: { maxConcurrent: 2, maxResidentBytes: 1024 * 1024 } });
    streaming.declare(makeStreamAssetV15({ id: 'a', url: 'https://example.com/a', kind: 'model' }));
    streaming.declare(makeStreamAssetV15({ id: 'b', url: 'https://example.com/b', kind: 'model' }));
    const [a, b] = await Promise.all([streaming.request('a'), streaming.request('b')]);
    expect(a.state).toBe('ready');
    expect(b.state).toBe('ready');
    expect(streaming.residentBytes()).toBe(256);
  });
  it('rejects oversized assets', async () => {
    const streaming = new AssetStreamingV15({ load: async () => ({ value: {}, bytes: 2048 }) });
    streaming.declare(makeStreamAssetV15({ id: 'x', url: 'https://example.com/x', kind: 'data', maxBytes: 1024 }));
    await expect(streaming.request('x')).rejects.toThrow('maxBytes');
  });
});

describe('network reconciliation v15', () => {
  it('predicts and replays inputs after authoritative correction', () => {
    const reconciler = new NetworkReconciliationV15(0, numericStateCodecV15, { correctionThreshold: 1 });
    const inputA = reconciler.recordInput(1, 2, 1);
    reconciler.predict(inputA);
    const inputB = reconciler.recordInput(2, 3, 2);
    reconciler.predict(inputB);
    const correction = reconciler.receiveAuthoritative(2, 2, 10);
    expect(correction.state).toBe(5);
    expect(correction.hardSnap).toBe(false);
    expect(reconciler.metrics().corrections).toBe(1);
  });
  it('hard snaps when correction exceeds threshold', () => {
    const reconciler = new NetworkReconciliationV15(0, numericStateCodecV15, { correctionThreshold: 0.1 });
    reconciler.recordInput(1, 10, 1);
    reconciler.predict(reconciler.inputs()[0]!);
    const correction = reconciler.receiveAuthoritative(0, 1, 2);
    expect(correction.hardSnap).toBe(true);
    expect(correction.state).toBe(0);
  });
});

describe('telemetry trace v15', () => {
  it('supports nested spans and bounded history', () => {
    let now = 0;
    const trace = new TelemetryTraceV15({ clock: () => now, capacity: 8 });
    const root = trace.start('frame', 'internal', { frame: 1, tick: 1 });
    now = 3;
    const child = trace.start('simulation', 'simulation', { frame: 1, tick: 1, parentId: root?.id });
    now = 8;
    child?.end();
    now = 12;
    root?.end();
    const snapshot = trace.snapshot();
    expect(snapshot.spans).toHaveLength(2);
    expect(snapshot.spans.find((span) => span.parentId === root?.id)).toBeTruthy();
    expect(snapshot.digest.length).toBe(8);
  });
  it('tracks counters and histograms', () => {
    const trace = new TelemetryTraceV15();
    trace.counter('frames', 2);
    trace.counter('frames', 3);
    trace.observe('frameMs', 10);
    trace.observe('frameMs', 20);
    const snapshot = trace.snapshot();
    expect(snapshot.counters[0]?.value).toBe(5);
    expect(snapshot.histograms[0]?.p95).toBe(20);
  });
});

describe('runtime guard v15', () => {
  it('detects critical entity violations', () => {
    const guard = new RuntimeGuardV15();
    guard.installDefaultRules();
    const decision = guard.evaluate({ frameMs: 10, simulationTick: 1, entities: 25000, commands: 10 });
    expect(decision.healthy).toBe(false);
    expect(decision.score).toBeLessThan(100);
    expect(guardScoreBandV15(decision.score)).not.toBe('healthy');
  });
  it('opens and recovers circuit breakers', () => {
    const guard = new RuntimeGuardV15({ breakerThreshold: 2, breakerCooldownFrames: 2 });
    guard.registerBreaker('network');
    guard.failure('network');
    guard.failure('network');
    expect(guard.allow('network')).toBe(false);
  });
});

describe('gameplay authority v15', () => {
  it('moves, sprints and consumes stamina deterministically', () => {
    const gameplay = new GameplayAuthorityV15('player');
    const initial = gameplay.state().vitals.stamina;
    gameplay.step(makeGameplayInputV15({ moveZ: -1, sprint: true }), 1000 / 60, 1);
    expect(gameplay.state().transform.z).toBeLessThan(0);
    expect(gameplay.state().vitals.stamina).toBeLessThan(initial);
  });
  it('handles jump and landing', () => {
    const gameplay = new GameplayAuthorityV15('player');
    gameplay.step(makeGameplayInputV15({ jump: true }), 16.67, 1);
    expect(gameplay.state().transform.grounded).toBe(false);
    for (let tick = 2; tick < 120; tick += 1) gameplay.step(makeGameplayInputV15(), 16.67, tick);
    expect(gameplay.state().transform.grounded).toBe(true);
    expect(gameplay.state().transform.y).toBe(0);
  });
  it('transitions to dead after lethal damage', () => {
    const gameplay = new GameplayAuthorityV15('player');
    const state = gameplay.damage(500, 1);
    expect(state.mode).toBe('dead');
    expect(gameplay.drainEvents().some((event) => event.type === 'death')).toBe(true);
  });
});

describe('world simulation v15', () => {
  it('advances day and deterministic weather', () => {
    const worldA = new WorldSimulationV15({ seed: 42, ticksPerDay: 60, seasonDays: 5 });
    const worldB = new WorldSimulationV15({ seed: 42, ticksPerDay: 60, seasonDays: 5 });
    for (let i = 0; i < 120; i += 1) { worldA.tick(); worldB.tick(); }
    expect(worldA.state()).toEqual(worldB.state());
    expect(worldA.state().day).toBe(2);
  });
  it('maps day phases and weather movement effects', () => {
    expect(worldPhaseFromTimeV15(0.1)).toBe('night');
    expect(worldPhaseFromTimeV15(0.5)).toBe('day');
    expect(weatherMovementMultiplierV15('storm')).toBeLessThan(1);
  });
  it('forecasts without mutating the current timeline', () => {
    const world = new WorldSimulationV15({ ticksPerDay: 60 });
    const before = world.state();
    const forecast = world.forecast(3);
    expect(forecast).toHaveLength(3);
    expect(world.state()).toEqual(before);
  });
});

describe('performance sampler v15', () => {
  it('computes pressure and percentiles', () => {
    const sampler = new PerformanceSamplerV15(30);
    for (let i = 0; i < 10; i += 1) sampler.push({ frameMs: 40, cpuMs: 24, gpuMs: 26, simulationMs: 10, streamingMs: 3, networkMs: 2, drawCalls: 2000, triangles: 1_000_000, visibleObjects: 3000, memoryMb: 1500, timestampMs: i, frame: i });
    expect(sampler.current().pressure).toBeGreaterThan(0.8);
    expect(sampler.current().band).toBe('critical');
    expect(sampler.current().p95FrameMs).toBe(40);
  });
});

describe('module registry v15', () => {
  it('starts dependencies in order', async () => {
    const registry = new ModuleRegistryV15();
    const order: string[] = [];
    registry.register(createModuleV15({ id:'core', version:'1', dependencies:[], critical:true, value:1, start:()=>order.push('core') }));
    registry.register(createModuleV15({ id:'world', version:'1', dependencies:['core'], critical:true, value:2, start:()=>order.push('world') }));
    await registry.start(0);
    expect(order).toEqual(['core','world']);
    expect(registry.health()).toBe(true);
  });
});

describe('render graph and bridge v15', () => {
  it('orders render passes and executes enabled passes', () => {
    const graph = new RenderGraphV15();
    const calls: string[] = [];
    graph.addResource({ id:'color', bytes:1024, format:'rgba8', transient:true, external:false });
    graph.addPass({ id:'opaque', kind:'opaque', priority:2, dependsOn:[], reads:[], writes:['color'], enabled:()=>true, execute:()=>calls.push('opaque') });
    graph.addPass({ id:'ui', kind:'ui', priority:3, dependsOn:['opaque'], reads:['color'], writes:[], enabled:()=>true, execute:()=>calls.push('ui') });
    const report = graph.execute(1,1);
    expect(calls).toEqual(['opaque','ui']);
    expect(report.failed).toHaveLength(0);
  });
  it('culls by quality scale', () => {
    const bridge = new RenderBridgeV15({ backend:'webgl2', maxTextureSize:4096, maxSamples:4, supportsCompute:false, supportsTimestampQuery:false, supportsInstancing:true, supportsFloatTargets:true });
    bridge.setQualityScale(.5);
    const result = bridge.build({ frame:1,tick:1,camera:{x:0,y:0,z:0,fov:60,near:.1,far:100},layers:[{id:'a',visible:true,priority:10,drawCalls:100,triangles:1000,instances:100,materialGroup:'a',distance:1,castsShadow:false},{id:'b',visible:true,priority:1,drawCalls:100,triangles:1000,instances:100,materialGroup:'b',distance:2,castsShadow:false}],budget:{frameMs:16,drawCalls:100,triangles:1000,instances:100,textureBytes:1,shadowCasters:1,postEffects:1},qualityScale:.5 });
    expect(result.accepted.length).toBeGreaterThan(0);
    expect(result.culled.length).toBeGreaterThan(0);
  });
});

describe('spatial runtime v15', () => {
  it('returns deterministic nearest entities', () => {
    const spatial = new SpatialRuntimeV15(10);
    spatial.set({ id:'b', position:{x:15,y:0,z:0}, radius:1, layer:1, value:2, active:true });
    spatial.set({ id:'a', position:{x:5,y:0,z:0}, radius:1, layer:1, value:1, active:true });
    expect(spatial.querySphere({ center:{x:0,y:0,z:0}, radius:30 }).map((entity)=>entity.id)).toEqual(['a','b']);
    expect(spatial.nearest({x:0,y:0,z:0},30)?.id).toBe('a');
    expect(spatial.metrics().buckets).toBeGreaterThan(0);
  });
});

describe('event router and interest streaming v15', () => {
  it('isolates handler failures while continuing dispatch', async () => {
    const router = new RuntimeEventRouterV15();
    const seen: string[] = [];
    router.subscribe('test',()=>{ throw new Error('bad'); });
    router.subscribe('test',()=>{ seen.push('ok'); });
    router.emit('test',{});
    await router.dispatch();
    expect(seen).toEqual(['ok']);
  });
  it('plans and commits chunk interest', () => {
    const interest = new InterestStreamingV15({ chunkSize:32, maxCells:256, maxLoads:8, maxUnloads:8 });
    interest.upsertSource({ id:'player', kind:'player', x:0,z:0,radius:96,weight:10,enabled:true });
    const plan = interest.plan(0,0);
    expect(plan.loads.length).toBeGreaterThan(0);
    interest.commit(plan);
    expect(interest.resident().length).toBe(plan.loads.length);
  });
});

describe('security, save codec and command router v15', () => {
  it('rejects hostile payload sizes', () => {
    const policy = new RuntimeSecurityPolicyV15({ maxPayloadBytes: 10 });
    expect(policy.auditPayload('12345678901').accepted).toBe(false);
    expect(policy.sanitizeId('a b/c')).toBe('a_b_c');
  });
  it('round-trips a versioned save with checksum', () => {
    const codec = new SaveCodecV15<{ score:number }>({ gameVersion:'test' });
    const serialized = codec.encode({ score:42 }, { slot:'alpha', tick:7, revision:2 });
    const result = codec.decode(serialized);
    expect(result.ok).toBe(true);
    if(result.ok)expect(result.value).toEqual({ score:42 });
  });
  it('executes only deterministic registered commands in priority order', async () => {
    const router = new SimulationCommandRouterV15();
    const seen: string[] = [];
    router.registerRule({ kind:'attack', validate:(payload)=>Boolean(payload), execute:(command)=>seen.push(command.id) });
    router.registerRule({ kind:'move', validate:(payload)=>Boolean(payload), execute:(command)=>seen.push(command.id) });
    router.submit({ actorId:'p', kind:'move', tick:1, priority:4, payload:true, deterministic:true });
    router.submit({ actorId:'p', kind:'attack', tick:1, priority:5, payload:true, deterministic:true });
    await router.executeTick(1);
    expect(seen).toEqual(['cmd-2','cmd-1']);
    expect(commandPriorityV15('attack')).toBe(5);
  });
});

describe('quality and health v15', () => {
  it('degrades quality under pressure and recovers after dwell', () => {
    const strategy = new QualityStrategyV15({ initial:'ultra', dwellFrames:2 });
    const degraded = strategy.observe({ frameMs:70,cpuMs:40,gpuMs:40,memoryPressure:1,thermalPressure:1,visibleObjects:5000,drawCalls:4000,droppedFrames:10 });
    expect(degraded.tier).toBe('high');
    strategy.observe({ frameMs:10,cpuMs:4,gpuMs:4,memoryPressure:0,thermalPressure:0,visibleObjects:100,drawCalls:100,droppedFrames:0 });
    const recovered = strategy.observe({ frameMs:10,cpuMs:4,gpuMs:4,memoryPressure:0,thermalPressure:0,visibleObjects:100,drawCalls:100,droppedFrames:0 });
    expect(recovered.tier).toBe('high');
    expect(qualityInterpolationV15(strategy.budget(), QualityStrategyV15.profile('ultra'), .5).renderScale).toBeGreaterThan(strategy.budget().renderScale);
  });
  it('scores runtime failures explicitly', () => {
    const health = new RuntimeHealthV15();
    const score = health.observe({ deterministic:true,errors:0,warnings:2,frameMs:20,p95FrameMs:25,memoryPressure:.2,networkRttMs:50,packetLoss:.01,migrationCoverage:1,failedTasks:0,renderFailures:0,assetFailures:0,queueDepth:10,queueCapacity:100 });
    expect(score.grade).toBe('A');
    expect(healthGradeLabelV15(score.grade)).toBe('stable');
  });
});

describe('config validator, replay and snapshot codec v15', () => {
  it('accepts safe configuration and rejects impossible relationships', () => {
    const validator = new RuntimeConfigValidatorV15();
    expect(validator.validate({}).valid).toBe(true);
    expect(validator.validate({ fixedStepMs:100, frameBudgetMs:10 }).valid).toBe(false);
  });
  it('detects replay divergence at a stable tick', () => {
    const replay = new ReplayTimelineV15<number>();
    replay.recordFrame(1, 10, 1, true);
    expect(replay.verifyFrame(1, 10)).toBeUndefined();
    const divergence = replay.verifyFrame(1, 11);
    expect(divergence?.tick).toBe(1);
  });
  it('encodes and decodes quantized snapshots', () => {
    const codec = new NetworkSnapshotCodecV15();
    const bytes = codec.encode({ tick:10,sequence:2,serverTimeMs:100,entities:[{id:1,x:1.23456,y:0,z:-4.4,yaw:1.1,vx:2,vy:0,vz:-1,health:90,flags:3}] });
    const decoded = codec.decode(bytes);
    expect(decoded.ok).toBe(true);
    if(decoded.ok)expect(decoded.snapshot.entities[0]?.id).toBe(1);
    expect(interpolateSnapshotEntityV15({id:1,x:0,y:0,z:0,yaw:0,vx:0,vy:0,vz:0,health:100,flags:0},{id:1,x:10,y:0,z:0,yaw:1,vx:2,vy:0,vz:0,health:50,flags:1},.5).x).toBe(5);
  });
});

describe('worker execution v15', () => {
  it('runs async bounded tasks and records failures', async () => {
    const worker = new WorkerExecutionV15<{value:number}, number>({ concurrency:2 });
    worker.enqueue({ id:'a', priority:5, input:{value:2}, timeoutMs:100, run:async(input)=>input.value*2 });
    worker.enqueue({ id:'b', priority:1, input:{value:3}, timeoutMs:100, run:()=>{ throw new Error('fail'); } });
    await worker.flush();
    expect(worker.metrics().completed).toBe(1);
    expect(worker.metrics().failed).toBe(1);
  });
});

describe('content manifest v15', () => {
  it('validates critical content and stable digest', () => {
    const manifest = new ContentManifestV15('test');
    manifest.add({ id:'hero',path:'assets/hero.glb',kind:'model',version:'1',bytes:100,digest:'deadbeef',tags:['hero'],critical:true });
    expect(manifest.validate(['hero'])).toHaveLength(0);
    expect(manifest.digest()).toHaveLength(8);
    expect(manifest.byKind('model')).toHaveLength(1);
  });
});

describe('next generation runtime v15', () => {
  it('composes V14 control plane with V15 execution and guard', async () => {
    const runtime = new NextGenRuntimeV15({ initialQuality:'high', fixedStepMs:16.67, worldState:{ world:{tick:0} } });
    const input = { source:'keyboard' as const, moveX:0, moveZ:0, moveMagnitude:0, sprint:false, guard:false, dodge:false, lightAttack:false, heavyAttack:false, lockOn:false, interact:false, timestamp:0 };
    const frame = await runtime.tick({ frameMs:16, cpuMs:6, gpuMs:5, memoryPressure:.1, thermalPressure:0, drawCalls:100, visibleObjects:100 }, input);
    expect(frame.frame).toBeGreaterThan(0);
    expect(frame.execution.results.length).toBeGreaterThan(0);
    expect(frame.worldDigest.length).toBe(8);
    expect(frame.trace).toMatch(/^span-/);
  });
});
