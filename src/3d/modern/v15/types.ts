export type Brand<T, B extends string> = T & { readonly __brand: B };
export type FrameIdV15 = Brand<number, "FrameIdV15">;
export type TickV15 = Brand<number, "TickV15">;
export type SequenceV15 = Brand<number, "SequenceV15">;
export type RevisionV15 = Brand<number, "RevisionV15">;
export type AssetIdV15 = Brand<string, "AssetIdV15">;
export type ChunkIdV15 = Brand<string, "ChunkIdV15">;

export interface Vec2V15 { readonly x: number; readonly y: number }
export interface Vec3V15 { readonly x: number; readonly y: number; readonly z: number }

export type QualityTierV15 = "minimal" | "balanced" | "high" | "ultra";
export type RuntimeModeV15 = "foreground" | "background" | "paused" | "suspended";
export type RendererBackendV15 = "webgpu" | "webgl2";
export type HealthStateV15 = "healthy" | "degraded" | "critical";

export interface DeviceCapabilitiesV15 {
  readonly backend: RendererBackendV15;
  readonly webgpuAvailable: boolean;
  readonly webgl2Available: boolean;
  readonly mobile: boolean;
  readonly touch: boolean;
  readonly reducedMotion: boolean;
  readonly batterySaver: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly devicePixelRatio: number;
  readonly maxTextureDimension: number | null;
  readonly timestamp: number;
}

export interface FrameObservationV15 {
  readonly frame: FrameIdV15;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
  readonly timestampMs: number;
}

export interface QualityDecisionV15 {
  readonly tier: QualityTierV15;
  readonly renderScale: number;
  readonly pixelRatioCap: number;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  readonly maxVisibleObjects: number;
  readonly dynamicResolution: boolean;
  readonly shadows: boolean;
  readonly temporalEffects: boolean;
  readonly reason: string;
}

export interface SchedulerBudgetV15 {
  readonly inputMs: number;
  readonly simulationMs: number;
  readonly streamingMs: number;
  readonly presentationMs: number;
  readonly networkMs: number;
  readonly persistenceMs: number;
  readonly maxCatchUpTicks: number;
}

export interface FrameResultV15 {
  readonly frame: FrameIdV15;
  readonly simulatedTicks: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
  readonly mode: RuntimeModeV15;
  readonly budget: SchedulerBudgetV15;
}

export interface InputIntentV15 {
  readonly sequence: SequenceV15;
  readonly timestampMs: number;
  readonly move: Vec2V15;
  readonly look: Vec2V15;
  readonly buttons: number;
  readonly actions: readonly string[];
  readonly source: "keyboard" | "pointer" | "touch" | "gamepad" | "replay" | "system";
}

export interface AssetDescriptorV15 {
  readonly id: AssetIdV15;
  readonly url: string;
  readonly priority: number;
  readonly tags: readonly string[];
  readonly critical: boolean;
  readonly expectedMime?: string;
  readonly digestSha256?: string;
}

export type AssetStateV15 = "declared" | "queued" | "loading" | "ready" | "failed" | "stale" | "evicted";

export interface AssetRecordV15 extends AssetDescriptorV15 {
  readonly state: AssetStateV15;
  readonly loadedBytes: number;
  readonly references: number;
  readonly attempts: number;
  readonly version: number;
  readonly lastUsedTick: TickV15;
  readonly error?: string;
}

export interface ChunkSpecV15 {
  readonly id: ChunkIdV15;
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
  readonly estimatedBytes: number;
  readonly generationMs: number;
  readonly critical: boolean;
  readonly biome: string;
}

export type ChunkStateV15 = "absent" | "desired" | "queued" | "loading" | "resident" | "cooldown";

export interface ChunkRecordV15 extends ChunkSpecV15 {
  readonly state: ChunkStateV15;
  readonly score: number;
  readonly lastDesiredTick: TickV15;
  readonly lastResidentTick: TickV15;
}

export interface StreamInterestV15 {
  readonly id: string;
  readonly position: Vec3V15;
  readonly velocity: Vec3V15;
  readonly viewDistance: number;
  readonly priority: number;
}

export interface StreamDecisionV15 {
  readonly chunk: ChunkIdV15;
  readonly action: "load" | "unload" | "keep" | "prefetch";
  readonly score: number;
  readonly reason: string;
}

export interface NetworkEnvelopeV15<T = unknown> {
  readonly protocol: number;
  readonly kind: string;
  readonly sequence: SequenceV15;
  readonly ack: SequenceV15;
  readonly tick: TickV15;
  readonly payload: T;
  readonly checksum: number;
}

export interface NetworkStatsV15 {
  readonly sent: number;
  readonly received: number;
  readonly dropped: number;
  readonly bytesOut: number;
  readonly bytesIn: number;
  readonly retransmits: number;
  readonly rttMs: number;
  readonly state: "offline" | "connecting" | "online" | "degraded";
}

export interface SaveEnvelopeV15<T = unknown> {
  readonly magic: "AAPW-SAVE-V15";
  readonly version: 15;
  readonly revision: RevisionV15;
  readonly tick: TickV15;
  readonly createdAt: number;
  readonly payload: T;
  readonly checksum: number;
}

export interface RuntimeHealthV15 {
  readonly state: HealthStateV15;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly observation: FrameObservationV15;
  readonly quality: QualityDecisionV15;
  readonly capabilities: DeviceCapabilitiesV15;
}

export function frameV15(value: number): FrameIdV15 {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("frame must be a non-negative integer");
  return value as FrameIdV15;
}

export function tickV15(value: number): TickV15 {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("tick must be a non-negative integer");
  return value as TickV15;
}

export function sequenceV15(value: number): SequenceV15 {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("sequence must be a non-negative integer");
  return value as SequenceV15;
}

export function revisionV15(value: number): RevisionV15 {
  if (!Number.isInteger(value) || value < 0) throw new RangeError("revision must be a non-negative integer");
  return value as RevisionV15;
}

export function assetIdV15(value: string): AssetIdV15 {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new RangeError("invalid asset id");
  return normalized as AssetIdV15;
}

export function chunkIdV15(value: string): ChunkIdV15 {
  const normalized = value.trim();
  if (!/^[-+]?[0-9]+:[-+]?[0-9]+$/.test(normalized)) throw new RangeError("invalid chunk id");
  return normalized as ChunkIdV15;
}

export function clampV15(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function saturateV15(value: number): number {
  return clampV15(value, 0, 1);
}

export function distanceSquaredV15(a: Vec3V15, b: Vec3V15): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distanceV15(a: Vec3V15, b: Vec3V15): number {
  return Math.sqrt(distanceSquaredV15(a, b));
}

export function stableStringifyV15(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringifyV15).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + stableStringifyV15(item)).join(",") + "}";
}

export function hashStringV15(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function checksumV15(value: unknown): number {
  return hashStringV15(stableStringifyV15(value));
}

export function cloneVec2V15(value: Vec2V15): Vec2V15 { return { x: value.x, y: value.y }; }
export function cloneVec3V15(value: Vec3V15): Vec3V15 { return { x: value.x, y: value.y, z: value.z }; }

export const DEFAULT_SCHEDULER_BUDGET_V15: SchedulerBudgetV15 = Object.freeze({
  inputMs: 1,
  simulationMs: 6,
  streamingMs: 4,
  presentationMs: 9,
  networkMs: 2,
  persistenceMs: 1,
  maxCatchUpTicks: 8,
});

export const QUALITY_ORDER_V15: readonly QualityTierV15[] = ["minimal", "balanced", "high", "ultra"];
