export type ProductionLifecycle = 'created' | 'booting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed' | 'disposed';
export type ProductionPhase = 'input' | 'simulation' | 'world' | 'network' | 'assets' | 'render' | 'telemetry';
export type InterestLevel = 'critical' | 'near' | 'normal' | 'far' | 'background';
export type AssetPriority = 'critical' | 'near' | 'normal' | 'background';
export type TransportState = 'offline' | 'connecting' | 'connected' | 'degraded' | 'closing';
export type HealthState = 'healthy' | 'degraded' | 'critical';
export type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | 'safe';

export interface Vec3P {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MutableVec3P {
  x: number;
  y: number;
  z: number;
}

export interface BoundsP {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface CameraFrameP {
  readonly position: Vec3P;
  readonly target: Vec3P;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface InputActionStateP {
  readonly moveX: number;
  readonly moveZ: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly dodge: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly interact: boolean;
  readonly pause: boolean;
}

export interface InputSampleP extends InputActionStateP {
  readonly tick: number;
  readonly sequence: number;
  readonly timeMs: number;
}

export interface TransformStateP {
  readonly position: MutableVec3P;
  readonly velocity: MutableVec3P;
  readonly yaw: number;
  readonly flags: number;
}

export interface ActorStateP {
  readonly id: number;
  readonly kind: 'player' | 'npc' | 'animal' | 'creature' | 'object';
  readonly transform: TransformStateP;
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly interest: InterestLevel;
  readonly alive: boolean;
}

export interface WorldCommandP {
  readonly tick: number;
  readonly actorId: number;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WorldEventP {
  readonly tick: number;
  readonly sequence: number;
  readonly kind: string;
  readonly source: string;
  readonly payload: unknown;
}

export interface NetworkEnvelopeP<T = unknown> {
  readonly protocol: 4;
  readonly session: string;
  readonly sequence: number;
  readonly ack: number;
  readonly tick: number;
  readonly reliable: boolean;
  readonly kind: string;
  readonly payload: T;
}

export interface SnapshotActorP {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
  readonly stamina: number;
  readonly flags: number;
}

export interface WorldSnapshotP {
  readonly tick: number;
  readonly revision: number;
  readonly actors: readonly SnapshotActorP[];
  readonly checksum: number;
}

export interface SnapshotDeltaP {
  readonly protocol: 4;
  readonly baseTick: number;
  readonly tick: number;
  readonly revision: number;
  readonly upserts: readonly SnapshotActorP[];
  readonly removals: readonly number[];
  readonly checksum: number;
}

export interface AssetManifestItemP {
  readonly id: string;
  readonly url: string;
  readonly bytes: number;
  readonly priority: AssetPriority;
  readonly optional: boolean;
  readonly contentType?: string;
  readonly digest?: string;
}

export interface AssetRecordP {
  readonly id: string;
  readonly url: string;
  readonly state: 'queued' | 'loading' | 'ready' | 'failed' | 'disposed';
  readonly bytes: number;
  readonly pinCount: number;
  readonly lastUsedTick: number;
  readonly generation: number;
  readonly error?: string;
}

export interface SaveSlotP<T> {
  readonly slot: string;
  readonly version: number;
  readonly tick: number;
  readonly createdAt: number;
  readonly checksum: number;
  readonly state: T;
}

export interface FrameBudgetP {
  readonly inputMs: number;
  readonly simulationMs: number;
  readonly worldMs: number;
  readonly networkMs: number;
  readonly assetMs: number;
  readonly renderMs: number;
  readonly telemetryMs: number;
  readonly totalMs: number;
  readonly targetMs: number;
}

export interface RenderCapabilitiesP {
  readonly webgl2: boolean;
  readonly instancing: boolean;
  readonly maxTextureSize: number;
  readonly deviceMemoryGb: number;
  readonly hardwareConcurrency: number;
}

export interface RenderPlanP {
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly shadowMapSize: number;
  readonly visibleDistance: number;
  readonly vegetationDensity: number;
  readonly effectsDensity: number;
  readonly passes: readonly string[];
}

export interface RuntimeHealthP {
  readonly state: HealthState;
  readonly score: number;
  readonly frameMs: number;
  readonly memoryMb: number;
  readonly networkRttMs: number;
  readonly assetQueue: number;
  readonly workerQueue: number;
  readonly recommendations: readonly string[];
}

export interface ProductionRuntimeConfigP {
  readonly seed: number;
  readonly simulationHz: number;
  readonly maxStepsPerFrame: number;
  readonly maxInputHistory: number;
  readonly maxWorldActors: number;
  readonly maxAssetBytes: number;
  readonly maxAssetEntries: number;
  readonly maxNetworkQueue: number;
  readonly maxTelemetrySamples: number;
  readonly snapshotHistory: number;
  readonly strictMigration: boolean;
}

export const DEFAULT_PRODUCTION_CONFIG_P: ProductionRuntimeConfigP = Object.freeze({
  seed: 1337,
  simulationHz: 60,
  maxStepsPerFrame: 8,
  maxInputHistory: 1024,
  maxWorldActors: 4096,
  maxAssetBytes: 512 * 1024 * 1024,
  maxAssetEntries: 2048,
  maxNetworkQueue: 512,
  maxTelemetrySamples: 1024,
  snapshotHistory: 128,
  strictMigration: true,
});

export interface PhaseTimingP {
  readonly phase: ProductionPhase;
  readonly durationMs: number;
  readonly budgetMs: number;
}

export interface RuntimeFrameReportP {
  readonly frame: number;
  readonly tick: number;
  readonly lifecycle: ProductionLifecycle;
  readonly steps: number;
  readonly alpha: number;
  readonly render: RenderPlanP;
  readonly health: RuntimeHealthP;
  readonly phaseTimings: readonly PhaseTimingP[];
  readonly digest: number;
}

export interface ProductionEventMapP {
  'runtime:lifecycle': { readonly previous: ProductionLifecycle; readonly next: ProductionLifecycle };
  'runtime:frame': RuntimeFrameReportP;
  'runtime:error': { readonly phase: ProductionPhase; readonly error: string };
  'world:command': WorldCommandP;
  'world:event': WorldEventP;
  'network:envelope': NetworkEnvelopeP;
  'asset:state': AssetRecordP;
  'input:sample': InputSampleP;
  'telemetry:health': RuntimeHealthP;
}

export type EventKeyP = keyof ProductionEventMapP;
export type EventHandlerP<K extends EventKeyP> = (payload: ProductionEventMapP[K]) => void;

export interface EventSinkP {
  emit<K extends EventKeyP>(event: K, payload: ProductionEventMapP[K]): void;
  on<K extends EventKeyP>(event: K, handler: EventHandlerP<K>): () => void;
}

export const finiteP = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
export const nonNegativeP = (value: number, fallback = 0): number => Math.max(0, finiteP(value, fallback));
export const clampP = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, finiteP(value, min)));
export const integerP = (value: number, fallback = 0): number => Math.trunc(finiteP(value, fallback));
export const normalizedIdP = (value: number): number => Math.max(1, integerP(value, 1));
export const nowP = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export function cloneVec3P(value: Vec3P): MutableVec3P { return { x: value.x, y: value.y, z: value.z }; }
export function distanceSquaredP(a: Vec3P, b: Vec3P): number { const dx = a.x - b.x; const dy = a.y - b.y; const dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
export function distance2dSquaredP(a: Vec3P, b: Vec3P): number { const dx = a.x - b.x; const dz = a.z - b.z; return dx * dx + dz * dz; }
export function stableStringP(value: unknown): string { return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : child); }

export function checksumP(value: unknown): number {
  const text = stableStringP(value);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
