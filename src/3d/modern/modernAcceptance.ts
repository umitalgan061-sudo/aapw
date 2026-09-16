import assert from 'node:assert/strict';
import { EventBus, XorShift32, stableHashObject } from './eventBus';
import { FixedStepClock } from './frameScheduler';
import { AdaptiveQualityController } from './adaptiveQuality';
import { SpatialHashGrid } from './spatialIndex';
import { ModernEntityStore } from './ecs';

export interface AcceptanceReport { readonly passed: number; readonly failed: number; readonly failures: readonly string[]; }

type Check = { readonly name: string; readonly run: () => void | Promise<void> };
const checks: Check[] = [];
const add = (name: string, run: Check['run']): void => checks.push({ name, run });

add('brand-safe deterministic ids', () => {
  const storeA = new ModernEntityStore({ seed: 123 });
  const storeB = new ModernEntityStore({ seed: 123 });
  const a = [storeA.create(), storeA.create(), storeA.create()];
  const b = [storeB.create(), storeB.create(), storeB.create()];
  assert.deepEqual(a, b);
});

add('event once semantics', () => {
  const bus = new EventBus();
  let calls = 0;
  bus.once('frame:begin', () => calls += 1);
  bus.emit('frame:begin', { frameId: 1 as any, timestamp: 1 as any, deltaMs: 16 });
  bus.emit('frame:begin', { frameId: 2 as any, timestamp: 17 as any, deltaMs: 16 });
  assert.equal(calls, 1);
});

add('deterministic random fork', () => {
  const a = new XorShift32(99).fork(7);
  const b = new XorShift32(99).fork(7);
  assert.deepEqual(Array.from({ length: 32 }, () => a.next()), Array.from({ length: 32 }, () => b.next()));
});

add('canonical object hashing', () => assert.equal(stableHashObject({ b: 2, a: [1, 2] }), stableHashObject({ a: [1, 2], b: 2 })));

add('fixed step does not explode after long pause', () => {
  const clock = new FixedStepClock({ stepSeconds: 1 / 60, maxCatchUpSteps: 4 });
  let ticks = 0;
  clock.consume(0, () => undefined);
  const result = clock.consume(60_000, () => ticks += 1);
  assert.equal(ticks, 4);
  assert.ok(result.droppedSeconds > 0);
});

add('quality pressure moves downward gradually', () => {
  const quality = new AdaptiveQualityController('ultra');
  for (let i = 0; i < 60; i += 1) quality.observe({ cpuMs: 28, gpuMs: 30, timestampMs: i * 100 });
  assert.ok(['high', 'medium', 'low'].includes(quality.state().tier));
});

add('quality headroom never exceeds configured ceiling', () => {
  const quality = new AdaptiveQualityController('high', { maxTier: 'ultra' });
  for (let i = 0; i < 500; i += 1) quality.observe({ cpuMs: 4, gpuMs: 3, timestampMs: i * 100 });
  assert.ok(['high', 'ultra'].includes(quality.state().tier));
});

add('spatial query stable under insertion order', () => {
  const data = [
    ['a', 4], ['b', 1], ['c', 8], ['d', 2], ['e', 12],
  ] as const;
  const make = (reverse: boolean) => {
    const grid = new SpatialHashGrid(4);
    const source = reverse ? [...data].reverse() : data;
    for (const [id, x] of source) grid.insert({ id: id as any, position: { x, y: 0, z: 0 }, radius: 0.25 });
    return grid.query({ center: { x: 0, y: 0, z: 0 }, radius: 10 }).map((hit) => hit.id);
  };
  assert.deepEqual(make(false), make(true));
});

add('component clone prevents mutation leaks', () => {
  const store = new ModernEntityStore({ seed: 4 });
  const id = store.create({ components: { inventory: { items: ['iron'] } } });
  const value = store.getComponent<{ items: string[] }>(id, 'inventory');
  value?.items.push('gold');
  assert.deepEqual(store.getComponent<{ items: string[] }>(id, 'inventory')?.items, ['iron']);
});

add('entity snapshot remains sorted', () => {
  const store = new ModernEntityStore({ seed: 4 });
  for (let i = 0; i < 50; i += 1) store.create();
  const ids = store.snapshot().entities.map((entity) => entity.id);
  assert.deepEqual(ids, [...ids].sort());
});

export const runAcceptance = async (): Promise<AcceptanceReport> => {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const check of checks) {
    try { await check.run(); passed += 1; }
    catch (error) { failed += 1; failures.push(`${check.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { passed, failed, failures };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runAcceptance();
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
}
