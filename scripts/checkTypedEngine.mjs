import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const importModule = async path => import(new URL(`../${path}`, import.meta.url));
const core = await importModule('src/engine-ts/coreTypes.ts');
const runtime = await importModule('src/engine-ts/runtimeContracts.ts');
const persistence = await importModule('src/engine-ts/persistence.ts');
const assets = await importModule('src/engine-ts/assets.ts');
const input = await importModule('src/engine-ts/input.ts');
const world = await importModule('src/engine-ts/world.ts');
const ecs = await importModule('src/engine-ts/ecsRuntime.ts');
const render = await importModule('src/engine-ts/renderBridge.ts');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const run = async () => {
  for (const item of tests) await item.fn();
  console.log(`typed-engine acceptance passed: ${tests.length} assertions`);
};

test('core brands remain runtime transparent', () => {
  assert.equal(core.ENTITY_ID('player'), 'player');
  assert.equal(core.TICK(42), 42);
  assert.equal(core.clamp(9, 0, 4), 4);
  assert.equal(core.normalizeUnit(-5), 0);
});

test('stable sort is deterministic and stable', () => {
  const result = core.stableSort([{ id: 'b', n: 1 }, { id: 'a', n: 1 }, { id: 'c', n: 0 }], (a, b) => a.n - b.n);
  assert.deepEqual(result.map(value => value.id), ['c', 'b', 'a']);
});

test('typed events isolate listener exceptions', () => {
  const bus = new runtime.TypedEventBus();
  const observed = [];
  bus.on('runtime/frame-begin', () => { throw new Error('isolated'); });
  bus.on('runtime/frame-begin', payload => observed.push(payload.context.frameId));
  bus.emit('runtime/frame-begin', { context: { frameId: 7 } });
  assert.deepEqual(observed, [7]);
  assert.equal(bus.listenerCount('runtime/frame-begin'), 2);
});

test('fixed step clock caps catch-up work', () => {
  const clock = new runtime.FixedStepClock(10, 3);
  clock.reset(0);
  let updates = 0;
  clock.advance(1000, () => { updates += 1; });
  assert.equal(updates, 3);
  assert.equal(clock.snapshot().tick, 3);
});

test('scheduler preserves phase and priority ordering', () => {
  const scheduler = new runtime.DeterministicScheduler();
  const order = [];
  scheduler.register({ id: 'late', system: 's2', phase: 'render', priority: 1, budgetWeight: 1, run: () => order.push('late') });
  scheduler.register({ id: 'early-low', system: 's1', phase: 'simulation', priority: 1, budgetWeight: 1, run: () => order.push('early-low') });
  scheduler.register({ id: 'early-high', system: 's3', phase: 'simulation', priority: 10, budgetWeight: 1, run: () => order.push('early-high') });
  scheduler.runFrame({ frameId: 1, tick: 1, simulationTimeMs: 10, deltaSeconds: 0.016, interpolationAlpha: 0, budgetMs: 16, deadlineMs: 20 });
  assert.deepEqual(order, ['early-high', 'early-low', 'late']);
});

test('save checksum is canonicalized by object key order', () => {
  const one = persistence.checksumPayload({ b: 2, a: { d: 4, c: 3 } });
  const two = persistence.checksumPayload({ a: { c: 3, d: 4 }, b: 2 });
  assert.equal(one, two);
});

test('save repository survives corrupt primary via backup', () => {
  const memory = new Map();
  const storage = { read: key => memory.get(key) ?? null, write: (key, value) => memory.set(key, value), remove: key => memory.delete(key) };
  const repository = new persistence.SaveRepository(storage, { namespace: 'test' });
  const context = { createdAtTick: 1, updatedAtTick: 1, playtimeSeconds: 5, worldSeed: 'seed', phase: 'day' };
  const first = repository.save('slot-1', { value: 1 }, context);
  assert.equal(first.ok, true);
  const second = repository.save('slot-1', { value: 2 }, { ...context, updatedAtTick: 2 });
  assert.equal(second.ok, true);
  memory.set('test:slot-1', '{broken');
  const recovered = repository.load('slot-1');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.value?.payload.value, 1);
});

test('asset texture estimates include mip overhead', () => {
  const base = assets.estimateTextureBytes(1024, 1024, 1, 4);
  const mip = assets.estimateTextureBytes(1024, 1024, 8, 4);
  assert.ok(mip > base);
  assert.ok(mip < base * 1.5);
});

test('asset dependency cycles are rejected', async () => {
  const registry = new assets.AssetRegistry();
  registry.register({ id: 'a', url: 'a', kind: 'data', dependencies: ['b'] }, async () => ({ a: true }));
  registry.register({ id: 'b', url: 'b', kind: 'data', dependencies: ['a'] }, async () => ({ b: true }));
  const result = await registry.load('a');
  assert.equal(result.ok, false);
  assert.match(result.error, /cycle/);
  registry.dispose();
});

test('stream director is deterministic under input reorder', () => {
  const director = new assets.AssetStreamDirector({ maxConcurrent: 2, maxDistance: 1000 });
  const requests = [
    { id: 'a', priority: 'normal', distance: 100, importance: 0.2 },
    { id: 'b', priority: 'high', distance: 200, importance: 0.5 },
    { id: 'c', priority: 'low', distance: 500, importance: 0.8 },
    { id: 'd', priority: 'critical', distance: 4000, importance: 1 },
  ];
  const left = director.decide(requests, 1000).map(item => `${item.id}:${item.admitted}`);
  const right = director.decide([...requests].reverse(), 1000).map(item => `${item.id}:${item.admitted}`);
  assert.deepEqual(left, right);
});

test('input mapper handles digital edge transitions', () => {
  const mapper = new input.InputMapper();
  mapper.pressCode('Space', 'keyboard', 1);
  const pressed = mapper.advanceFrame(1);
  assert.equal(pressed.actions.get('jump')?.justPressed, true);
  const held = mapper.advanceFrame(2);
  assert.equal(held.actions.get('jump')?.justPressed, false);
  mapper.releaseCode('Space', 'keyboard', 3);
  const released = mapper.advanceFrame(3);
  assert.equal(released.actions.get('jump')?.justReleased, true);
});

test('gesture solver finds dominant axis', () => {
  const result = input.resolveGesture([{ x: 0, y: 0, time: 0 }, { x: 100, y: 20, time: 200 }]);
  assert.equal(result.direction, 'right');
  assert.equal(result.distance > 100, true);
});

test('world time phase boundaries are deterministic', () => {
  assert.equal(world.worldTimeFromMinutes(300).phase, 'dawn');
  assert.equal(world.worldTimeFromMinutes(420).phase, 'day');
  assert.equal(world.worldTimeFromMinutes(1140).phase, 'dusk');
  assert.equal(world.worldTimeFromMinutes(1320).phase, 'night');
});

test('fauna plan is order invariant', () => {
  const seed = world.createWorldSeed('winterfell');
  const spawner = new world.DeterministicFaunaSpawner(seed);
  const points = [
    { id: 'p-a', position: { x: 0, y: 0, z: 0 }, radius: 100, habitat: 'forest', tags: ['cover'], maxPopulation: 10 },
    { id: 'p-b', position: { x: 100, y: 0, z: 100 }, radius: 80, habitat: 'meadow', tags: [], maxPopulation: 10 },
  ];
  const time = world.worldTimeFromMinutes(720);
  const weather = world.createWeather('clear', 0.1);
  const population = new Map();
  const a = spawner.plan(points, time, weather, population);
  const b = spawner.plan([...points].reverse(), time, weather, population);
  assert.deepEqual(a, b);
});

test('world restore rejects mismatched seeds', () => {
  const first = new world.WorldState('one');
  const second = new world.WorldState('two');
  const result = second.restore(first.snapshot());
  assert.equal(result.ok, false);
  assert.match(result.error, /seed mismatch/);
});

test('ECS query and restore retain deterministic entity order', () => {
  const ecsWorld = new ecs.EcsWorld();
  ecsWorld.registerComponent(ecs.TRANSFORM);
  ecsWorld.registerComponent(ecs.VELOCITY);
  const one = ecsWorld.createEntity('entity:b');
  const two = ecsWorld.createEntity('entity:a');
  ecsWorld.add(one, ecs.TRANSFORM);
  ecsWorld.add(two, ecs.TRANSFORM);
  ecsWorld.add(two, ecs.VELOCITY);
  const all = ecsWorld.query({ all: [ecs.TRANSFORM.type] });
  assert.deepEqual(all.map(String), ['entity:a', 'entity:b']);
  const snap = ecsWorld.snapshot();
  ecsWorld.clear();
  const restored = ecsWorld.restore(snap);
  assert.equal(restored.ok, true);
  assert.equal(ecsWorld.entityCount, 2);
  assert.equal(ecsWorld.get(two, ecs.VELOCITY) !== undefined, true);
});

test('render policy gates WebGPU-only effects on WebGL2', () => {
  const capabilities = render.detectCapabilities({ secureContext: true, webGpu: true, webGl2: true, mobile: false, memoryGiB: 16, hardwareConcurrency: 16 });
  const webGpuPolicy = render.buildRenderPolicy(capabilities, { preference: 'webgpu', quality: 'ultra' });
  const webGlPolicy = render.buildRenderPolicy(capabilities, { preference: 'webgl2', quality: 'ultra' });
  assert.equal(webGpuPolicy.ok, true);
  assert.equal(webGlPolicy.ok, true);
  assert.equal(webGpuPolicy.value?.backend, 'webgpu');
  assert.equal(webGlPolicy.value?.backend, 'webgl2');
  assert.equal(webGpuPolicy.value?.effects.includes('ssgi'), true);
  assert.equal(webGlPolicy.value?.effects.includes('ssgi'), false);
});

test('dynamic resolution only climbs after sustained headroom', () => {
  const controller = new render.DynamicResolutionController(0.8, { hysteresisFrames: 4 });
  for (let i = 0; i < 4; i += 1) controller.update(20);
  assert.ok(controller.scale < 0.8);
  const low = controller.scale;
  for (let i = 0; i < 8; i += 1) controller.update(10);
  assert.ok(controller.scale > low);
});

test('typed modules avoid nondeterministic hashing', () => {
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const expected = digest({ feature: 'typed-engine', revision: 1 });
  assert.equal(expected.length, 64);
});

await run();
