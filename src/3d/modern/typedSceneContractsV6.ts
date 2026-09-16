import type { RuntimeHealthV4, RuntimePhaseV4, QualityTierV4, TickId, RuntimeId, Vec3V4 } from './runtimeContractsV4';

export type SceneObjectId = string & { readonly __brand: 'SceneObjectIdV6' };
export type SceneChunkId = string & { readonly __brand: 'SceneChunkIdV6' };
export type PlayerId = string & { readonly __brand: 'PlayerIdV6' };
export type FrameId = number & { readonly __brand: 'FrameIdV6' };

export const sceneObjectId = (value: string): SceneObjectId => value as SceneObjectId;
export const sceneChunkId = (value: string): SceneChunkId => value as SceneChunkId;
export const playerId = (value: string): PlayerId => value as PlayerId;
export const frameId = (value: number): FrameId => Math.max(0, Math.trunc(value)) as FrameId;

export interface MutableVec3V6 { x: number; y: number; z: number; }
export interface RotationV6 { yaw: number; pitch: number; roll: number; }
export interface BoundsV6 { readonly min: Vec3V4; readonly max: Vec3V4; }

export interface SceneObjectV6 {
  readonly id: SceneObjectId;
  readonly kind: 'terrain' | 'water' | 'vegetation' | 'castle' | 'village' | 'road' | 'river' | 'npc' | 'animal' | 'player' | 'effect' | 'debug';
  readonly position: MutableVec3V6;
  readonly rotation: RotationV6;
  readonly scale: MutableVec3V6;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly tags: readonly string[];
  readonly bounds?: BoundsV6;
}

export interface SceneObjectPatchV6 {
  readonly position?: Partial<MutableVec3V6>;
  readonly rotation?: Partial<RotationV6>;
  readonly scale?: Partial<MutableVec3V6>;
  readonly visible?: boolean;
  readonly enabled?: boolean;
  readonly addTags?: readonly string[];
  readonly removeTags?: readonly string[];
}

export interface SceneChunkV6 {
  readonly id: SceneChunkId;
  readonly x: number;
  readonly z: number;
  readonly loaded: boolean;
  readonly resident: boolean;
  readonly distance: number;
  readonly objectIds: readonly SceneObjectId[];
  readonly priority: number;
  readonly estimatedBytes: number;
}

export interface CameraStateV6 {
  readonly position: Vec3V4;
  readonly target: Vec3V4;
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly enablePan: boolean;
  readonly collisionDistance: number;
}

export interface CameraIntentV6 {
  readonly orbitX: number;
  readonly orbitY: number;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly reset?: boolean;
  readonly timestamp: number;
}

export interface InputSnapshotV6 {
  readonly tick: TickId;
  readonly frame: FrameId;
  readonly moveX: number;
  readonly moveZ: number;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly sprint: boolean;
  readonly jump: boolean;
  readonly interact: boolean;
  readonly pause: boolean;
  readonly debug: boolean;
  readonly source: 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'xr' | 'virtual' | 'system';
}

export interface PlayerStateV6 {
  readonly id: PlayerId;
  readonly objectId: SceneObjectId;
  readonly position: MutableVec3V6;
  readonly velocity: MutableVec3V6;
  readonly yaw: number;
  readonly grounded: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly sprinting: boolean;
  readonly alive: boolean;
}

export interface RenderBudgetV6 {
  readonly targetMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly maxVisibleObjects: number;
  readonly maxShadowCasters: number;
  readonly renderScale: number;
}

export interface SceneFrameV6 {
  readonly runtime: RuntimeId;
  readonly phase: RuntimePhaseV4;
  readonly tick: TickId;
  readonly frame: FrameId;
  readonly deltaMs: number;
  readonly camera: CameraStateV6;
  readonly player: PlayerStateV6 | null;
  readonly chunks: readonly SceneChunkV6[];
  readonly visibleObjects: readonly SceneObjectId[];
  readonly renderBudget: RenderBudgetV6;
  readonly health: RuntimeHealthV4;
}

export interface TypedSceneMetricsV6 {
  readonly objects: number;
  readonly chunks: number;
  readonly residentBytes: number;
  readonly visibleObjects: number;
  readonly culledObjects: number;
  readonly playerFrames: number;
  readonly cameraFrames: number;
  readonly streamedChunks: number;
  readonly evictedChunks: number;
}

export interface SceneDiagnosticV6 {
  readonly id: string;
  readonly timestamp: number;
  readonly severity: 'info' | 'warn' | 'error' | 'fatal';
  readonly code: string;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface TypedSceneRuntimeSnapshotV6 {
  readonly version: 6;
  readonly runtime: RuntimeId;
  readonly frame: FrameId;
  readonly tick: TickId;
  readonly player: PlayerStateV6 | null;
  readonly camera: CameraStateV6;
  readonly chunks: readonly SceneChunkV6[];
  readonly metrics: TypedSceneMetricsV6;
  readonly checksum: string;
}

export const vec3FromMutableV6 = (value: MutableVec3V6): Vec3V4 => Object.freeze({ x: Number.isFinite(value.x) ? value.x : 0, y: Number.isFinite(value.y) ? value.y : 0, z: Number.isFinite(value.z) ? value.z : 0 });

export const clonePlayerV6 = (player: PlayerStateV6): PlayerStateV6 => Object.freeze({
  ...player,
  position: Object.freeze({ ...player.position }),
  velocity: Object.freeze({ ...player.velocity }),
});

export const cloneCameraV6 = (camera: CameraStateV6): CameraStateV6 => Object.freeze({ ...camera, position: Object.freeze({ ...camera.position }), target: Object.freeze({ ...camera.target }) });

export const finiteOrV6 = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const nonNegativeV6 = (value: unknown, fallback = 0): number => Math.max(0, finiteOrV6(value, fallback));
export const clamp01V6 = (value: unknown): number => Math.max(0, Math.min(1, finiteOrV6(value)));

export function validateCameraV6(camera: CameraStateV6): void {
  if (!Number.isFinite(camera.distance) || camera.distance < camera.minDistance || camera.distance > camera.maxDistance) throw new Error('Invalid camera distance');
  if (!Number.isFinite(camera.position.x) || !Number.isFinite(camera.position.y) || !Number.isFinite(camera.position.z)) throw new Error('Invalid camera position');
  if (!Number.isFinite(camera.target.x) || !Number.isFinite(camera.target.y) || !Number.isFinite(camera.target.z)) throw new Error('Invalid camera target');
}

export function validatePlayerV6(player: PlayerStateV6): void {
  if (player.maxHealth <= 0 || player.health < 0 || player.health > player.maxHealth) throw new Error('Invalid player health');
  if (player.maxStamina <= 0 || player.stamina < 0 || player.stamina > player.maxStamina) throw new Error('Invalid player stamina');
  if (!Number.isFinite(player.position.x) || !Number.isFinite(player.position.y) || !Number.isFinite(player.position.z)) throw new Error('Invalid player position');
  if (!Number.isFinite(player.velocity.x) || !Number.isFinite(player.velocity.y) || !Number.isFinite(player.velocity.z)) throw new Error('Invalid player velocity');
}
