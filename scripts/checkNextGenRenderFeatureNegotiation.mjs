import assert from 'node:assert/strict';
import { negotiateRenderFeatures, renderFeatureDigest, validateFeatureContract } from '../src/3d/rendering/renderFeatureNegotiator.js';
import { createRenderFramePacket, renderFramePacketDigest, validateRenderFramePacket } from '../src/3d/rendering/renderFramePacket.js';

const requested = ['webgpu', 'mrt', 'temporalHistory', 'ssgi', 'dof', 'taa', 'bloom', 'ssao', 'lut', 'fog', 'instancing', 'occlusionHints', 'dynamicResolution'];
const high = negotiateRenderFeatures(requested, {
  backend: 'webgpu', tier: 'ultra', webgpuAvailable: true, hardwareScore: 0.95, thermalPressure: 0.2,
  reducedMotion: false, multiviewAvailable: true, textureCompression: true,
});
assert.equal(validateFeatureContract(high), true);
assert.ok(high.enabled.includes('webgpu'));
assert.ok(high.enabled.includes('ssgi'));
assert.ok(high.enabled.includes('mrt'));

const fallback = negotiateRenderFeatures(requested, {
  backend: 'webgpu', tier: 'ultra', webgpuAvailable: false, hardwareScore: 0.95, thermalPressure: 0.2,
});
assert.equal(fallback.backend, 'webgl2');
assert.ok(!fallback.enabled.includes('webgpu'));
assert.ok(!fallback.enabled.includes('ssgi'));
assert.ok(fallback.rejected.includes('ssgi'));

const constrained = negotiateRenderFeatures(requested, {
  backend: 'webgpu', tier: 'high', webgpuAvailable: true, hardwareScore: 0.3, thermalPressure: 0.95,
  reducedMotion: true, multiviewAvailable: false,
});
assert.ok(!constrained.enabled.includes('dof'));
assert.ok(!constrained.enabled.includes('ssgi'));
assert.ok(!constrained.enabled.includes('temporalHistory'));
assert.ok(constrained.enabled.includes('instancing'));

const reordered = negotiateRenderFeatures([...requested].reverse(), {
  backend: 'webgpu', tier: 'ultra', webgpuAvailable: true, hardwareScore: 0.95, thermalPressure: 0.2,
});
assert.equal(renderFeatureDigest(high), renderFeatureDigest(reordered));

const packet = createRenderFramePacket({
  frame: 12, timestampMs: 200, backend: 'webgpu', tier: 'high', renderScale: 0.82,
  visibility: { visible: [{ id: 'hero', lod: 'hero', score: 1 }, { id: 'tree', lod: 'mid', score: 0.4 }], deferred: [1, 2] },
  instances: { batches: [{ key: 'g|m|near', instanceCount: 120 }], deferredCount: 22 },
  textures: { resident: [{ id: 'albedo', mip: 2, bytes: 1024 }], deferred: [1, 2], utilization: 0.8 },
  pipeline: { effects: ['taa', 'bloom'], estimatedPasses: 4, estimatedEffectMs: 2.3 },
  temporalHistory: { valid: true, confidence: 0.9 },
  recovery: { state: 'healthy', reasons: [] },
});
assert.equal(validateRenderFramePacket(packet), true);
assert.equal(renderFramePacketDigest(packet), renderFramePacketDigest(createRenderFramePacket({ ...packet })));
assert.equal(Object.isFrozen(packet), true);
assert.equal(Object.isFrozen(packet.visibility), true);

const bounded = createRenderFramePacket({ visibility: { visible: Array.from({ length: 10000 }, (_, i) => ({ id: `v-${i}`, lod: 'far', score: 0.1 })) }, pipeline: { effects: Array(100).fill('bloom') } });
assert.ok(bounded.visibility.visible.length <= 2048);
assert.ok(bounded.pipeline.effects.length <= 9);

console.log('next-gen render feature/frame contract: PASS');
