import assert from 'node:assert/strict';
import { createNextGenRenderOrchestrator } from '../src/3d/rendering/nextGenRenderOrchestrator.js';
import { validateRenderFramePacket, renderFramePacketDigest } from '../src/3d/rendering/renderFramePacket.js';
import { validateFeatureContract } from '../src/3d/rendering/renderFeatureNegotiator.js';
import { validateRenderDegradationPacket } from '../src/3d/rendering/renderDegradationPolicy.js';

const renderables = [
  { id: 'hero', distance: 4, screenCoverage: 0.8, importance: 1.5, visible: true, frustumVisible: true, geometryKey: 'hero', materialKey: 'skin' },
  { id: 'tree-1', distance: 24, screenCoverage: 0.4, importance: 0.7, visible: true, frustumVisible: true, geometryKey: 'tree', materialKey: 'leaf' },
  { id: 'rock-1', distance: 48, screenCoverage: 0.2, importance: 0.4, visible: true, frustumVisible: true, geometryKey: 'rock', materialKey: 'stone' },
];
const instances = Array.from({ length: 80 }, (_, i) => ({
  id: `grass-${i}`,
  distance: 20 + i,
  screenCoverage: 0.15,
  importance: 0.35,
  visible: true,
  geometryKey: 'grass',
  materialKey: 'grass-material',
}));
const textures = [
  { id: 'hero-albedo', width: 2048, height: 2048, format: 'rgba8', distance: 4, screenCoverage: 0.8, importance: 1.5, compressed: true, persistent: true },
  { id: 'world-albedo', width: 2048, height: 2048, format: 'rgba8', distance: 60, screenCoverage: 0.1, importance: 0.4, compressed: true },
];

const runtime = createNextGenRenderOrchestrator({ initialRenderScale: 0.9 });
const frame = runtime.renderFrame({
  backend: 'webgpu', webgpuAvailable: true, runtimeTier: 'ultra', hardwareScore: 0.95,
  width: 1920, height: 1080, frameMs: 14, gpuMs: 8, cpuMs: 4, memoryUtilization: 0.4,
  thermalPressure: 0.2, renderables, instances, textures,
  requestedFeatures: ['mrt', 'temporalHistory', 'taa', 'bloom', 'instancing', 'textureCompression', 'occlusionHints', 'dynamicResolution'],
  shaderRequests: [{ features: { skinning: true, normalMap: true, fog: true }, materialFamily: 'standard' }],
  timestampMs: 100, triangles: 350000,
});

assert.equal(validateFeatureContract(frame.features), true);
assert.equal(validateRenderDegradationPacket(frame.degradation), true);
assert.equal(validateRenderFramePacket(frame.packet), true);
assert.equal(frame.packetDigest, renderFramePacketDigest(frame.packet));
assert.ok(frame.packet.visibility.visible.length >= 1);
assert.ok(frame.packet.instances.batches.length >= 1);
assert.ok(frame.packet.textures.resident.length >= 1);
assert.ok(frame.temporalHistory.frame >= 1);

const critical = runtime.renderFrame({
  backend: 'webgpu', webgpuAvailable: true, runtimeTier: 'ultra', hardwareScore: 0.95,
  width: 1920, height: 1080, frameMs: 48, gpuMs: 44, cpuMs: 10, memoryUtilization: 0.98,
  thermalPressure: 0.98, renderables: renderables.concat(renderables), instances: instances.concat(instances), textures,
  requestedFeatures: ['mrt', 'temporalHistory', 'ssgi', 'dof', 'taa', 'bloom'], timestampMs: 200,
});
assert.ok(['aggressive', 'safe'].includes(critical.degradation.mode));
assert.ok(critical.degradation.effectBudgetMultiplier <= 1);
assert.ok(critical.resolution.scale <= frame.resolution.scale);

runtime.dispose();
assert.equal(runtime.disposed, true);
console.log('next-gen render runtime surface: PASS');
