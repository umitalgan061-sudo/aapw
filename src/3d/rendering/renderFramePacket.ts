// @ts-nocheck
/**
 * Canonical renderer frame packet.
 *
 * A single immutable packet lets the scene renderer consume quality, feature, visibility, instance,
 * texture, temporal-history, recovery and telemetry decisions without reaching back into policy objects.
 * It is intentionally serializable enough for diagnostics and replay while excluding GPU handles.
 *
 * @module renderFramePacket
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const RENDER_FRAME_PACKET_POLICY = freeze({
  id: 'render-frame-packet-2026-09-v1',
  maxVisible: 2048,
  maxBatches: 1024,
  maxTextures: 4096,
  maxEffects: 9,
  maxReasons: 12,
});

function safeId(value, fallback = '') { return String(value ?? fallback).slice(0, 96); }

export function createRenderFramePacket(input = {}) {
  const visible = (Array.isArray(input.visibility?.visible) ? input.visibility.visible : []).slice(0, RENDER_FRAME_PACKET_POLICY.maxVisible).map((item) => freeze({ id: safeId(item.id), lod: safeId(item.lod, 'far'), score: clamp(item.score) }));
  const batches = (Array.isArray(input.instances?.batches) ? input.instances.batches : []).slice(0, RENDER_FRAME_PACKET_POLICY.maxBatches).map((batch) => freeze({ key: safeId(batch.key), instanceCount: Math.max(0, Math.floor(finite(batch.instanceCount))) }));
  const textures = (Array.isArray(input.textures?.resident) ? input.textures.resident : []).slice(0, RENDER_FRAME_PACKET_POLICY.maxTextures).map((texture) => freeze({ id: safeId(texture.id), mip: Math.max(0, Math.floor(finite(texture.mip))), bytes: Math.max(0, finite(texture.bytes)) }));
  const effects = (Array.isArray(input.pipeline?.effects) ? input.pipeline.effects : []).slice(0, RENDER_FRAME_PACKET_POLICY.maxEffects).map((effect) => safeId(effect));
  const reasons = (Array.isArray(input.recoveryReasons) ? input.recoveryReasons : []).slice(0, RENDER_FRAME_PACKET_POLICY.maxReasons).map((value) => safeId(value));
  return freeze({
    schema: RENDER_FRAME_PACKET_POLICY.id,
    frame: Math.max(0, Math.floor(finite(input.frame))),
    timestampMs: Math.max(0, finite(input.timestampMs)),
    backend: input.backend === 'webgpu' ? 'webgpu' : 'webgl2',
    tier: safeId(input.tier, 'balanced'),
    renderScale: clamp(input.renderScale, 0.5, 1),
    visibility: freeze({ visible, deferredCount: Math.max(0, Math.floor(finite(input.visibility?.deferred?.length))) }),
    instances: freeze({ batches, deferredCount: Math.max(0, Math.floor(finite(input.instances?.deferredCount))) }),
    textures: freeze({ resident: textures, deferredCount: Math.max(0, Math.floor(finite(input.textures?.deferred?.length))), utilization: clamp(input.textures?.utilization) }),
    pipeline: freeze({ effects: freeze(effects), estimatedPasses: Math.max(0, Math.floor(finite(input.pipeline?.estimatedPasses))), estimatedEffectMs: Math.max(0, finite(input.pipeline?.estimatedEffectMs)) }),
    temporalHistory: freeze({ valid: Boolean(input.temporalHistory?.valid), confidence: clamp(input.temporalHistory?.confidence) }),
    recovery: freeze({ state: safeId(input.recovery?.state, 'healthy'), reasons: freeze(reasons) }),
  });
}

export function renderFramePacketDigest(packet) {
  if (!packet) return '';
  return [
    packet.frame,
    packet.backend,
    packet.tier,
    packet.renderScale.toFixed(4),
    packet.pipeline.effects.join(','),
    packet.visibility.visible.map((item) => `${item.id}:${item.lod}`).join(','),
    packet.instances.batches.map((item) => `${item.key}:${item.instanceCount}`).join(','),
    packet.textures.resident.map((item) => `${item.id}:${item.mip}`).join(','),
    packet.recovery.state,
    packet.temporalHistory.valid ? 'history:1' : 'history:0',
  ].join('|');
}

export function validateRenderFramePacket(packet) {
  if (!packet || packet.schema !== RENDER_FRAME_PACKET_POLICY.id) return false;
  if (!['webgpu', 'webgl2'].includes(packet.backend)) return false;
  if (!(packet.renderScale >= 0.5 && packet.renderScale <= 1)) return false;
  if (packet.visibility.visible.length > RENDER_FRAME_PACKET_POLICY.maxVisible) return false;
  if (packet.instances.batches.length > RENDER_FRAME_PACKET_POLICY.maxBatches) return false;
  return packet.pipeline.effects.length <= RENDER_FRAME_PACKET_POLICY.maxEffects;
}
