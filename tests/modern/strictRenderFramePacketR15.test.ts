import { describe, expect, it } from 'vitest';

import {
  RENDER_FRAME_PACKET_POLICY,
  createRenderFramePacket,
  renderFramePacketDigest,
  validateRenderFramePacket,
} from '../../src/3d/rendering/renderFramePacket.ts';

describe('R15 strict render frame packet', () => {
  it('creates a bounded immutable packet and stable digest', () => {
    const input = {
      frame: 17,
      timestampMs: 283.4,
      backend: 'webgpu',
      tier: 'quality',
      renderScale: 0.87,
      visibility: {
        visible: Array.from(
          { length: RENDER_FRAME_PACKET_POLICY.maxVisible + 50 },
          (_, index) => ({ id: `entity-${index}`, lod: 'near', score: 0.9 }),
        ),
        deferred: [1, 2, 3],
      },
      instances: {
        batches: [{ key: 'trees', instanceCount: 9000 }],
        deferredCount: 7,
      },
      textures: {
        resident: [{ id: 'atlas', mip: 2, bytes: 8_000_000 }],
        deferred: [1],
        utilization: 1.2,
      },
      pipeline: {
        effects: Array.from({ length: RENDER_FRAME_PACKET_POLICY.maxEffects + 3 }, () => 'bloom'),
        estimatedPasses: 12,
        estimatedEffectMs: 3.5,
      },
      temporalHistory: { valid: true, confidence: 0.81 },
      recovery: { state: 'healthy', reasons: ['none'] },
    };

    const first = createRenderFramePacket(input);
    const second = createRenderFramePacket(input);

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.visibility)).toBe(true);
    expect(first.visibility.visible.length).toBe(RENDER_FRAME_PACKET_POLICY.maxVisible);
    expect(first.pipeline.effects.length).toBe(RENDER_FRAME_PACKET_POLICY.maxEffects);
    expect(first.renderScale).toBe(0.87);
    expect(first.textures.utilization).toBe(1);
    expect(validateRenderFramePacket(first)).toBe(true);
    expect(renderFramePacketDigest(first)).toBe(renderFramePacketDigest(second));
  });

  it('rejects malformed packets at the presentation boundary', () => {
    expect(validateRenderFramePacket(null)).toBe(false);
    expect(validateRenderFramePacket({ schema: RENDER_FRAME_PACKET_POLICY.id })).toBe(false);

    const packet = createRenderFramePacket({ backend: 'webgl2', frame: 0 });
    expect(validateRenderFramePacket(packet)).toBe(true);
    expect(validateRenderFramePacket({ ...packet, renderScale: 2 })).toBe(false);
  });
});
