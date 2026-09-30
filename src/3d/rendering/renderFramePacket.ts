/**
 * Canonical immutable renderer frame packet.
 *
 * Renderer policies produce this plain-data packet at the presentation boundary. GPU handles never
 * cross this boundary. The packet is bounded, deterministic and safe to serialize for diagnostics,
 * replay and regression testing.
 */

export const RENDER_FRAME_PACKET_POLICY = Object.freeze({
  id: 'render-frame-packet-2026-09-r14',
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

export interface RenderPipelinePacket {
  readonly effects: readonly string[];
  readonly estimatedPasses: number;
  readonly estimatedEffectMs: number;
}

export interface RenderTemporalHistoryPacket {
  readonly valid: boolean;
  readonly confidence: number;
}

export interface RenderRecoveryPacket {
  readonly state: string;
  readonly reasons: readonly string[];
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
  readonly pipeline: RenderPipelinePacket;
  readonly temporalHistory: RenderTemporalHistoryPacket;
  readonly recovery: RenderRecoveryPacket;
}

export interface RenderFramePacketInput {
  readonly frame?: unknown;
  readonly timestampMs?: unknown;
  readonly backend?: unknown;
  readonly tier?: unknown;
  readonly renderScale?: unknown;
  readonly visibility?: {
    readonly visible?: unknown;
    readonly deferred?: unknown;
  };
  readonly instances?: {
    readonly batches?: unknown;
    readonly deferredCount?: unknown;
  };
  readonly textures?: {
    readonly resident?: unknown;
    readonly deferred?: unknown;
    readonly utilization?: unknown;
  };
  readonly pipeline?: {
    readonly effects?: unknown;
    readonly estimatedPasses?: unknown;
    readonly estimatedEffectMs?: unknown;
  };
  readonly temporalHistory?: {
    readonly valid?: unknown;
    readonly confidence?: unknown;
  };
  readonly recovery?: {
    readonly state?: unknown;
    readonly reasons?: unknown;
  };
  readonly recoveryReasons?: unknown;
}

function finite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(finite(value, fallback)));
}

function clamp(value: unknown, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function safeId(value: unknown, fallback = ''): string {
  const text = value == null ? fallback : String(value);
  return text.slice(0, RENDER_FRAME_PACKET_POLICY.maxIdentifierLength);
}

function readonlyArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze(items.slice());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createRenderFramePacket(input: RenderFramePacketInput = {}): RenderFramePacket {
  const rawVisible = isRecord(input.visibility) && Array.isArray(input.visibility.visible)
    ? input.visibility.visible
    : [];
  const visible = rawVisible
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxVisible)
    .map((item: unknown): RenderVisibleItem => {
      const record = isRecord(item) ? item : {};
      return Object.freeze({
        id: safeId(record.id),
        lod: safeId(record.lod, 'far'),
        score: clamp(record.score, 0, 1),
      });
    });

  const rawBatches = isRecord(input.instances) && Array.isArray(input.instances.batches)
    ? input.instances.batches
    : [];
  const batches = rawBatches
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxBatches)
    .map((item: unknown): RenderInstanceBatch => {
      const record = isRecord(item) ? item : {};
      return Object.freeze({
        key: safeId(record.key),
        instanceCount: nonNegativeInt(record.instanceCount),
      });
    });

  const rawTextures = isRecord(input.textures) && Array.isArray(input.textures.resident)
    ? input.textures.resident
    : [];
  const textures = rawTextures
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxTextures)
    .map((item: unknown): RenderResidentTexture => {
      const record = isRecord(item) ? item : {};
      return Object.freeze({
        id: safeId(record.id),
        mip: nonNegativeInt(record.mip),
        bytes: Math.max(0, finite(record.bytes)),
      });
    });

  const rawEffects = isRecord(input.pipeline) && Array.isArray(input.pipeline.effects)
    ? input.pipeline.effects
    : [];
  const effects = rawEffects
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxEffects)
    .map((effect: unknown) => safeId(effect));

  const rawReasons = Array.isArray(input.recoveryReasons)
    ? input.recoveryReasons
    : isRecord(input.recovery) && Array.isArray(input.recovery.reasons)
      ? input.recovery.reasons
      : [];
  const reasons = rawReasons
    .slice(0, RENDER_FRAME_PACKET_POLICY.maxReasons)
    .map((reason: unknown) => safeId(reason));

  const packet: RenderFramePacket = {
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
      visible: readonlyArray(visible),
      deferredCount: nonNegativeInt(
        isRecord(input.visibility) ? input.visibility.deferred && Array.isArray(input.visibility.deferred) ? input.visibility.deferred.length : input.visibility.deferred : 0,
      ),
    }),
    instances: Object.freeze({
      batches: readonlyArray(batches),
      deferredCount: nonNegativeInt(
        isRecord(input.instances) ? input.instances.deferredCount : 0,
      ),
    }),
    textures: Object.freeze({
      resident: readonlyArray(textures),
      deferredCount: nonNegativeInt(
        isRecord(input.textures) ? input.textures.deferred && Array.isArray(input.textures.deferred) ? input.textures.deferred.length : input.textures.deferred : 0,
      ),
      utilization: clamp(isRecord(input.textures) ? input.textures.utilization : 0, 0, 1),
    }),
    pipeline: Object.freeze({
      effects: readonlyArray(effects),
      estimatedPasses: nonNegativeInt(
        isRecord(input.pipeline) ? input.pipeline.estimatedPasses : 0,
      ),
      estimatedEffectMs: Math.max(
        0,
        finite(isRecord(input.pipeline) ? input.pipeline.estimatedEffectMs : 0),
      ),
    }),
    temporalHistory: Object.freeze({
      valid: isRecord(input.temporalHistory) ? Boolean(input.temporalHistory.valid) : false,
      confidence: clamp(
        isRecord(input.temporalHistory) ? input.temporalHistory.confidence : 0,
        0,
        1,
      ),
    }),
    recovery: Object.freeze({
      state: safeId(isRecord(input.recovery) ? input.recovery.state : undefined, 'healthy'),
      reasons: readonlyArray(reasons),
    }),
  };

  return Object.freeze(packet);
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
  if (typeof packet.renderScale !== 'number' || packet.renderScale < RENDER_FRAME_PACKET_POLICY.minRenderScale || packet.renderScale > RENDER_FRAME_PACKET_POLICY.maxRenderScale) return false;

  const visibility = packet.visibility;
  const instances = packet.instances;
  const textures = packet.textures;
  const pipeline = packet.pipeline;
  if (!isRecord(visibility) || !Array.isArray(visibility.visible)) return false;
  if (!isRecord(instances) || !Array.isArray(instances.batches)) return false;
  if (!isRecord(textures) || !Array.isArray(textures.resident)) return false;
  if (!isRecord(pipeline) || !Array.isArray(pipeline.effects)) return false;

  if (visibility.visible.length > RENDER_FRAME_PACKET_POLICY.maxVisible) return false;
  if (instances.batches.length > RENDER_FRAME_PACKET_POLICY.maxBatches) return false;
  if (textures.resident.length > RENDER_FRAME_PACKET_POLICY.maxTextures) return false;
  if (pipeline.effects.length > RENDER_FRAME_PACKET_POLICY.maxEffects) return false;
  return true;
}
