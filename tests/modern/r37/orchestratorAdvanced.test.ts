import { describe, expect, it } from 'vitest';
import { RuntimeOrchestratorR37 } from '../../../src/3d/strict/r37/orchestrator.ts';

describe('R37 orchestrator advanced lifecycle', () => {
  it('registers content, applies budget requests and exposes diagnostics', () => {
    const orchestrator = new RuntimeOrchestratorR37({ maxEntities: 64 });
    expect(orchestrator.addContent({
      id: 'hero',
      kind: 'character',
      url: 'hero.glb',
      version: 1,
      bytes: 100,
      tags: ['player'],
    })).toBe(true);
    const grants = orchestrator.applySystemBudgetRequests();
    expect(grants.length).toBe(3);
    orchestrator.step({ deltaSeconds: 1 / 60, cameraPosition: { x: 0, y: 0, z: 0 } });
    expect(orchestrator.diagnosticsReport().metrics).toBeDefined();
  });

  it('rejects future authoritative reconciliation without mutating the runtime', () => {
    const orchestrator = new RuntimeOrchestratorR37({ seed: 9 });
    const local = orchestrator.runtime.world.snapshot();
    const future = { ...local, tick: local.tick + 10 };
    const result = orchestrator.planReconciliation(future, local);
    expect(result.accepted).toBe(false);
    expect(orchestrator.runtime.world.tick).toBe(local.tick);
  });
});
