import { describe, expect, it } from 'vitest';
import { FixedStepSimulation } from '../src/3d/modern/fixedStepSimulation';

describe('fixed-step simulation', () => {
  it('advances bodies in stable fixed steps', () => {
    const simulation = new FixedStepSimulation({ config: { stepMs: 10, maxStepsPerFrame: 8 } });
    simulation.upsert({
      id: 'hero',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 1, y: 0, z: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      maxSpeed: 10,
      drag: 0,
      grounded: true,
    });
    const result = simulation.advance(50);
    expect(result.steps).toBe(5);
    expect(simulation.get('hero')?.position.x).toBeCloseTo(0.05, 3);
  });

  it('caps huge frame gaps instead of spiralling into unbounded work', () => {
    const simulation = new FixedStepSimulation({ config: { stepMs: 16, maxStepsPerFrame: 4, maxDeltaMs: 64 } });
    const result = simulation.advance(5_000);
    expect(result.steps).toBe(4);
    expect(result.droppedSeconds).toBeGreaterThan(4);
  });
});
