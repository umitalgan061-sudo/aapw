import type { EntityId, ResourceId, Tick, Vec3, V7Result } from './primitives.js';

export interface RuntimeClockContract { readonly tickRate: number; readonly tick: Tick; readonly interpolation: number; readonly droppedSteps: number; advance(frameMs: number): number; reset(): void; }
export interface InputContract { ingest(input: unknown): V7Result<unknown>; frame(tick: Tick): unknown; replay(from: Tick, to: Tick, consumer: (input: unknown) => void): number; }
export interface SimulationContract { step(ticks?: number): unknown; snapshot(): unknown; restore(snapshot: unknown): V7Result<void>; }
export interface StreamingContract { request(id: ResourceId): boolean; plan(): unknown; residentBytes(): number; }
export interface RenderContract { evaluate(signals: unknown): unknown; compile(): unknown; execute(): unknown; }
export interface AudioContract { setListener(position: Vec3): void; play(emitter: string, clip: string): string | null; frame(): unknown; }
export interface NetworkContract { send(payload: unknown): V7Result<unknown>; receive(packet: unknown): V7Result<void>; reconcile(tick: Tick, digest: string): unknown; }
export interface SaveContract { save(slot: string, payload: unknown, tick: Tick): Promise<V7Result<unknown>>; load(slot: string): Promise<V7Result<unknown>>; restore(slot: string): Promise<V7Result<unknown>>; }
export interface SecurityContract { validate(payload: unknown): V7Result<number>; checkUrl(url: string, kind: string): unknown; }
export interface TelemetryContract { counter(name: string, delta?: number): number; gauge(name: string, value: number): number; histogram(name: string, value: number): void; health(): unknown; }
export interface RecoveryContract { recover(domains?: readonly string[], tick?: number): unknown; }
export interface EntityQuery { readonly required: readonly string[]; readonly excluded?: readonly string[]; readonly limit?: number; }
export interface EntityRegistry { create(id?: string): V7Result<EntityId>; destroy(id: EntityId): boolean; query(spec: EntityQuery): readonly EntityId[]; }
export interface SceneNodeContract { readonly id: string; readonly parent: string | null; readonly children: readonly string[]; readonly local: TransformContract; readonly visible: boolean; }
export interface TransformContract { readonly position: Vec3; readonly rotation: Vec3; readonly scale: Vec3; }
export interface CameraContract { readonly position: Vec3; readonly target: Vec3; readonly fov: number; readonly near: number; readonly far: number; }
export interface MaterialContract { readonly id: string; readonly transparent: boolean; readonly roughness: number; readonly metalness: number; readonly textureIds: readonly ResourceId[]; }
export interface MeshContract { readonly id: string; readonly vertexCount: number; readonly indexCount: number; readonly bounds: readonly [Vec3, Vec3]; }
export interface AnimationContract { readonly id: string; readonly clips: readonly string[]; readonly layers: readonly string[]; }
export interface QuestContract { readonly id: string; readonly objectives: readonly string[]; readonly state: string; }
export interface GameplayContract { readonly actors: readonly EntityId[]; readonly tick: Tick; readonly active: boolean; }
export interface WorldContract { readonly entities: readonly EntityId[]; readonly interestCenter: Vec3; readonly revision: number; }
export interface DiagnosticsContract { readonly healthy: boolean; readonly warnings: readonly string[]; readonly critical: readonly string[]; }
export interface PlatformContract { readonly backend: 'webgpu' | 'webgl2' | 'headless'; readonly workers: number; readonly memoryGb: number | null; readonly reducedMotion: boolean; }
export interface RuntimeManifest { readonly version: string; readonly protocol: number; readonly modules: readonly string[]; readonly capabilities: PlatformContract; readonly digest: string; }

export const REQUIRED_V7_CONTRACTS = Object.freeze([
  'clock', 'input', 'simulation', 'streaming', 'render', 'audio', 'network', 'save', 'security', 'telemetry', 'recovery',
  'ecs', 'scene', 'camera', 'material', 'mesh', 'animation', 'quest', 'gameplay', 'world', 'diagnostics', 'platform',
] as const);

export function validateRuntimeManifest(manifest: RuntimeManifest): V7Result<RuntimeManifest> {
  if (!manifest || !manifest.version || manifest.protocol < 1 || !Array.isArray(manifest.modules) || manifest.modules.length > 512 || !manifest.capabilities) return { ok: false, code: 'MANIFEST_INVALID', message: 'Runtime manifest shape is invalid', retryable: false };
  if (!manifest.digest) return { ok: false, code: 'MANIFEST_DIGEST', message: 'Runtime manifest digest is missing', retryable: false };
  return { ok: true, value: Object.freeze({ ...manifest, modules: Object.freeze([...new Set(manifest.modules)].sort()) }) };
}

export function normalizeTransform(transform: Partial<TransformContract>): TransformContract { return Object.freeze({ position: Object.freeze({ x: Number(transform.position?.x ?? 0), y: Number(transform.position?.y ?? 0), z: Number(transform.position?.z ?? 0) }), rotation: Object.freeze({ x: Number(transform.rotation?.x ?? 0), y: Number(transform.rotation?.y ?? 0), z: Number(transform.rotation?.z ?? 0) }), scale: Object.freeze({ x: Number(transform.scale?.x ?? 1), y: Number(transform.scale?.y ?? 1), z: Number(transform.scale?.z ?? 1) }) }); }

export function isTransformFinite(transform: TransformContract): boolean { return [transform.position, transform.rotation, transform.scale].every((vector) => Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)); }
