import { describe, expect, it } from 'vitest';
import { AssetGateR31 } from '../../../src/3d/strict/r31/assetGateR31.ts';
import { chooseQualityTierR31 } from '../../../src/3d/strict/r31/capabilityPolicyR31.ts';
import { LoadSheddingControllerR31 } from '../../../src/3d/strict/r31/loadSheddingR31.ts';
import { TypeScriptOwnershipBoundaryR31 } from '../../../src/3d/strict/r31/migrationBoundaryR31.ts';

describe('R31 security, capability and migration policies', () => {
  it('orders a dependency graph deterministically and reports cycles', () => {
    const gate = new AssetGateR31();
    gate.register({ id: 'base', url: 'https://assets.example/base.glb', bytes: 10, dependencies: [], critical: true });
    gate.register({ id: 'hero', url: 'https://assets.example/hero.glb', bytes: 20, dependencies: ['base'], critical: true });
    const report = gate.validate();
    expect(report.ok).toBe(true);
    expect(report.orderedIds).toEqual(['base', 'hero']);
  });

  it('selects quality from capability signals', () => {
    const decision = chooseQualityTierR31({
      webgl2: true,
      offscreenCanvas: true,
      serviceWorker: true,
      hardwareConcurrency: 16,
      deviceMemoryGb: 32,
      maxTextureSize: 16384,
      coarsePointer: false,
    });
    expect(decision.tier).toBe('ultra');
    expect(decision.entityBudget).toBeGreaterThan(1000);
  });

  it('sheds low-priority work as load pressure rises', () => {
    const controller = new LoadSheddingControllerR31();
    for (let i = 0; i < 20; i++) {
      controller.observe({
        phase: 'render',
        budgetMs: 5,
        observedMs: 20,
        queueDepth: 90,
        queueCapacity: 100,
      });
    }
    expect(controller.state().pressure).toBeGreaterThan(0.55);
    expect(controller.shouldRun('background')).toBe(false);
  });

  it('requires parity evidence before ownership promotion or retirement', () => {
    const boundary = new TypeScriptOwnershipBoundaryR31();
    boundary.register({
      id: 'player',
      legacyPath: 'src/3d/gameplay/player.js',
      typedPath: 'src/3d/gameplay/player.ts',
      state: 'shadow',
    });
    expect(boundary.promote('player').ok).toBe(false);
    expect(boundary.parity('player', true).ok).toBe(true);
    expect(boundary.promote('player').ok).toBe(true);
    expect(boundary.retire('player').ok).toBe(true);
  });
});
