import { describe, expect, it } from 'vitest';
import { RuntimeKernel } from '../../src/3d/nextgen/runtimeKernel';
import { createNetworkEntity } from '../../src/3d/nextgen/networkProtocolV3';
import { createDefaultTelemetry } from '../../src/3d/nextgen/runtimeTelemetryV3';
import { validateCombinedRuntime, validateNetworkSnapshot, validatePerformance, validateRuntimeSnapshot } from '../../src/3d/nextgen/runtimeContractsV3';

describe('runtime contracts', () => {
  it('accepts a valid runtime snapshot', () => {
    const kernel = new RuntimeKernel();
    const id = kernel.world.createEntity();
    kernel.world.setTransform(id, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    const report = validateRuntimeSnapshot(kernel.saveSnapshot());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('rejects a transform for an unknown entity', () => {
    const kernel = new RuntimeKernel();
    const snapshot = kernel.saveSnapshot();
    snapshot.transforms.push({ id: 99, value: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } });
    const report = validateRuntimeSnapshot(snapshot);
    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.includes('unknown entity'))).toBe(true);
  });

  it('rejects duplicate network entity ids', () => {
    const one = createNetworkEntity(1, { x: 0, y: 0, z: 0 });
    const two = createNetworkEntity(1, { x: 2, y: 0, z: 0 });
    const report = validateNetworkSnapshot({ version: 3, serverTick: 2, baselineTick: 1, ackSequence: 1, entities: [one, two] });
    expect(report.valid).toBe(false);
  });

  it('fails a budget that exceeds frame limits', () => {
    const telemetry = createDefaultTelemetry();
    const report = validatePerformance({ frameP95Ms: 22, simulationP95Ms: 1, renderP95Ms: 1, networkP95Ms: 1, streamingP95Ms: 1, avgEntityCount: 1, avgDrawCalls: 10, droppedSamples: 0 }, { queued: 0, loading: 0, ready: 0, failed: 0, residentBytes: 0, inflight: 0 }, 1);
    expect(report.valid).toBe(false);
    expect(report.errors[0]).toMatch(/frame p95/);
    void telemetry;
  });

  it('combines errors and warnings from all domains', () => {
    const kernel = new RuntimeKernel();
    const network = { version: 3, serverTick: 1, baselineTick: 1, ackSequence: 0, entities: [createNetworkEntity(2, { x: 0, y: 0, z: 0 }), createNetworkEntity(1, { x: 0, y: 0, z: 0 })] };
    const report = validateCombinedRuntime(kernel.saveSnapshot(), network, { queued: 0, loading: 0, ready: 0, failed: 0, residentBytes: 0, inflight: 0 }, { frameP95Ms: 1, simulationP95Ms: 1, renderP95Ms: 1, networkP95Ms: 1, streamingP95Ms: 1, avgEntityCount: 0, avgDrawCalls: 1, droppedSamples: 0 }, 0);
    expect(report.valid).toBe(false);
    expect(report.checks).toBeGreaterThan(0);
  });
});
