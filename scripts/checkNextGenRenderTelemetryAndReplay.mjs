import assert from 'node:assert/strict';
import { createNextGenRenderOrchestrator } from '../src/3d/rendering/nextGenRenderOrchestrator.js';
import { createRenderFramePacket, renderFramePacketDigest } from '../src/3d/rendering/renderFramePacket.js';
import { evaluateGpuPressure } from '../src/3d/rendering/gpuPressureModel.js';
import { createTemporalHistoryController } from '../src/3d/rendering/renderTemporalHistoryPolicy.js';

const renderables = Array.from({ length: 180 }, (_, index) => ({
  id: `replay-${index}`,
  distance: index * 2,
  screenCoverage: Math.max(0.01, 1 - index / 200),
  importance: index % 19 === 0 ? 1.5 : 0.5,
  visible: index % 17 !== 0,
  frustumVisible: index % 29 !== 0,
  geometryKey: `g-${index % 12}`,
  materialKey: `m-${index % 6}`,
}));
const inputs = {
  backend: 'webgpu',
  runtimeTier: 'high',
  hardwareScore: 0.82,
  frameMs: 15.8,
  cpuMs: 4.1,
  gpuMs: 9.7,
  width: 1600,
  height: 900,
  renderables,
  instances: renderables,
  textures: renderables.slice(0, 40).map((item, index) => ({ id: `tex-${index}`, width: 1024, height: 1024, format: 'rgba8', distance: item.distance, screenCoverage: item.screenCoverage, importance: item.importance, compressed: index % 2 === 0 })),
  shaderRequests: [{ features: { skinning: true, fog: true, normalMap: true }, materialFamily: 'standard' }],
  triangles: 1200000,
  timestampMs: 100,
};

function run() {
  const runtime = createNextGenRenderOrchestrator();
  const frame = runtime.renderFrame(inputs);
  const packet = createRenderFramePacket({
    ...frame,
    tier: frame.pipeline.tier,
    renderScale: frame.resolution.scale,
    temporalHistory: { valid: false, confidence: 0 },
    recovery: frame.recovery,
  });
  const digest = renderFramePacketDigest(packet);
  const diagnostics = runtime.diagnostics();
  runtime.dispose();
  return { frame, packet, digest, diagnostics };
}

const first = run();
const second = run();
assert.equal(first.digest, second.digest, 'identical render inputs must produce the same packet digest');
assert.equal(first.diagnostics.metrics.counters['backend.webgpu'], second.diagnostics.metrics.counters['backend.webgpu']);
assert.equal(first.frame.visibility.visible.length, second.frame.visibility.visible.length);
assert.deepEqual(first.packet.pipeline, second.packet.pipeline);

const pressureNominal = evaluateGpuPressure({ frameMs: 12, gpuMs: 7, cpuMs: 3, memoryUtilization: 0.5, thermalPressure: 0.2 });
const pressureCritical = evaluateGpuPressure({ frameMs: 42, gpuMs: 38, cpuMs: 8, memoryUtilization: 0.98, thermalPressure: 0.95 });
assert.equal(pressureNominal.state, 'nominal');
assert.equal(pressureCritical.state, 'critical');

const temporal = createTemporalHistoryController({ initialScale: 0.85 });
temporal.update({ timestampMs: 0, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
for (let i = 1; i <= 8; i += 1) temporal.update({ timestampMs: i * 16, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
assert.equal(temporal.valid, true);
const reset = temporal.update({ timestampMs: 1500, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
assert.equal(reset.valid, false);
assert.equal(reset.lastReason, 'visibility-gap');

console.log(JSON.stringify({ digest: first.digest, visible: first.frame.visibility.visible.length, instances: first.frame.instances.batches.length, textureResident: first.frame.textures.resident.length, pressureNominal: pressureNominal.state, pressureCritical: pressureCritical.state }));
