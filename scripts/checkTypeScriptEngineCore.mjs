import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'aapw-engine-ts-'));
try {
  execFileSync('npx', ['--yes', 'typescript@7.0.2', 'tsc', '-p', 'tsconfig.engine.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
  execFileSync('npx', ['--yes', 'typescript@7.0.2', 'tsc', '-p', 'tsconfig.engine.json'], { cwd: root, stdio: 'inherit' });
  const engine = await import(new URL('../dist/engine-ts/index.js', import.meta.url).href);
  const { SeededRandom, hashString, EcsWorld, transformComponent, FixedStepScheduler, SpatialHash3D, RuntimeConfig, numericRule, ProtocolCodec, ReplayRecorder, ReplayPlayer, validateReplay, DependencyGraph, graphSystemId, validateCapabilitySnapshot, buildPlatformProfile, probeCapabilities, FrameBudgetController, SimulationClock, SnapshotStore, diffJson, applyDelta } = engine;

  const a = new SeededRandom('determinism');
  const b = new SeededRandom('determinism');
  for (let i = 0; i < 4096; i += 1) assert.equal(a.nextUint32(), b.nextUint32(), `random mismatch at ${i}`);
  assert.equal(hashString('aapw'), hashString('aapw'));
  const checkpoint = a.snapshot();
  const x = a.nextUint32(); a.restore(checkpoint); assert.equal(a.nextUint32(), x);

  const world = new EcsWorld();
  const store = world.registerComponent(transformComponent);
  const e0 = world.createEntity('test');
  const e1 = world.createEntity('test');
  assert.equal(store.set(e0, transformComponent.defaults()).ok, true);
  assert.equal(store.set(e1, transformComponent.defaults()).ok, true);
  assert.deepEqual(world.query({ all: [transformComponent.type] }).entities, [e0, e1].sort());
  assert.equal(world.patch(e0, transformComponent.type, { scale: 2 }).ok, true);
  assert.equal(world.get(e0, transformComponent.type)?.scale, 2);
  assert.equal(world.destroyEntity(e0), true);
  assert.equal(world.has(e0, transformComponent.type), false);
  world.dispose();

  let calls = 0;
  const scheduler = new FixedStepScheduler({ stepSeconds: 1 / 60, maxSubSteps: 5 });
  scheduler.addSystem({ id: 'test.system', phase: 'simulation', priority: 10, update() { calls += 1; } });
  scheduler.advance(1 / 30);
  assert.equal(calls, 2);
  assert.equal(Number(scheduler.currentTick), 2);
  scheduler.dispose();

  const spatial = new SpatialHash3D(4);
  spatial.upsert({ entity: engine.ENTITY_ID('probe'), bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, layer: 1 });
  assert.deepEqual(spatial.query({ sphere: { center: { x: .5, y: .5, z: .5 }, radius: 2 } }), [engine.ENTITY_ID('probe')]);
  assert.equal(spatial.raycast({ origin: { x: .5, y: .5, z: -2 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 5 }).length, 1);
  spatial.dispose();

  const config = new RuntimeConfig([numericRule('speed', 4, 0, 10)]);
  assert.equal(config.set('speed', 12).ok, true);
  assert.equal(config.get('speed'), 10);
  config.lock();
  assert.equal(config.set('speed', 2).ok, false);

  const codec = new ProtocolCodec();
  const hello = codec.message('hello', 1, 0, { client: 'test', protocol: 1, capabilities: ['snapshot'] });
  const encoded = codec.encode(hello);
  const decoded = codec.decode(encoded);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value?.payload, hello.payload);
  assert.equal(codec.decode(encoded.replace('snapshot', 'command')).ok, false);

  const graph = new DependencyGraph();
  graph.addSystem({ id: graphSystemId('input'), phase: 'input', priority: 1, update() {} });
  graph.addSystem({ id: graphSystemId('sim'), phase: 'simulation', priority: 1, after: [graphSystemId('input')], update() {} });
  const plan = graph.plan();
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.order.map(String), ['input', 'sim']);
  graph.dispose();

  const report = validateCapabilitySnapshot(probeCapabilities());
  assert.equal(report.ok, true);
  assert.ok(['low', 'balanced', 'high', 'ultra'].includes(buildPlatformProfile(probeCapabilities()).tier));

  const frameBudget = new FrameBudgetController({ targetFps: 60, dwellFrames: 1 });
  for (let i = 0; i < 120; i += 1) frameBudget.observe(28);
  assert.ok(frameBudget.snapshot.quality < 1);
  frameBudget.reset();
  assert.equal(frameBudget.snapshot.quality, 1);

  let simTicks = 0;
  const clock = new SimulationClock(1 / 60, 4);
  clock.advance(1 / 30, () => { simTicks += 1; });
  assert.equal(simTicks, 2);
  clock.pause();
  clock.advance(1, () => { simTicks += 1; });
  assert.equal(simTicks, 2);
  clock.resume();
  clock.dispose();

  const snapshots = new SnapshotStore('test.snapshot', 1, 4);
  assert.equal(snapshots.put('player', { hp: 100, inventory: ['sword'] }, 1).ok, true);
  const restored = snapshots.restore<{ hp: number; inventory: string[] }>('player');
  assert.equal(restored.ok, true);
  assert.equal(restored.value?.hp, 100);
  const patch = diffJson({ hp: 100, state: 'idle' }, { hp: 80, state: 'hit', alive: true }, 'combat');
  const patched = applyDelta({ hp: 100, state: 'idle' }, patch);
  assert.equal(patched.ok, true);
  assert.deepEqual(patched.value, { hp: 80, state: 'hit', alive: true });
  snapshots.dispose();

  const recorderA = new ReplayRecorder({ seed: 42 });
  const recorderB = new ReplayRecorder({ seed: 42 });
  for (let i = 0; i < 128; i += 1) {
    const frame = { frame: i, tick: i, deltaSeconds: 1 / 60, commands: [], events: [], checksum: hashString(`frame:${i}`).toString(16) };
    recorderA.record(frame);
    recorderB.record(frame);
  }
  const snapA = recorderA.snapshot();
  const snapB = recorderB.snapshot();
  assert.equal(validateReplay(snapA, snapB).ok, true);
  const player = new ReplayPlayer(snapA);
  assert.equal(player.peek()?.frame, 0);
  assert.equal(player.next()?.frame, 0);
  assert.equal(player.next()?.frame, 1);
  player.reset();
  assert.equal(player.index, 0);
  player.dispose(); recorderA.dispose(); recorderB.dispose();

  rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ status: 'PASS', cases: 4096, contracts: ['strict-typecheck', 'seeded-rng', 'ecs', 'fixed-step', 'spatial', 'config', 'protocol', 'dependency-graph', 'capability-profile', 'frame-budget', 'simulation-clock', 'snapshot-delta', 'replay'], deterministic: true }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
