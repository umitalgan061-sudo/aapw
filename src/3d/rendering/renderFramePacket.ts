/**
 * Canonical immutable renderer frame packet.
 *
 * This is the last renderer-neutral boundary before GPU/Three.js presentation. It is deliberately
 * plain-data, bounded, deterministic and serializable for replay/telemetry.
 */

export const RENDER_FRAME_PACKET_POLICY = Object.freeze({
  id: 'render-frame-packet-2026-09-r15',
  maxVisible: 2048,
  maxBatches: 1024,
  maxTextures: 4096,
  maxEffects: 9,
  maxReasons: 12,
  maxIdentifierLength: 96,
  minRenderScale: 0.5,
  maxRenderScale: 1,
});

export interface RenderVisibleItem {
  readonly id: string;
  readonly lod: string;
  readonly score: number;
}

export interface RenderInstanceBatch {
  readonly key: string;
  readonly instanceCount: number;
}

export interface RenderResidentTexture {
  readonly id: string;
  readonly mip: number;
  readonly bytes: number;
}

export interface RenderFramePacket {
  readonly schema: string;
  readonly frame: number;
  readonly timestampMs: number;
  readonly backend: 'webgpu' | 'webgl2';
  readonly tier: string;
  readonly renderScale: number;
  readonly visibility: {
    readonly visible: readonly RenderVisibleItem[];
    readonly deferredCount: number;
  };
  readonly instances: {
    readonly batches: readonly RenderInstanceBatch[];
    readonly deferredCount: number;
  };
  readonly textures: {
    readonly resident: readonly RenderResidentTexture[];
    readonly deferredCount: number;
    readonly utilization: number;
  };
  readonly pipeline: {
    readonly effects: readonly string[];
    readonly estimatedPasses: number;
    readonly estimatedEffectMs: number;
  };
  readonly temporalHistory: {
    readonly valid: boolean;
    readonly confidence: number;
  };
  readonly recovery: {
    readonly state: string;
    readonly reasons: readonly string[];
  };
}

export interface RenderFramePacketInput {
  readonly frame?: unknown;
  readonly timestampMs?: unknown;
  readonly backend?: unknown;
  readonly tier?: unknown;
  readonly renderScale?: unknown;
  readonly visibility?: Readonly<{ visible?: unknown; deferred?: unknown }>;
  readonly instances?: Readonly<{ batches?: unknown; deferredCount?: unknown }>;
  readonly textures?: Readonly<{ resident?: unknown; deferred?: unknown; utilization?: unknown }>;
  readonly pipeline?: Readonly<{ effects?: unknown; estimatedPasses?: unknown; estimatedEffectMs?: unknown }>;
  readonly temporalHistory?: Readonly<{ valid?: unknown; confidence?: unknown }>;
  readonly recovery?: Readonly<{ state?: unknown; reasons?: unknown }>;
  readonly recoveryReasons?: unknown;
}

function finite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegativeInt(value: unknown): number {
  return Math.max(0, Math.floor(finite(value)));
}

function clamp(value: unknown, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function safeId(value: unknown, fallback = ''): string {
  const text = value == null ? fallback : String(value);
  return text.slice(0, RENDER_FRAME_PACKET_POLICY.maxIdentifierLength);
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createRenderFramePacket(input: RenderFramePacketInput = {}): RenderFramePacket {
  const visible = arrayValue(input.visibility?.visible)
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxVisible)
    .map((item): RenderVisibleItem => {
      const value = isRecord(item) ? item : {};
      return Object.freeze({
        id: safeId(value.id),
        lod: safeId(value.lod, 'far'),
        score: clamp(value.score, 0, 1),
      });
    });

  const batches = arrayValue(input.instances?.batches)
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxBatches)
    .map((item): RenderInstanceBatch => {
      const value = isRecord(item) ? item : {};
      return Object.freeze({
        key: safeId(value.key),
        instanceCount: nonNegativeInt(value.instanceCount),
      });
    });

  const textures = arrayValue(input.textures?.resident)
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxTextures)
    .map((item): RenderResidentTexture => {
      const value = isRecord(item) ? item : {};
      return Object.freeze({
        id: safeId(value.id),
        mip: nonNegativeInt(value.mip),
        bytes: Math.max(0, finite(value.bytes)),
      });
    });

  const effects = arrayValue(input.pipeline?.effects)
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxEffects)
    .map((value) => safeId(value));

  const reasonsSource = Array.isArray(input.recoveryReasons)
    ? input.recoveryReasons
    : input.recovery?.reasons;
  const reasons = arrayValue(reasonsSource)
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxReasons)
    .map((value) => safeId(value));

  return Object.freeze({
    schema: RENDER_FRAME_PACKET_POLICY.id,
    frame: nonNegativeInt(input.frame),
    timestampMs: Math.max(0, finite(input.timestampMs)),
    backend: input.backend === 'webgpu' ? 'webgpu' : 'webgl2',
    tier: safeId(input.tier, 'balanced'),
    renderScale: clamp(
      input.renderScale,
      RENDER_FRAME_PACKET_POLICY.minRenderScale,
      RENDER_FRAME_PACKET_POLICY.maxRenderScale,
    ),
    visibility: Object.freeze({
      visible: Object.freeze(visible),
      deferredCount: arrayLength(input.visibility?.deferred),
    }),
    instances: Object.freeze({
      batches: Object.freeze(batches),
      deferredCount: nonNegativeInt(input.instances?.deferredCount),
    }),
    textures: Object.freeze({
      resident: Object.freeze(textures),
      deferredCount: arrayLength(input.textures?.deferred),
      utilization: clamp(input.textures?.utilization, 0, 1),
    }),
    pipeline: Object.freeze({
      effects: Object.freeze(effects),
      estimatedPasses: nonNegativeInt(input.pipeline?.estimatedPasses),
      estimatedEffectMs: Math.max(0, finite(input.pipeline?.estimatedEffectMs)),
    }),
    temporalHistory: Object.freeze({
      valid: Boolean(input.temporalHistory?.valid),
      confidence: clamp(input.temporalHistory?.confidence, 0, 1),
    }),
    recovery: Object.freeze({
      state: safeId(input.recovery?.state, 'healthy'),
      reasons: Object.freeze(reasons),
    }),
  });
}

export function renderFramePacketDigest(packet: RenderFramePacket): string {
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
    packet.recovery.reasons.join(','),
    packet.temporalHistory.valid ? 'history:1' : 'history:0',
  ].join('|');
}

export function validateRenderFramePacket(packet: unknown): packet is RenderFramePacket {
  if (!isRecord(packet) || packet.schema !== RENDER_FRAME_PACKET_POLICY.id) return false;
  if (packet.backend !== 'webgpu' && packet.backend !== 'webgl2') return false;
  if (typeof packet.frame !== 'number' || !Number.isInteger(packet.frame) || packet.frame < 0) return false;
  if (typeof packet.timestampMs !== 'number' || packet.timestampMs < 0) return false;
  if (typeof packet.renderScale !== 'number') return false;
  if (packet.renderScale < RENDER_FRAME_PACKET_POLICY.minRenderScale || packet.renderScale > RENDER_FRAME_PACKET_POLICY.maxRenderScale) return false;

  if (!isRecord(packet.visibility) || !Array.isArray(packet.visibility.visible)) return false;
  if (!isRecord(packet.instances) || !Array.isArray(packet.instances.batches)) return false;
  if (!isRecord(packet.textures) || !Array.isArray(packet.textures.resident)) return false;
  if (!isRecord(packet.pipeline) || !Array.isArray(packet.pipeline.effects)) return false;
  if (!isRecord(packet.temporalHistory) || !isRecord(packet.recovery)) return false;

  if (packet.visibility.visible.length > RENDER_FRAME_PACKET_POLICY.maxVisible) return false;
  if (packet.instances.batches.length > RENDER_FRAME_PACKET_POLICY.maxBatches) return false;
  if (packet.textures.resident.length > RENDER_FRAME_PACKET_POLICY.maxTextures) return false;
  if (packet.pipeline.effects.length > RENDER_FRAME_PACKET_POLICY.maxEffects) return false;
  return true;
}
