import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'aapw-engine-ts-'));
try {
  execFileSync('npx', ['--yes', 'typescript@7.0.2', 'tsc', '-p', 'tsconfig.engine.json', '--noEmit'], { cwd: root, stdio: 'inherit' });

  const source = await import(new URL('../dist/engine-ts/index.js', import.meta.url).href).catch(() => null);
  if (!source) {
    execFileSync('npx', ['--yes', 'typescript@7.0.2', 'tsc', '-p', 'tsconfig.engine.json'], { cwd: root, stdio: 'inherit' });
  }
  const engine = await import(new URL('../dist/engine-ts/index.js', import.meta.url).href);
  const { SeededRandom, hashString, EcsWorld, transformComponent, FixedStepScheduler, SpatialHash3D, EVENT_NAME, EntityId, RuntimeConfig, numericRule, ProtocolCodec, ReplayRecorder, ReplayPlayer, validateReplay } = engine;

  const a = new SeededRandom('determinism');
  const b = new SeededRandom('determinism');
  for (let i = 0; i < 4096; i += 1) assert.equal(a.nextUint32(), b.nextUint32(), `random mismatch at ${i}`);
  assert.equal(hashString('aapw'), hashString('aapw'));

  const world = new EcsWorld();
  const store = world.registerComponent(transformComponent);
  const e0 = world.createEntity('test');
  const e1 = world.createEntity('test');
  assert.equal(store.set(e0, transformComponent.defaults()).ok, true);
  assert.equal(store.set(e1, transformComponent.defaults()).ok, true);
  assert.deepEqual(world.query({ all: [transformComponent.type] }).entities, [e0, e1].sort());
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
  spatial.upsert({ entity: e1, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, layer: 1 });
  assert.deepEqual(spatial.query({ sphere: { center: { x: .5, y: .5, z: .5 }, radius: 2 } }), [e1]);
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

  console.log(JSON.stringify({ status: 'PASS', cases: 4096, contracts: ['strict-typecheck', 'seeded-rng', 'ecs', 'fixed-step', 'spatial', 'config', 'protocol', 'replay'], deterministic: true }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
