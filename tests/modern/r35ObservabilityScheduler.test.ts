import { describe, expect, it } from 'vitest';
import { R35Observability, phaseBudgetMap } from '../../src/3d/nextgen/r35';
import { createDefaultR35Budgets } from '../../src/3d/nextgen/r35/worldScheduler';

describe('R35 observability and scheduler governance', () => {
  it('produces budget diagnostics from bounded metric history', () => {
    const budgets = createDefaultR35Budgets();
    const observability = new R35Observability(64);
    for (let tick = 1; tick <= 40; tick += 1) {
      observability.sample('simulation', tick, tick % 2 === 0 ? 4 : 8, 4.5);
    }
    const diagnostics = observability.budgetDiagnostics(phaseBudgetMap(budgets));
    const simulation = diagnostics.find((entry) => entry.phase === 'simulation');
    expect(simulation).toBeDefined();
    expect(simulation?.severity).toBe('critical');
  });

  it('creates trace spans without leaking active span state', () => {
    const observability = new R35Observability();
    const id = observability.beginSpan('render', 'frame', 10, 100);
    const result = observability.endSpan(id, 108);
    expect(result?.durationMs).toBe(8);
    expect(observability.trace()).toHaveLength(1);
  });

  it('builds a bounded health report and degrades on faults', () => {
    const budgets = phaseBudgetMap(createDefaultR35Budgets());
    const observability = new R35Observability(32);
    observability.increment('faults', 2);
    observability.sample('network', 1, 2.5, budgets.get('network')!);
    const report = observability.health('running', 1, budgets);
    expect(report.score).toBeLessThan(100);
    expect(report.ok).toBe(false);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('maps priorities into deterministic scheduling weights', () => {
    const observability = new R35Observability();
    observability.sample('ai', 1, 0.5, 1.6);
    const health = observability.health('running', 1, phaseBudgetMap(createDefaultR35Budgets()));
    expect(health.metrics.some((metric) => metric.domain === 'ai')).toBe(true);
  });
});
