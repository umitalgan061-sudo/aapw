import { describe, expect, it } from 'vitest';
import { RuntimeOrchestratorV3, createDefaultOrchestratorV3 } from '../../src/3d/modern/runtimeOrchestrationV3.ts';

describe('Runtime orchestration v3', () => {
  it('executes stages in dependency and priority order', async () => {
    const order: string[] = [];
    const orchestrator = createDefaultOrchestratorV3({
      input: () => { order.push('input'); },
      simulation: () => { order.push('simulation'); },
      network: () => { order.push('network'); },
      streaming: () => { order.push('streaming'); },
      presentation: () => { order.push('presentation'); },
      save: () => { order.push('save'); },
      telemetry: () => { order.push('telemetry'); },
    });
    const result = await orchestrator.run({ tick: 10, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} });
    expect(result.aborted).toBe(false);
    expect(order.indexOf('input')).toBeLessThan(order.indexOf('simulation'));
    expect(order.indexOf('simulation')).toBeLessThan(order.indexOf('presentation'));
    expect(result.stages).toHaveLength(7);
  });

  it('detects missing dependencies before execution', async () => {
    const orchestrator = new RuntimeOrchestratorV3();
    orchestrator.register({ stage: 'simulation', priority: 1, budgetMs: 1, dependsOn: ['input'], failurePolicy: 'stop', run: () => undefined });
    await expect(orchestrator.run({ tick: 1, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} })).rejects.toThrow(/missing stage/i);
  });

  it('detects dependency cycles', async () => {
    const orchestrator = new RuntimeOrchestratorV3();
    orchestrator.register({ stage: 'input', priority: 1, budgetMs: 1, dependsOn: ['simulation'], failurePolicy: 'stop', run: () => undefined });
    orchestrator.register({ stage: 'simulation', priority: 2, budgetMs: 1, dependsOn: ['input'], failurePolicy: 'stop', run: () => undefined });
    await expect(orchestrator.run({ tick: 1, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} })).rejects.toThrow(/cycle/i);
  });

  it('disables a failing stage when policy requests it', async () => {
    let runs = 0;
    const orchestrator = new RuntimeOrchestratorV3();
    orchestrator.register({ stage: 'input', priority: 1, budgetMs: 1, dependsOn: [], failurePolicy: 'disable', run: () => { runs += 1; throw new Error('boom'); } });
    const first = await orchestrator.run({ tick: 1, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} });
    expect(first.aborted).toBe(false);
    expect(runs).toBe(1);
    await orchestrator.run({ tick: 2, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} });
    expect(runs).toBe(1);
    expect(orchestrator.isEnabled('input')).toBe(false);
  });

  it('supports explicit disable and enable controls', async () => {
    const calls: string[] = [];
    const orchestrator = new RuntimeOrchestratorV3();
    orchestrator.register({ stage: 'telemetry', priority: 1, budgetMs: 1, dependsOn: [], failurePolicy: 'continue', run: () => { calls.push('telemetry'); } });
    orchestrator.disable('telemetry');
    await orchestrator.run({ tick: 1, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} });
    expect(calls).toEqual([]);
    orchestrator.enable('telemetry');
    await orchestrator.run({ tick: 2, dt: 1 / 60, frameBudgetMs: 16.7, metadata: {} });
    expect(calls).toEqual(['telemetry']);
  });

  it('retains an immutable last result for diagnostics', async () => {
    const orchestrator = createDefaultOrchestratorV3({});
    await orchestrator.run({ tick: 42, dt: 1 / 60, frameBudgetMs: 16.7, metadata: { source: 'test' } });
    const result = orchestrator.lastResult();
    expect(result?.tick).toBe(42);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
