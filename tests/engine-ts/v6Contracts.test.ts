import { describe, expect, it } from 'vitest';
import { BrowserEngineFacade, createEngineFrameInput } from '../../src/engine-ts/publicFacade.js';
import { CommandRuntime } from '../../src/engine-ts/commandRuntime.js';
import { EventRuntime } from '../../src/engine-ts/eventRuntime.js';
import { BehaviorRuntime } from '../../src/engine-ts/behaviorRuntime.js';
import { PerformanceRuntime } from '../../src/engine-ts/performanceRuntime.js';
import { ReleaseRuntime } from '../../src/engine-ts/releaseRuntime.js';
import { RuntimeManifestRegistry } from '../../src/engine-ts/runtimeManifest.js';
import { RuntimeControlPlane } from '../../src/engine-ts/runtimeControlPlane.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('v6 public facade', () => {
  it('creates a stable frame input contract', () => {
    const input = createEngineFrameInput(1 / 60, { inputTick: 7 });
    expect(input.deltaSeconds).toBeCloseTo(1 / 60);
    expect(input.inputTick).toBe(7);
    expect(input.commands).toEqual([]);
  });

  it('supports headless start and stop lifecycle', async () => {
    const facade = new BrowserEngineFacade({ autoLifecycle: false });
    expect(await facade.start()).toBe(true);
    facade.stop();
    expect(facade.snapshot().runtime).toBeNull();
  });
});

describe('command runtime', () => {
  it('executes by tick, priority and handler registration order', () => {
    const commands = new CommandRuntime({ now: () => 10 });
    const seen: string[] = [];
    commands.register({ type: 'test', priority: 10, handle: command => { seen.push(String(command.id)); return { ok: true, value: command.id }; } });
    commands.enqueue({ id: 'b', tick: 2, source: 'system', type: 'test', actor: null, payload: {}, priority: 1, createdAt: 0, expiresAt: null });
    commands.enqueue({ id: 'a', tick: 1, source: 'system', type: 'test', actor: null, payload: {}, priority: 1, createdAt: 0, expiresAt: null });
    const results = commands.execute(2);
    expect(results.every(result => result.ok)).toBe(true);
    expect(seen).toEqual(['a', 'b']);
  });

  it('expires commands before dispatch', () => {
    const commands = new CommandRuntime({ now: () => 100 });
    commands.register({ type: 'test', priority: 1, handle: () => ({ ok: true, value: true }) });
    commands.enqueue({ id: 'x', tick: 1, source: 'system', type: 'test', actor: null, payload: {}, priority: 1, createdAt: 0, expiresAt: 90 });
    expect(commands.execute(1)[0]?.ok).toBe(false);
    expect(commands.stats().expired).toBe(1);
  });
});

describe('event runtime', () => {
  it('delivers wildcard and once subscriptions exactly once', () => {
    const events = new EventRuntime();
    let wildcard = 0;
    let once = 0;
    events.subscribe('*', () => { wildcard += 1; });
    events.subscribe('hello', () => { once += 1; }, true);
    events.publish('hello', { value: 1 }, 1);
    events.publish('hello', { value: 2 }, 2);
    events.flush();
    expect(wildcard).toBe(2);
    expect(once).toBe(1);
  });
});

describe('behavior runtime', () => {
  it('keeps behavior state isolated between actors', () => {
    const behavior = new BehaviorRuntime();
    const root = { id: 'root', kind: 'sequence' as const, children: [{ id: 'action', kind: 'action' as const, children: [], action: context => { context.blackboard.set('ran', true); return 'success'; } }] };
    const first = ENTITY_ID('a');
    const second = ENTITY_ID('b');
    behavior.register(first, root);
    behavior.register(second, root);
    behavior.tick(first, 1);
    behavior.tick(second, 1);
    expect(behavior.state(first, 'root').status).toBe('success');
    expect(behavior.state(second, 'root').status).toBe('success');
    expect(behavior.blackboard(first, 'ran')).toBe(true);
    expect(behavior.blackboard(second, 'ran')).toBe(true);
  });
});

describe('performance runtime', () => {
  it('respects explicit quality forcing', () => {
    const performance = new PerformanceRuntime({}, 'high');
    performance.force('minimal');
    expect(performance.tier).toBe('minimal');
    expect(performance.budget().cpuMs).toBeLessThan(performance.base.cpuMs);
  });
});

describe('release runtime', () => {
  it('orders gates deterministically and reports warning counts separately', () => {
    const release = new ReleaseRuntime({}, () => 50);
    const report = release.evaluate('build', { typecheck: true, tests: true, build: true, deterministic: true, errorRate: 0.01, p95FrameMs: 12, memoryRatio: 0.96, unhandledExceptions: 0, legacySurfaces: 20 });
    expect(report.passed).toBe(true);
    expect(report.summary.warnings).toBe(2);
    expect(report.gates.map(gate => gate.id)).toEqual([...report.gates].map(gate => gate.id).sort());
  });
});

describe('runtime manifest', () => {
  it('fails deterministically on dependency cycles', () => {
    const registry = new RuntimeManifestRegistry();
    registry.register({ id: 'a', version: '1', entry: 'a', capabilities: [], dependencies: ['b'], hash: 'a', enabled: true });
    registry.register({ id: 'b', version: '1', entry: 'b', capabilities: [], dependencies: ['a'], hash: 'b', enabled: true });
    expect(() => registry.dependencyOrder()).toThrow('MANIFEST_DEPENDENCY_CYCLE');
  });
});

describe('control plane', () => {
  it('records operator actions in bounded audit history', async () => {
    const control = new RuntimeControlPlane();
    await control.boot();
    const result = await control.execute({ id: 'quality', command: 'set-quality', payload: 'medium', issuedAt: 0, operator: 'ci' });
    expect(result.accepted).toBe(true);
    expect(control.audit()).toHaveLength(1);
    expect(control.snapshot().phase).toBe('ready');
    control.dispose();
  });
});
