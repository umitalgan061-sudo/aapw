/**
 * R23 strict live-core contracts.
 *
 * This module intentionally contains no DOM, Three.js, Web Audio, network or storage dependency.
 * It is the stable typed vocabulary shared by camera/input/physics/assets/scene orchestration.
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type EntityId = Brand<string, 'EntityId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type ActionId = Brand<string, 'ActionId'>;
export type FrameId = Brand<number, 'FrameId'>;
export type TickId = Brand<number, 'TickId'>;

export const entityId = (value: string): EntityId => value.trim() as EntityId;
export const assetId = (value: string): AssetId => value.trim() as AssetId;
export const actionId = (value: string): ActionId => value.trim() as ActionId;
export const frameId = (value: number): FrameId => Math.max(0, Math.floor(value)) as FrameId;
export const tickId = (value: number): TickId => Math.max(0, Math.floor(value)) as TickId;

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface MutableVec3 { x: number; y: number; z: number; }
export interface Quaternion { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface Euler { readonly x: number; readonly y: number; readonly z: number; readonly order?: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY'; }
export interface Aabb2 { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; }
export interface Circle2 { readonly x: number; readonly z: number; readonly radius: number; }
export interface Segment2 { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number; }
export interface PlaneContact { readonly normalX: number; readonly normalZ: number; readonly penetration: number; }

export type CameraMode = 'explore' | 'combat' | 'lock-on' | 'dodge' | 'stagger' | 'cinematic';
export interface CameraLimits { readonly minDistance: number; readonly maxDistance: number; readonly minPolar: number; readonly maxPolar: number; readonly minFov: number; readonly maxFov: number; }
export interface CameraTarget { readonly position: Vec3; readonly lookAt: Vec3; readonly yaw: number; readonly pitch: number; }
export interface CameraIntent { readonly mode: CameraMode; readonly distance: number; readonly height: number; readonly shoulder: -1 | 1; readonly fov: number; readonly sensitivity: number; readonly recenter: boolean; readonly lockOnEntity?: EntityId; readonly cameraCut: boolean; }
export interface CameraState extends CameraIntent { readonly position: Vec3; readonly lookAt: Vec3; readonly velocity: Vec3; }

export type InputSource = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'xr' | 'synthetic';
export type GameplayAction = 'move' | 'look' | 'jump' | 'dodge' | 'light' | 'heavy' | 'parry' | 'guard' | 'lock-on' | 'interact' | 'sprint' | 'pause';
export interface AxisIntent { readonly x: number; readonly y: number; readonly magnitude: number; }
export interface InputIntent { readonly source: InputSource; readonly move: AxisIntent; readonly look: AxisIntent; readonly cameraZoom: number; readonly held: ReadonlySet<GameplayAction>; readonly pressed: ReadonlySet<GameplayAction>; readonly released: ReadonlySet<GameplayAction>; readonly sequence: number; readonly timestampSeconds: number; }
export interface RawInputSample { readonly source: InputSource; readonly moveX?: number; readonly moveY?: number; readonly lookX?: number; readonly lookY?: number; readonly zoom?: number; readonly held?: readonly GameplayAction[]; readonly pressed?: readonly GameplayAction[]; readonly released?: readonly GameplayAction[]; readonly timestampSeconds?: number; }
export interface InputFrame { readonly intent: InputIntent; readonly accepted: boolean; readonly rejectedActions: readonly string[]; }

export interface InputPolicy { readonly radialDeadzone: number; readonly triggerDeadzone: number; readonly maxLookRate: number; readonly maxZoomRate: number; readonly repeatWindowSeconds: number; readonly maximumActionCount: number; }

export type ColliderShape =
  | { readonly type: 'circle'; readonly value: Circle2 }
  | { readonly type: 'aabb'; readonly value: Aabb2 }
  | { readonly type: 'segment'; readonly value: Segment2 };
export interface Collider { readonly id: EntityId; readonly shape: ColliderShape; readonly layer: number; readonly mask: number; readonly enabled: boolean; }
export interface GroundContact { readonly grounded: boolean; readonly groundY: number; readonly normal: Vec3; readonly slopeDegrees: number; readonly material: string; }
export interface JumpState { readonly heightAboveGround: number; readonly verticalVelocity: number; readonly grounded: boolean; readonly coyoteRemaining: number; }
export interface PhysicsBodyState { readonly entity: EntityId; readonly position: Vec3; readonly velocity: Vec3; readonly radius: number; readonly height: number; readonly onGround: boolean; readonly groundedMaterial: string; }
export interface PhysicsPolicy { readonly gravity: number; readonly maxFallSpeed: number; readonly jumpSpeed: number; readonly maxSlopeDegrees: number; readonly skinWidth: number; readonly maxDepenetrationIterations: number; readonly coyoteTimeSeconds: number; readonly fixedStepSeconds: number; }

export type AssetKind = 'model' | 'texture' | 'audio' | 'shader' | 'json' | 'binary';
export type AssetState = 'queued' | 'loading' | 'resident' | 'stale' | 'failed' | 'evicted';
export interface AssetIntegrity { readonly byteLength?: number; readonly mimeType?: string; readonly sha256?: string; }
export interface AssetRequest { readonly id: AssetId; readonly kind: AssetKind; readonly url: string; readonly priority: number; readonly estimatedBytes: number; readonly integrity?: AssetIntegrity; readonly maxRetries: number; }
export interface AssetRecord { readonly request: AssetRequest; readonly state: AssetState; readonly attempts: number; readonly residentBytes: number; readonly queuedAtTick: TickId; readonly lastError?: string; readonly nextRetryTick?: TickId; }
export interface AssetBudget { readonly maxResidentBytes: number; readonly maxInflightBytes: number; readonly maxInflightRequests: number; readonly maxRetriesPerAsset: number; readonly staleAfterTicks: number; }

export type RendererBackend = 'webgpu' | 'webgl2' | 'headless';
export interface RenderCapabilities { readonly secureContext: boolean; readonly webgpu: boolean; readonly webgl2: boolean; readonly offscreenCanvas: boolean; readonly hardwareConcurrency: number; readonly memoryGiB: number; readonly devicePixelRatio: number; }
export type QualityTier = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
export interface RenderPolicy { readonly backend: RendererBackend; readonly tier: QualityTier; readonly renderScale: number; readonly pixelRatioCap: number; readonly shadows: boolean; readonly postProcessing: boolean; readonly temporalEffects: boolean; readonly maxVisibleInstances: number; readonly maxTextureMegabytes: number; }

export type RuntimePhase = 'created' | 'initializing' | 'ready' | 'running' | 'paused' | 'recovering' | 'stopping' | 'disposed' | 'failed';
export interface SceneViewport { readonly width:number; readonly height:number; readonly pixelRatio:number; }

export interface RuntimeTransition { readonly from: RuntimePhase; readonly to: RuntimePhase; readonly reason: string; readonly tick: TickId; }
export interface RuntimeBudgets { readonly simulationMs: number; readonly renderMs: number; readonly inputMs: number; readonly assetMs: number; readonly telemetryMs: number; }
export interface RuntimeFrame { readonly id: FrameId; readonly tick: TickId; readonly deltaSeconds: number; readonly simulatedSeconds: number; readonly phase: RuntimePhase; readonly budgets: RuntimeBudgets; }
export interface RuntimeDiagnostics { readonly frame: FrameId; readonly tick: TickId; readonly phase: RuntimePhase; readonly backend: RendererBackend; readonly quality: QualityTier; readonly activeAssets: number; readonly residentAssetBytes: number; readonly droppedInputSamples: number; readonly collisionsResolved: number; readonly simulationSteps: number; readonly frameTimeMs: number; readonly digest: string; }
export interface RuntimeSnapshot { readonly tick: TickId; readonly frame: FrameId; readonly phase: RuntimePhase; readonly player: PhysicsBodyState; readonly camera: CameraState; readonly jump: JumpState; readonly digest: string; }
export interface RuntimeError { readonly code: 'INVALID_INPUT' | 'INVALID_TRANSITION' | 'ASSET_BUDGET' | 'COLLISION_LIMIT' | 'INVALID_FRAME' | 'RUNTIME_DISPOSED'; readonly message: string; readonly recoverable: boolean; readonly details?: Readonly<Record<string, string | number | boolean>>; }
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RuntimeError };
export const ok = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
export const err = (code: RuntimeError['code'], message: string, recoverable = false, details?: Readonly<Record<string, string | number | boolean>>): Result<never> => Object.freeze({ ok: false, error: Object.freeze({ code, message, recoverable, ...(details ? { details } : {}) }) });

export const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, finite(value, min)));
export const clamp01 = (value: number): number => clamp(value, 0, 1);
export const deadzone = (value: number, threshold: number): number => { const magnitude = Math.abs(value); if (magnitude <= threshold) return 0; const remapped = (magnitude - threshold) / Math.max(1e-9, 1 - threshold); return Math.sign(value) * clamp01(remapped); };
export const radialDeadzone = (x: number, y: number, threshold: number): AxisIntent => { const nx = finite(x), ny = finite(y); const length = Math.min(1, Math.hypot(nx, ny)); if (length <= threshold || length <= 1e-9) return Object.freeze({ x: 0, y: 0, magnitude: 0 }); const mapped = (length - threshold) / Math.max(1e-9, 1 - threshold); const scale = mapped / length; return Object.freeze({ x: nx * scale, y: ny * scale, magnitude: mapped }); };
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => Object.freeze({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul3 = (a: Vec3, scalar: number): Vec3 => vec3(a.x * scalar, a.y * scalar, a.z * scalar);
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const lengthXZ = (a: Vec3): number => Math.hypot(a.x, a.z);
export const normalize3 = (a: Vec3): Vec3 => { const length = length3(a); return length <= 1e-9 ? vec3() : mul3(a, 1 / length); };
export const lerpNumber = (a: number, b: number, alpha: number): number => a + (b - a) * clamp01(alpha);
export const lerp3 = (a: Vec3, b: Vec3, alpha: number): Vec3 => vec3(lerpNumber(a.x, b.x, alpha), lerpNumber(a.y, b.y, alpha), lerpNumber(a.z, b.z, alpha));
export const smoothDampAlpha = (deltaSeconds: number, responseHz: number): number => 1 - Math.exp(-Math.max(0, deltaSeconds) * Math.max(0, responseHz) * 2 * Math.PI);

export const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return String(JSON.stringify(value));
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableSerialize(record[key])).join(',') + '}';
};

export const stableHash = (value: unknown): string => { const text = stableSerialize(value); let hashA = 0x811c9dc5; let hashB = 0x9e3779b9; for (let i = 0; i < text.length; i += 1) { const code = text.charCodeAt(i); hashA ^= code; hashA = Math.imul(hashA, 0x01000193); hashB ^= code + i; hashB = Math.imul(hashB, 0x85ebca6b); } return ((hashA >>> 0).toString(16).padStart(8, '0') + (hashB >>> 0).toString(16).padStart(8, '0')); };

export const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) if (nested && typeof nested === 'object') deepFreeze(nested); } return value; };
export const asReadonlySet = <T>(values: Iterable<T>): ReadonlySet<T> => new Set<T>(values);
export const normalizeActionList = (values: readonly GameplayAction[] = [], maximum = 32): readonly GameplayAction[] => Object.freeze([...new Set(values)].sort().slice(0, Math.max(0, maximum)));