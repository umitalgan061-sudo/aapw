import { describe, expect, it } from 'vitest';
import { LegacyFrameObserverR31 } from '../../../src/3d/strict/r31/legacyFrameObserverR31.ts';

describe('R31 legacy frame observer', () => {
  it('bridges live frame metrics into strict diagnostics without owning simulation', () => {
    let frameMs = 12;
    const observer = new LegacyFrameObserverR31({
      sample: () => ({
        frameMs,
        rendererCalls: 20,
        rendererTriangles: 1000,
        loadedChunks: 9,
        activeNpcs: 4,
        activeAnimals: 2,
        activeCreatures: 6,
        activeDragons: 1,
        paused: false,
      }),
    });
    observer.update({
      frame: 1,
      simulationTick: 1,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 1 / 60,
      alpha: 0,
      phase: 'diagnostics',
    });
    frameMs = 28;
    observer.update({
      frame: 2,
      simulationTick: 2,
      deltaSeconds: 1 / 60,
      elapsedSeconds: 2 / 60,
      alpha: 0,
      phase: 'diagnostics',
    });
    expect(observer.diagnostics().frames).toBe(2);
    expect(observer.diagnostics().last?.rendererTriangles).toBe(1000);
    expect(observer.diagnostics().diagnostics.maxFrameMs).toBe(28);
    observer.reset();
    expect(observer.diagnostics().frames).toBe(0);
  });
});
