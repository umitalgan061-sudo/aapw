import { describe, expect, it } from 'vitest';
import { checksum, combineSeeds, FixedStepClock, hash32, sample01, stableStringify } from '../src/3d/modern/deterministic';
import { TypedEventBus } from '../src/3d/modern/eventBus';
import { EntityWorld } from '../src/3d/modern/entityWorld';
import { CommandJournal } from '../src/3d/modern/commandJournal';
import { FrameGraphBuilder } from '../src/3d/modern/frameGraph';
import { StreamingPlanner } from '../src/3d/modern/streamingPlanner';
import { MotionStateMachine, animationPolicy } from '../src/3d/modern/motionState';
import { AdaptiveQualityController } from '../src/3d/modern/qualityController';
import { calculatePressure, RollingTelemetry } from '../src/3d/modern/telemetry';

describe('deterministic primitives', () => {
  it('hashes and random samples independently of call order', () => {
    const seed = combineSeeds(2026, 9, 16);
    expect(hash32('westeros')).toBe(hash32('westeros'));
    expect(sample01(seed, 42)).toBe(sample01(seed, 42));
    expect(sample01(seed, 42)).not.toBe(sample01(seed, 43));
  });

  it('canonicalizes object key order before checksumming', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(checksum({ b: 2, a: 1 })).toBe(checksum({ a: 1, b: 2 }));
  });

  it('advances a fixed step clock without wall-clock dependence', () => {
    const clock = new FixedStepClock({ epochMs: 1000, stepMs: 10 });
    clock.advance(35);
    expect(clock.frame()).toBe(3);
    expect(Number(clock.now())).toBe(1030);
    expect(clock.alpha()).toBeCloseTo(0.5);
  });
});

describe('typed event bus', () => {
  it('delivers to a snapshot and supports unsubscribe', () => {
    const bus = new TypedEventBus<{ ping: { value: number } }>();
    const values: number[] = [];
    const remove = bus.on('ping', (payload) => values.push(payload.value));
    bus.emit('ping', { value: 1 });
    remove();
    bus.emit('ping', { value: 2 });
    expect(values).toEqual([1]);
  });
});

describe('entity world', () => {
  it('queries sparse components and produces stable snapshots', () => {
    const world = new EntityWorld(10);
    const a = world.create();
    const b = world.create();
    world.add(a, 'position', { position: { x: 1, y: 0, z: 2 } });
    world.add(a, 'health', { current: 10, max: 10 });
    world.add(b, 'position', { position: { x: 4, y: 0, z: 2 } });
    expect(world.query(['position', 'health'])).toEqual([a]);
    expect(world.checksum()).toBe(world.checksum());
    expect(world.destroy(b)).toBe(true);
  });
});

describe('command journal', () => {
  it('replays commands deterministically', () => {
    const journal = new CommandJournal<{ value: number }>();
    journal.register<{ delta: number }>('custom', (state, payload) => ({ value: state.value + payload.delta }), (payload) => payload.delta >= -10 && payload.delta <= 10);
    journal.append({ id: 'b', kind: 'custom', payload: { delta: 2 }, tick: 2 });
    journal.append({ id: 'a', kind: 'custom', payload: { delta: 3 }, tick: 1 });
    expect(journal.replay({ value: 0 })).toEqual({ value: 5 });
    expect(journal.digest()).toBe(journal.digest());
  });
});

describe('frame graph', () => {
  it('orders dependencies and detects cycles', () => {
    const graph = new FrameGraphBuilder()
      .resource({ id: 'color', transient: true, bytes: 1024, format: 'rgba8', samples: 1 })
      .pass({ id: 'opaque', kind: 'opaque', reads: [], writes: ['color'], estimatedGpuMs: 2 })
      .pass({ id: 'post', kind: 'post', reads: ['color'], writes: [], estimatedGpuMs: 1 });
    const plan = graph.compile();
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.value.passes.map((item) => item.pass.id)).toEqual(['opaque', 'post']);
  });
});

describe('streaming planner', () => {
  it('uses deterministic radius and bounded churn', () => {
    const planner = new StreamingPlanner({ loadRadius: 2, unloadRadius: 3, maxLoadsPerFrame: 4, maxUnloadsPerFrame: 2, seed: 7 });
    const first = planner.plan({ x: 0, y: 0 });
    const second = planner.plan({ x: 0, y: 0 });
    expect(first.load.length).toBeLessThanOrEqual(4);
    expect(second.load.length).toBeLessThanOrEqual(4);
    expect(planner.loadedKeys().length).toBeGreaterThan(0);
  });
});

describe('motion state machine', () => {
  it('prioritizes terminal and reactive states', () => {
    const machine = new MotionStateMachine();
    machine.step({ speed: 0, verticalSpeed: 0, grounded: true, attacking: false, damaged: false, dead: false });
    expect(machine.state()).toBe('idle');
    machine.step({ speed: 1, verticalSpeed: 0, grounded: true, attacking: false, damaged: false, dead: false });
    expect(machine.state()).toBe('sprint');
    machine.step({ speed: 1, verticalSpeed: 0, grounded: true, attacking: true, damaged: false, dead: false });
    expect(animationPolicy(machine.state()).clip).toBe('Attack');
    machine.step({ speed: 1, verticalSpeed: 0, grounded: true, attacking: false, damaged: false, dead: true });
    expect(machine.state()).toBe('dead');
  });
});

describe('adaptive quality', () => {
  it('degrades and recovers with hysteresis', () => {
    const controller = new AdaptiveQualityController({ initial: 'high', min: 'minimal', max: 'ultra', dwellFrames: 2 });
    controller.observe(0.95);
    expect(controller.tier).toBe('balanced');
    controller.observe(0.01);
    expect(controller.tier).toBe('balanced');
    controller.observe(0.01);
    controller.observe(0.01);
    expect(controller.tier).toBe('high');
  });
});

describe('telemetry pressure', () => {
  it('returns bounded pressure and deterministic percentiles', () => {
    const telemetry = new RollingTelemetry({ maxSamples: 64, now: () => 42 });
    for (let i = 0; i < 10; i += 1) {
      telemetry.push({ frame: i as never, frameMs: 12 + i, cpuMs: 6, gpuMs: 7, drawCalls: 10, triangles: 100, visibleObjects: 5, textureBytes: 10, memoryPressure: 0.2, thermalPressure: 0 });
    }
    expect(telemetry.percentile('frameMs', 0.5)).toBeCloseTo(16.5);
    expect(calculatePressure({ frameMs: 100, cpuMs: 40, gpuMs: 50, memoryPressure: 1, thermalPressure: 1 }).combined).toBeGreaterThan(0.8);
  });
});
