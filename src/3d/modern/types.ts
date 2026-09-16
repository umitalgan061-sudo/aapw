/**
 * Modern platform contracts shared by gameplay, rendering, streaming and persistence.
 *
 * This module deliberately contains plain data-only types. Keeping the contracts serializable
 * makes it possible to move expensive systems into workers later without redesigning their APIs.
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type EntityId = Brand<string, 'EntityId'>;
export type WorldSeed = Brand<number, 'WorldSeed'>;
export type UnixMillis = Brand<number, 'UnixMillis'>;
export type FrameId = Brand<number, 'FrameId'>;

export type Result<T, E = PlatformError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface PlatformError {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly retryable: boolean;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface CameraState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly dpr: number;
}

export type RenderBackend = 'webgpu' | 'webgl2' | 'canvas2d' | 'headless';
export type QualityTier = 'minimal' | 'balanced' | 'high' | 'ultra';
export type RenderPassKind = 'shadow' | 'depth' | 'opaque' | 'transparent' | 'post' | 'ui' | 'compute';

export interface GpuLimits {
  readonly maxTextureDimension2D: number;
  readonly maxUniformBufferBindingSize: number;
  readonly maxSampledTexturesPerShaderStage: number;
  readonly maxColorAttachments: number;
  readonly maxBindGroups: number;
}

export interface RenderCapabilities {
  readonly backend: RenderBackend;
  readonly webgpu: boolean;
  readonly timestampQueries: boolean;
  readonly floatTextures: boolean;
  readonly depthTexture: boolean;
  readonly instancing: boolean;
  readonly compressedTextures: boolean;
  readonly limits: GpuLimits;
}

export interface PerformanceSample {
  readonly timestamp: UnixMillis;
  readonly frame: FrameId;
  readonly frameMs: number;
  readonly gpuMs?: number;
  readonly cpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
}

export interface PressureState {
  readonly cpu: number;
  readonly gpu: number;
  readonly frame: number;
  readonly memory: number;
  readonly thermal: number;
  readonly combined: number;
}

export interface SchedulerBudget {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly maxTasks: number;
}

export interface TaskContext {
  readonly now: UnixMillis;
  readonly frame: FrameId;
  readonly signal: AbortSignal;
  readonly budget: SchedulerBudget;
}

export type TaskPriority = 0 | 1 | 2 | 3 | 4;
export type TaskAffinity = 'render' | 'simulation' | 'streaming' | 'input' | 'persistence' | 'any';

export interface RuntimeTask<T = void> {
  readonly id: string;
  readonly priority: TaskPriority;
  readonly affinity: TaskAffinity;
  readonly estimatedMs: number;
  readonly run: (context: TaskContext) => T | Promise<T>;
}

export interface ScheduledTaskResult<T = void> {
  readonly id: string;
  readonly completed: boolean;
  readonly durationMs: number;
  readonly value?: T;
  readonly error?: unknown;
}

export interface InputAction {
  readonly action: string;
  readonly value: number;
  readonly source: 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'virtual';
  readonly timestamp: UnixMillis;
}

export interface ActionBinding {
  readonly action: string;
  readonly codes: readonly string[];
  readonly deadZone?: number;
  readonly scale?: number;
}

export interface SaveEnvelope<T> {
  readonly schema: string;
  readonly version: number;
  readonly createdAt: UnixMillis;
  readonly checksum: string;
  readonly payload: T;
}

export interface SaveSlot {
  readonly slot: number;
  readonly updatedAt: UnixMillis;
  readonly playtimeMs: number;
  readonly checksum: string;
  readonly summary: string;
}

export interface ResourceDescriptor {
  readonly id: string;
  readonly url: string;
  readonly bytes?: number;
  readonly kind: 'texture' | 'mesh' | 'animation' | 'audio' | 'shader' | 'json' | 'other';
  readonly priority: TaskPriority;
  readonly tags: readonly string[];
}

export type ResourceState = 'registered' | 'loading' | 'ready' | 'failed' | 'evicted';

export interface ResourceRecord<T = unknown> {
  readonly descriptor: ResourceDescriptor;
  readonly state: ResourceState;
  readonly value?: T;
  readonly error?: PlatformError;
  readonly lastUsedAt: UnixMillis;
  readonly residentBytes: number;
  readonly refCount: number;
}

export interface TelemetryMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: 'ms' | 'count' | 'bytes' | 'ratio' | 'score';
  readonly tags?: Readonly<Record<string, string>>;
}

export interface RuntimeSnapshot {
  readonly version: 1;
  readonly timestamp: UnixMillis;
  readonly frame: FrameId;
  readonly quality: QualityTier;
  readonly backend: RenderBackend;
  readonly pressure: PressureState;
  readonly metrics: readonly TelemetryMetric[];
}

export interface FrameExecutionContext {
  readonly frame: FrameId;
  readonly deltaSeconds: number;
  readonly absoluteSeconds: number;
  readonly camera: CameraState;
  readonly quality: QualityTier;
  readonly pressure: PressureState;
}

export interface EventMap {
  readonly 'runtime:ready': { readonly backend: RenderBackend };
  readonly 'runtime:error': PlatformError;
  readonly 'runtime:frame': FrameExecutionContext;
  readonly 'render:quality': { readonly previous: QualityTier; readonly next: QualityTier; readonly reason: string };
  readonly 'render:pressure': PressureState;
  readonly 'resource:state': { readonly id: string; readonly state: ResourceState };
  readonly 'input:action': InputAction;
  readonly 'persistence:save': { readonly slot: number; readonly checksum: string };
  readonly 'persistence:error': PlatformError;
}

export interface DeterministicClock {
  now(): UnixMillis;
  frame(): FrameId;
  advance(deltaMs: number): void;
}
