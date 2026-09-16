/**
 * AAPW Runtime V5 contracts.
 *
 * V5 standardises the boundary between simulation, rendering, input, assets,
 * persistence and networking. The contracts are intentionally data-only so
 * worker, browser and headless implementations can share them.
 */
export type RuntimeIdV5 = string & { readonly __runtimeIdV5: unique symbol };
export type TickV5 = number & { readonly __tickV5: unique symbol };
export type EntityIdV5 = number & { readonly __entityIdV5: unique symbol };
export type SequenceV5 = number & { readonly __sequenceV5: unique symbol };
export type BrandV5 = 'desktop' | 'tablet' | 'mobile' | 'constrained' | 'headless';
export type RuntimePhaseV5 = 'created' | 'starting' | 'running' | 'paused' | 'recovering' | 'stopping' | 'stopped' | 'failed';
export type SeverityV5 = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type QualityV5 = 'minimal' | 'balanced' | 'high' | 'ultra';
export type AuthorityV5 = 'local' | 'remote' | 'server' | 'predicted';
export type ResultCodeV5 = 'ok' | 'invalid' | 'busy' | 'denied' | 'stale' | 'overflow' | 'not-found' | 'failed';

export interface Vec3V5 { readonly x: number; readonly y: number; readonly z: number; }
export interface QuatV5 { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface TransformV5 { readonly position: Vec3V5; readonly rotation: QuatV5; readonly scale: Vec3V5; }
export interface BoundsV5 { readonly min: Vec3V5; readonly max: Vec3V5; readonly radius: number; }
export interface BudgetV5 {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly memoryBytes: number;
  readonly networkBytes: number;
  readonly assetBytes: number;
}
export interface BudgetUsageV5 extends BudgetV5 {
  readonly frameRatio: number;
  readonly cpuRatio: number;
  readonly gpuRatio: number;
  readonly drawRatio: number;
  readonly triangleRatio: number;
  readonly memoryRatio: number;
  readonly networkRatio: number;
  readonly assetRatio: number;
  readonly pressure: number;
}
export interface RuntimeErrorV5 {
  readonly code: string;
  readonly message: string;
  readonly severity: SeverityV5;
  readonly retryable: boolean;
  readonly tick: TickV5;
  readonly cause?: unknown;
}
export interface OutcomeV5<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: RuntimeErrorV5;
}
export interface RuntimeSnapshotV5 {
  readonly runtimeId: RuntimeIdV5;
  readonly tick: TickV5;
  readonly phase: RuntimePhaseV5;
  readonly brand: BrandV5;
  readonly quality: QualityV5;
  readonly entities: readonly EntityStateV5[];
  readonly sequence: SequenceV5;
  readonly checksum: string;
}
export interface EntityStateV5 {
  readonly id: EntityIdV5;
  readonly authority: AuthorityV5;
  readonly transform: TransformV5;
  readonly velocity: Vec3V5;
  readonly tags: readonly string[];
  readonly active: boolean;
  readonly revision: number;
}
export interface RuntimeHealthV5 {
  readonly score: number;
  readonly phase: RuntimePhaseV5;
  readonly degraded: boolean;
  readonly errors: number;
  readonly droppedFrames: number;
  readonly recoveryCount: number;
  readonly pressure: number;
}
export interface InputCommandV5 {
  readonly sequence: SequenceV5;
  readonly tick: TickV5;
  readonly action: string;
  readonly value: number;
  readonly vector?: Vec3V5;
  readonly device: 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'programmatic';
  readonly priority: number;
}
export interface NetworkEnvelopeV5<T = unknown> {
  readonly sequence: SequenceV5;
  readonly tick: TickV5;
  readonly channel: 'state' | 'command' | 'event' | 'snapshot' | 'control';
  readonly reliable: boolean;
  readonly payload: T;
  readonly checksum: string;
}
export interface AssetDescriptorV5 {
  readonly id: string;
  readonly url: string;
  readonly type: 'model' | 'texture' | 'audio' | 'shader' | 'data' | 'binary';
  readonly bytes: number;
  readonly version: string;
  readonly digest: string;
  readonly dependencies: readonly string[];
  readonly required: boolean;
}
export interface AssetStateV5 {
  readonly id: string;
  readonly status: 'declared' | 'queued' | 'loading' | 'ready' | 'failed' | 'evicted';
  readonly bytes: number;
  readonly attempts: number;
  readonly priority: number;
}
export interface RenderObjectV5 {
  readonly id: EntityIdV5;
  readonly transform: TransformV5;
  readonly bounds: BoundsV5;
  readonly material: string;
  readonly lod: 0 | 1 | 2 | 3;
  readonly visible: boolean;
  readonly distance: number;
}
export interface RenderPacketV5 {
  readonly tick: TickV5;
  readonly objects: readonly RenderObjectV5[];
  readonly camera: RenderCameraV5;
  readonly quality: QualityV5;
}
export interface RenderCameraV5 { readonly position: Vec3V5; readonly forward: Vec3V5; readonly fov: number; readonly near: number; readonly far: number; }
export interface PersistenceEnvelopeV5<T = unknown> {
  readonly schema: string;
  readonly version: number;
  readonly tick: TickV5;
  readonly createdAt: number;
  readonly payload: T;
  readonly checksum: string;
}
export interface RecoveryPlanV5 {
  readonly reason: string;
  readonly domains: readonly ('input' | 'simulation' | 'assets' | 'network' | 'render' | 'persistence')[];
  readonly maxAttempts: number;
  readonly cooldownMs: number;
}
export interface RuntimeEventV5<T = unknown> {
  readonly type: string;
  readonly tick: TickV5;
  readonly sequence: SequenceV5;
  readonly payload: T;
}

export const runtimeIdV5 = (value: string): RuntimeIdV5 => value as RuntimeIdV5;
export const tickV5 = (value: number): TickV5 => Math.max(0, Math.floor(value)) as TickV5;
export const entityIdV5 = (value: number): EntityIdV5 => Math.max(1, Math.floor(value)) as EntityIdV5;
export const sequenceV5 = (value: number): SequenceV5 => Math.max(0, Math.floor(value)) as SequenceV5;
export const vec3V5 = (x = 0, y = 0, z = 0): Vec3V5 => Object.freeze({ x, y, z });
export const quatV5 = (x = 0, y = 0, z = 0, w = 1): QuatV5 => Object.freeze({ x, y, z, w });
export const identityTransformV5 = (): TransformV5 => Object.freeze({ position: vec3V5(), rotation: quatV5(), scale: vec3V5(1, 1, 1) });
export const defaultBudgetV5 = (): BudgetV5 => Object.freeze({ frameMs: 16.67, cpuMs: 8, gpuMs: 8, drawCalls: 1500, triangles: 1_500_000, memoryBytes: 512 * 1024 * 1024, networkBytes: 1_000_000, assetBytes: 64 * 1024 * 1024 });

export function okV5<T>(value: T): OutcomeV5<T> { return Object.freeze({ ok: true, value }); }
export function failV5(code: string, message: string, tick = tickV5(0), severity: SeverityV5 = 'error', retryable = false, cause?: unknown): OutcomeV5<never> {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, severity, retryable, tick, cause }) });
}
export function finiteV5(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
export function clampV5(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, finiteV5(value, min))); }
export function distanceSqV5(a: Vec3V5, b: Vec3V5): number { const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z; return x * x + y * y + z * z; }
export function magnitudeV5(v: Vec3V5): number { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
export function normalizeV5(v: Vec3V5): Vec3V5 { const length = magnitudeV5(v); return length > 1e-8 ? vec3V5(v.x / length, v.y / length, v.z / length) : vec3V5(0, 0, 1); }
export function addV5(a: Vec3V5, b: Vec3V5): Vec3V5 { return vec3V5(a.x + b.x, a.y + b.y, a.z + b.z); }
export function scaleV5(v: Vec3V5, scalar: number): Vec3V5 { return vec3V5(v.x * scalar, v.y * scalar, v.z * scalar); }
export function lerpV5(a: Vec3V5, b: Vec3V5, alpha: number): Vec3V5 { const t = clampV5(alpha, 0, 1); return vec3V5(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
export function stableStringifyV5(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringifyV5).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyV5(record[key])}`).join(',')}}`;
}
export function checksumV5(value: unknown): string {
  const text = typeof value === 'string' ? value : stableStringifyV5(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    hashA = Math.imul(hashA ^ text.charCodeAt(i), 0x01000193);
    hashB = Math.imul(hashB ^ text.charCodeAt(i), 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0).toString(16).padStart(8, '0')}`;
}

export function sanitizeTagsV5(tags: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().slice(0, 48)).filter(Boolean))].sort());
}
export function createEntityStateV5(id: EntityIdV5, initial: Partial<EntityStateV5> = {}): EntityStateV5 {
  return Object.freeze({
    id,
    authority: initial.authority ?? 'local',
    transform: initial.transform ?? identityTransformV5(),
    velocity: initial.velocity ?? vec3V5(),
    tags: sanitizeTagsV5(initial.tags ?? []),
    active: initial.active ?? true,
    revision: Number.isInteger(initial.revision) ? Math.max(0, initial.revision as number) : 0,
  });
}
export function compareTickV5(a: TickV5, b: TickV5): -1 | 0 | 1 { return a < b ? -1 : a > b ? 1 : 0; }
export function isTerminalPhaseV5(phase: RuntimePhaseV5): boolean { return phase === 'stopped' || phase === 'failed'; }
export function nextPhaseV5(current: RuntimePhaseV5, action: 'start' | 'pause' | 'resume' | 'recover' | 'stop' | 'fail'): RuntimePhaseV5 {
  if (action === 'fail') return 'failed';
  if (action === 'stop') return current === 'stopped' ? current : 'stopping';
  if (action === 'recover') return current === 'recovering' ? current : 'recovering';
  if (action === 'start') return current === 'created' || current === 'stopped' ? 'starting' : current;
  if (action === 'pause') return current === 'running' ? 'paused' : current;
  if (action === 'resume') return current === 'paused' || current === 'starting' || current === 'recovering' ? 'running' : current;
  return current;
}
