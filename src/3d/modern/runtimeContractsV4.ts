/**
 * AAPW v4 runtime contracts.
 *
 * This module is intentionally renderer-agnostic. It is the stable vocabulary shared by
 * simulation, streaming, networking, input and presentation layers.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };
export type RuntimeId = Brand<string, 'RuntimeId'>;
export type EntityIdV4 = Brand<number, 'EntityIdV4'>;
export type TickId = Brand<number, 'TickId'>;
export type AssetIdV4 = Brand<string, 'AssetIdV4'>;
export type CommandId = Brand<string, 'CommandId'>;
export type TraceId = Brand<string, 'TraceId'>;

export const runtimeId = (value: string): RuntimeId => value as RuntimeId;
export const entityIdV4 = (value: number): EntityIdV4 => value as EntityIdV4;
export const tickId = (value: number): TickId => value as TickId;
export const assetIdV4 = (value: string): AssetIdV4 => value as AssetIdV4;
export const commandId = (value: string): CommandId => value as CommandId;
export const traceId = (value: string): TraceId => value as TraceId;

export interface ClockV4 {
  readonly now: () => number;
  readonly tick: (stepMs: number) => number;
}

export interface Vec3V4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuaternionV4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface TransformV4 {
  readonly position: Vec3V4;
  readonly rotation: QuaternionV4;
  readonly scale: Vec3V4;
}

export interface BoundsV4 {
  readonly min: Vec3V4;
  readonly max: Vec3V4;
}

export interface BudgetV4 {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly networkBytes: number;
  readonly assetBytes: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface BudgetUsageV4 extends BudgetV4 {
  readonly frameMs: number;
  readonly activeEntities: number;
  readonly visibleEntities: number;
  readonly queuedAssets: number;
}

export interface BudgetDecisionV4 {
  readonly accepted: boolean;
  readonly pressure: number;
  readonly scale: number;
  readonly reason: string;
  readonly budget: BudgetV4;
}

export type RuntimeSourceV4 = 'engine' | 'ui' | 'network' | 'save' | 'replay' | 'system' | 'worker';
export type RuntimePhaseV4 = 'boot' | 'loading' | 'running' | 'paused' | 'recovering' | 'stopping' | 'stopped' | 'failed';
export type QualityTierV4 = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';

export interface CommandEnvelopeV4<TPayload = unknown> {
  readonly id: CommandId;
  readonly trace: TraceId;
  readonly tick: TickId;
  readonly source: RuntimeSourceV4;
  readonly type: string;
  readonly payload: TPayload;
  readonly createdAt: number;
  readonly expiresAt: number | null;
}

export interface CommandResultV4<TValue = unknown> {
  readonly accepted: boolean;
  readonly applied: boolean;
  readonly value?: TValue;
  readonly error?: RuntimeErrorV4;
}

export interface RuntimeErrorV4 {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly source?: RuntimeSourceV4;
  readonly trace?: TraceId;
  readonly cause?: unknown;
}

export interface EventEnvelopeV4<TPayload = unknown> {
  readonly sequence: number;
  readonly type: string;
  readonly tick: TickId;
  readonly source: RuntimeSourceV4;
  readonly trace: TraceId;
  readonly payload: TPayload;
}

export interface SnapshotHeaderV4 {
  readonly version: number;
  readonly runtime: RuntimeId;
  readonly tick: TickId;
  readonly createdAt: number;
  readonly checksum: string;
}

export interface RuntimeSnapshotV4<TState = unknown> {
  readonly header: SnapshotHeaderV4;
  readonly state: TState;
}

export interface AssetDescriptorV4 {
  readonly id: AssetIdV4;
  readonly url: string;
  readonly kind: 'model' | 'texture' | 'audio' | 'shader' | 'data' | 'font' | 'binary';
  readonly bytes: number;
  readonly priority: number;
  readonly optional: boolean;
  readonly digest: string;
}

export interface AssetLeaseV4 {
  readonly id: AssetIdV4;
  readonly generation: number;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

export interface AssetLoadResultV4 {
  readonly id: AssetIdV4;
  readonly accepted: boolean;
  readonly fromCache: boolean;
  readonly bytes: number;
  readonly durationMs: number;
  readonly lease: AssetLeaseV4 | null;
  readonly error: RuntimeErrorV4 | null;
}

export type InputDeviceV4 = 'keyboard' | 'mouse' | 'pointer' | 'touch' | 'gamepad' | 'xr' | 'virtual';
export type InputModeV4 = 'gameplay' | 'menu' | 'debug' | 'spectator' | 'cinematic';

export interface InputSampleV4 {
  readonly device: InputDeviceV4;
  readonly code: string;
  readonly value: number;
  readonly pressed: boolean;
  readonly timestamp: number;
  readonly sequence: number;
}

export interface InputIntentV4 {
  readonly type: string;
  readonly vector?: Vec3V4;
  readonly scalar?: number;
  readonly digital?: boolean;
  readonly priority: number;
  readonly source: RuntimeSourceV4;
}

export interface RenderViewV4 {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly near: number;
  readonly far: number;
  readonly position: Vec3V4;
  readonly forward: Vec3V4;
}

export interface RenderItemV4 {
  readonly entity: EntityIdV4;
  readonly transform: TransformV4;
  readonly materialKey: string;
  readonly geometryKey: string;
  readonly distance: number;
  readonly priority: number;
  readonly transparent: boolean;
}

export interface RenderPacketV4 {
  readonly frame: number;
  readonly view: RenderViewV4;
  readonly items: readonly RenderItemV4[];
  readonly quality: QualityTierV4;
  readonly budgets: BudgetUsageV4;
}

export interface NetworkPeerV4 {
  readonly id: string;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
  readonly latencyMs: number;
  readonly packetLoss: number;
  readonly authority: 'server' | 'client' | 'spectator';
}

export interface NetworkDeltaV4<T = unknown> {
  readonly version: number;
  readonly tick: TickId;
  readonly source: string;
  readonly payload: T;
  readonly checksum: string;
}

export interface NetworkEnvelopeV4<T = unknown> {
  readonly sequence: number;
  readonly reliable: boolean;
  readonly channel: 'state' | 'command' | 'event' | 'voice' | 'telemetry';
  readonly sentAt: number;
  readonly retries: number;
  readonly payload: T;
}

export interface DiagnosticsCounterV4 {
  readonly name: string;
  readonly value: number;
  readonly unit: 'count' | 'ms' | 'bytes' | 'ratio' | 'score';
}

export interface DiagnosticsSpanV4 {
  readonly name: string;
  readonly durationMs: number;
  readonly trace: TraceId;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeHealthV4 {
  readonly phase: RuntimePhaseV4;
  readonly score: number;
  readonly errors: number;
  readonly warnings: number;
  readonly stalled: boolean;
  readonly memoryPressure: number;
  readonly networkPressure: number;
  readonly renderPressure: number;
  readonly simulationDrift: number;
}

export interface ReleaseGateV4 {
  readonly name: string;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly detail: string;
}

export interface ReleaseReportV4 {
  readonly buildId: string;
  readonly generatedAt: number;
  readonly passed: boolean;
  readonly gates: readonly ReleaseGateV4[];
}

export interface RuntimeStatsV4 {
  readonly frame: number;
  readonly tick: TickId;
  readonly deltaMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly entityCount: number;
  readonly visibleCount: number;
  readonly queuedCommands: number;
  readonly queuedAssets: number;
}

export interface ResultV4<T> {
  readonly ok: true;
  readonly value: T;
}

export interface FailureV4 {
  readonly ok: false;
  readonly error: RuntimeErrorV4;
}

export type OutcomeV4<T> = ResultV4<T> | FailureV4;

export const okV4 = <T>(value: T): ResultV4<T> => ({ ok: true, value });
export const failV4 = (error: RuntimeErrorV4): FailureV4 => ({ ok: false, error });

export function clampV4(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function finiteV4(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function positiveV4(value: unknown, fallback = 1): number {
  const normalized = finiteV4(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

export function vec3V4(x = 0, y = 0, z = 0): Vec3V4 {
  return Object.freeze({ x: finiteV4(x), y: finiteV4(y), z: finiteV4(z) });
}

export function quaternionV4(x = 0, y = 0, z = 0, w = 1): QuaternionV4 {
  const qx = finiteV4(x);
  const qy = finiteV4(y);
  const qz = finiteV4(z);
  const qw = finiteV4(w, 1);
  const magnitude = Math.hypot(qx, qy, qz, qw) || 1;
  return Object.freeze({ x: qx / magnitude, y: qy / magnitude, z: qz / magnitude, w: qw / magnitude });
}

export function transformV4(position = vec3V4(), rotation = quaternionV4(), scale = vec3V4(1, 1, 1)): TransformV4 {
  return Object.freeze({ position, rotation, scale });
}

export function boundsFromCenterV4(center: Vec3V4, halfExtents: Vec3V4): BoundsV4 {
  return Object.freeze({
    min: vec3V4(center.x - Math.abs(halfExtents.x), center.y - Math.abs(halfExtents.y), center.z - Math.abs(halfExtents.z)),
    max: vec3V4(center.x + Math.abs(halfExtents.x), center.y + Math.abs(halfExtents.y), center.z + Math.abs(halfExtents.z)),
  });
}

export function distanceSquaredV4(a: Vec3V4, b: Vec3V4): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

export function distanceV4(a: Vec3V4, b: Vec3V4): number {
  return Math.sqrt(distanceSquaredV4(a, b));
}

export function normalizeVectorV4(vector: Vec3V4): Vec3V4 {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (magnitude <= Number.EPSILON) return vec3V4();
  return vec3V4(vector.x / magnitude, vector.y / magnitude, vector.z / magnitude);
}

export function addV4(a: Vec3V4, b: Vec3V4): Vec3V4 {
  return vec3V4(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function subtractV4(a: Vec3V4, b: Vec3V4): Vec3V4 {
  return vec3V4(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scaleV4(vector: Vec3V4, scalar: number): Vec3V4 {
  const s = finiteV4(scalar);
  return vec3V4(vector.x * s, vector.y * s, vector.z * s);
}

export function lerpV4(a: Vec3V4, b: Vec3V4, alpha: number): Vec3V4 {
  const t = clampV4(finiteV4(alpha), 0, 1);
  return vec3V4(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export function stableListV4<T>(values: readonly T[], compare: (a: T, b: T) => number): readonly T[] {
  return Object.freeze([...values].sort(compare));
}

export function createRuntimeErrorV4(code: string, message: string, retryable = false, source?: RuntimeSourceV4, trace?: TraceId): RuntimeErrorV4 {
  return Object.freeze({ code, message, retryable, source, trace });
}

export function isOutcomeOkV4<T>(outcome: OutcomeV4<T>): outcome is ResultV4<T> {
  return outcome.ok;
}

export function scorePressureV4(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const normalized = values.map((value) => clampV4(finiteV4(value), 0, 1));
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
}

export function createClockV4(now: () => number = () => performance.now()): ClockV4 {
  return {
    now,
    tick(stepMs) {
      return now() + stepMs;
    },
  };
}

export function defaultBudgetV4(tier: QualityTierV4 = 'high'): BudgetV4 {
  switch (tier) {
    case 'minimal': return { cpuMs: 4, gpuMs: 4, networkBytes: 32_000, assetBytes: 2_000_000, drawCalls: 120, triangles: 80_000 };
    case 'low': return { cpuMs: 7, gpuMs: 7, networkBytes: 64_000, assetBytes: 4_000_000, drawCalls: 240, triangles: 180_000 };
    case 'medium': return { cpuMs: 10, gpuMs: 10, networkBytes: 128_000, assetBytes: 8_000_000, drawCalls: 480, triangles: 400_000 };
    case 'ultra': return { cpuMs: 15, gpuMs: 15, networkBytes: 384_000, assetBytes: 16_000_000, drawCalls: 1_200, triangles: 1_500_000 };
    default: return { cpuMs: 12, gpuMs: 12, networkBytes: 256_000, assetBytes: 12_000_000, drawCalls: 800, triangles: 900_000 };
  }
}

export function qualityRankV4(tier: QualityTierV4): number {
  return ({ minimal: 0, low: 1, medium: 2, high: 3, ultra: 4 })[tier];
}

export function tierFromRankV4(rank: number): QualityTierV4 {
  const normalized = clampV4(Math.round(rank), 0, 4);
  return (['minimal', 'low', 'medium', 'high', 'ultra'] as const)[normalized]!;
}
