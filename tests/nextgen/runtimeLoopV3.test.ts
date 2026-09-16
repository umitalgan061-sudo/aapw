import { describe, expect, it } from 'vitest';
import { createNextGenRuntime } from '../../src/3d/nextgen/runtimeFacadeV3';
import { FixedStepControllerV3 } from '../../src/3d/nextgen/fixedStepControllerV3';
import { RuntimeLoopV3 } from '../../src/3d/nextgen/runtimeLoopV3';

describe('fixed step controller', () => {
  it('runs at most the configured catch-up step count', () => {
    const controller = new FixedStepControllerV3({ fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 2, maxAccumulatedSeconds: 0.5 });
    let steps = 0;
    const result = controller.consume(0.5, () => { steps += 1; });
    expect(steps).toBe(2);
    expect(result.steps).toBe(2);
    expect(result.droppedSeconds).toBeGreaterThan(0);
  });

  it('exposes a normalized interpolation alpha', () => {
    const controller = new FixedStepControllerV3({ fixedDeltaSeconds: 0.1, maxCatchUpSteps: 4, maxAccumulatedSeconds: 0.4 });
    controller.consume(0.05, () => undefined);
    expect(controller.interpolationAlpha()).toBeCloseTo(0.5, 5);
  });
});

describe('runtime loop', () => {
  it('keeps simulation deterministic while render time varies', async () => {
    const runtime = createNextGenRuntime({ navigationWidth: 8, navigationHeight: 8, navigationCellSize: 2 });
    runtime.createPlayer();
    const loop = new RuntimeLoopV3(runtime, { fixedDeltaSeconds: 0.1, maxCatchUpSteps: 3, maxAccumulatedSeconds: 0.3 });
    await loop.frame(100);
    const firstTick = runtime.kernel.clock.tick;
    await loop.frame(450);
    const secondTick = runtime.kernel.clock.tick;
    expect(secondTick - firstTick).toBeLessThanOrEqual(3);
    expect(loop.state.frameCount).toBe(2);
    expect(loop.state.simulationSteps).toBeGreaterThan(0);
  });
});
