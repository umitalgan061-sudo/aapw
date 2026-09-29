import { describe, expect, it } from 'vitest';
import { evaluateAudioGraphHealth, smoothGraphPressure } from '../../src/3d/audio/audioGraphSafetyMonitor.ts';
import { SpatialAudioRegistry } from '../../src/3d/audio/spatialAudioRegistry.ts';
import { buildSpatialRegistration, routingConstants } from '../../src/3d/audio/audioCueRouter.ts';
import { createRenderHealthSupervisor } from '../../src/3d/rendering/renderHealthSupervisor.ts';

describe('R10 strict runtime hardening', () => {
  it('classifies audio pressure deterministically and smoothly', () => {
    const nominal = evaluateAudioGraphHealth({ sourceCount: 2, positionalCount: 1 });
    const critical = evaluateAudioGraphHealth({
      sourceCount: 24,
      sourceLimit: 16,
      positionalCount: 12,
      positionalLimit: 8,
      generatedBufferCount: 8,
      bufferLimit: 6,
      contextState: 'running',
    });

    expect(nominal.state).toBe('healthy');
    expect(nominal.action).toBe('none');
    expect(critical.state).toBe('critical');
    expect(critical.action).toBe('stop-optional');
    expect(smoothGraphPressure(0, 1, 0.016)).toBeGreaterThan(0);
    expect(smoothGraphPressure(1, 0, 0.016)).toBeLessThan(1);
  });

  it('keeps spatial source admission bounded and deterministic', () => {
    const registry = new SpatialAudioRegistry({ maxSources: 2, maxPositionalSources: 1, maxDistance: 100 });
    registry.register({ id: 'far', position: { x: 40, y: 0, z: 0 }, priority: 10 });
    registry.register({ id: 'near', position: { x: 2, y: 0, z: 0 }, priority: 90 });
    const admission = registry.selectAdmissions({ listenerPosition: { x: 0, y: 0, z: 0 } });

    expect(admission.admitted).toBe(2);
    expect(admission.sources[0]?.id).toBe('near');
    expect(registry.snapshot().sourceCount).toBe(2);
    registry.dispose();
  });

  it('exposes stable cue routing and render-health decisions', () => {
    expect(routingConstants().routes.UI).toBe('ui');
    const registration = buildSpatialRegistration('unknown-cue', {
      position: { x: 1, y: 0, z: 2 },
      maxDistance: 90,
    });
    expect(registration === null || typeof registration.spatial === 'boolean').toBe(true);

    const supervisor = createRenderHealthSupervisor();
    const healthy = supervisor.evaluate({
      frameMs: 12,
      gpuMs: 8,
      cpuMs: 5,
      memoryUtilization: 0.3,
      thermalPressure: 0.1,
      passDescriptors: [
        { id: 'geometry', costMs: 2, priority: 1, optional: false },
        { id: 'bloom', costMs: 1.5, priority: 0.3, optional: true },
      ],
    });
    expect(healthy.overallAction).toBe('retain');
    expect(healthy.passBudget.accepted.length).toBeGreaterThan(0);

    const critical = supervisor.evaluate({
      frameMs: 45,
      gpuMs: 40,
      cpuMs: 35,
      memoryUtilization: 0.98,
      thermalPressure: 0.96,
      emergencyPassBudget: true,
      passDescriptors: [
        { id: 'geometry', costMs: 3, priority: 1, optional: false },
        { id: 'bloom', costMs: 2, priority: 0.2, optional: true },
      ],
    });
    expect(critical.pressure.state).toBe('critical');
    expect(critical.overallAction).toBe('shed');
  });
});
