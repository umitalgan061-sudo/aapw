import { describe, expect, it } from 'vitest';
import { CommandBuffer } from '../../src/engine-ts/r43/commandBuffer.ts';
import { DiagnosticsHub } from '../../src/engine-ts/r43/diagnostics.ts';
import { CooperativeWorkQueue, DeterministicWorkerPool } from '../../src/engine-ts/r43/worker.ts';
import { WorldRuntime } from '../../src/engine-ts/r43/world.ts';

describe('r43 world runtime', () => {
  it('moves entities within hard world bounds and maintains the spatial index', () => {
    const world = new WorldRuntime({ minX: -10, minY: -5, maxX: 10, maxY: 5 }, 4);
    const entity = world.spawn({ x: 9, y: 0 }, { x: 5, y: 0, maxSpeed: 20 }, 1);
    const report = world.step(1);
    expect(report.moved).toBe(1);
    expect(report.clamped).toBe(1);
    expect(world.entity(entity)?.transform.x).toBe(10);
    expect(world.nearby({ x: 10, y: 0 }, 2).map((item) => item.id)).toEqual([entity]);
  });

  it('queues and applies deterministic destruction', () => {
    const world = new WorldRuntime({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const a = world.spawn({ x: 10, y: 10 });
    const b = world.spawn({ x: 20, y: 20 });
    world.queueDestroy(b);
    expect(world.step(0.01).removed).toBe(1);
    expect(world.alive()).toEqual([a]);
  });
});

describe('r43 command and work scheduling', () => {
  it('orders command buffer entries by priority before sequence', () => {
    const buffer = new CommandBuffer(8);
    buffer.push({ type: 'custom', name: 'z', payload: 1 }, 'normal');
    buffer.push({ type: 'resume' }, 'critical');
    buffer.push({ type: 'pause', reason: 'x' }, 'high');
    expect(buffer.drain().map((item) => item.command.type)).toEqual(['resume', 'pause', 'custom']);
  });

  it('bounds command capacity and exposes a stable digest', () => {
    const buffer = new CommandBuffer(2);
    expect(buffer.push({ type: 'resume' })).toBe(true);
    expect(buffer.push({ type: 'resume' })).toBe(true);
    expect(buffer.push({ type: 'resume' })).toBe(false);
    expect(buffer.digest()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('runs cooperative tasks in deterministic priority order', () => {
    const queue = new CooperativeWorkQueue<number, number>(8);
    const seen: number[] = [];
    queue.enqueue({ id: 'b', priority: 'normal', payload: 2, budgetMs: 1, createdAtFrame: 1 });
    queue.enqueue({ id: 'a', priority: 'critical', payload: 1, budgetMs: 1, createdAtFrame: 1 });
    const completed = queue.drain(4, (value) => { seen.push(value); return value * 2; });
    expect(seen).toEqual([1, 2]);
    expect(completed.map((item) => item.value)).toEqual([2, 4]);
  });

  it('rejects duplicate work identifiers', () => {
    const queue = new CooperativeWorkQueue<number, number>(8);
    expect(queue.enqueue({ id: 'same', priority: 'normal', payload: 1, budgetMs: 1, createdAtFrame: 1 }).ok).toBe(true);
    expect(queue.enqueue({ id: 'same', priority: 'normal', payload: 2, budgetMs: 1, createdAtFrame: 1 }).ok).toBe(false);
  });

  it('limits total worker budget through the worker pool', () => {
    const pool = new DeterministicWorkerPool<number, number>(2, 8);
    pool.submit({ id: 'one', priority: 'critical', payload: 2, budgetMs: 1, createdAtFrame: 1 });
    const results = pool.runFrame(2, (value) => value * value);
    expect(results[0]?.value).toBe(4);
  });
});

describe('r43 diagnostics', () => {
  it('captures bounded issues and metrics', () => {
    const diagnostics = new DiagnosticsHub(3);
    diagnostics.setFrame(7);
    diagnostics.info('BOOT', 'ready', 'runtime');
    diagnostics.warning('PERF', 'slow', 'render');
    diagnostics.error('FATAL', 'broken', 'network');
    diagnostics.observeMetric('frame.ms', 18);
    expect(diagnostics.hasErrors()).toBe(true);
    expect(diagnostics.bySeverity('error')).toHaveLength(1);
    expect(diagnostics.snapshot().digest).toMatch(/^[0-9a-f]{8}$/);
    expect(diagnostics.validateNoErrorCode('FATAL').ok).toBe(false);
  });

  it('drops the oldest issue after reaching capacity', () => {
    const diagnostics = new DiagnosticsHub(2);
    diagnostics.info('A', 'a');
    diagnostics.info('B', 'b');
    diagnostics.info('C', 'c');
    expect(diagnostics.snapshot().issues.map((issue) => issue.code)).toEqual(['B', 'C']);
  });
});
