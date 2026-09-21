import type { FrameBudget, InputFrame, Tick, Vec3, WorldSnapshot } from '../types.ts';
import type { QualityTier, RenderBudgetState, RenderCapabilities } from '../render.ts';
import type { InputButton } from '../input.ts';

export const PRODUCTION_CONTRACT_VERSION = 1 as const;
export type ProductionContractVersion = typeof PRODUCTION_CONTRACT_VERSION;
export type RuntimeMode = 'booting' | 'running' | 'paused' | 'recovering' | 'stopped' | 'faulted';
export type SubsystemId =
  | 'simulation'
  | 'render'
  | 'streaming'
  | 'network'
  | 'audio'
  | 'input'
  | 'persistence'
  | 'workers'
  | 'telemetry'
  | 'camera'
  | 'security';

export type HealthLevel = 'ok' | 'degraded' | 'critical' | 'offline';
export type VisibilityClass = 'hidden' | 'near' | 'mid' | 'far' | 'critical';
export type Residency = 'unknown' | 'requested' | 'loading' | 'resident' | 'evicting' | 'failed';
export type NetworkTransport = 'none' | 'websocket' | 'webrtc' | 'http-poll' | 'loopback';
export type SaveSlotKind = 'manual' | 'autosave' | 'checkpoint' | 'recovery';
export type FailurePolicy = 'ignore' | 'degrade' | 'restart' | 'fault-runtime';

export interface RuntimeIdentity {
  readonly application: string;
  readonly build: string;
  readonly session: string;
  readonly contractVersion: ProductionContractVersion;
}

export interface RuntimeClock {
  readonly tick: Tick;
  readonly simTimeSeconds: number;
  readonly wallTimeMs: number;
  readonly frameIndex: number;
  readonly deltaSeconds: number;
}

export interface RuntimeBudget {
  readonly targetFrameMs: number;
  readonly frame: FrameBudget;
  readonly workerMs: number;
  readonly memoryBytes: number;
  readonly render: RenderBudgetState;
}

export interface RuntimeCapabilities {
  readonly render: RenderCapabilities;
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number;
  readonly maxTouchPoints: number;
  readonly supportsWorkers: boolean;
  readonly supportsSharedArrayBuffer: boolean;
  readonly prefersReducedMotion: boolean;
}

export interface EntityTransformState {
  readonly id: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yawRadians: number;
  readonly radiusMeters: number;
  readonly visibility: VisibilityClass;
}

export interface EntityRuntimeState {
  readonly transform: EntityTransformState;
  readonly health: number;
  readonly stamina: number;
  readonly flags: number;
  readonly residency: Residency;
  readonly updatedTick: Tick;
}

export interface InputState {
  readonly frame: InputFrame;
  readonly pressed: readonly InputButton[];
  readonly released: readonly InputButton[];
  readonly source: 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'xr' | 'synthetic';
}

export interface RenderEntityCommand {
  readonly id: number;
  readonly position: Vec3;
  readonly yawRadians: number;
  readonly lod: number;
  readonly visible: boolean;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly animationRate: number;
}

export interface RenderFramePlan {
  readonly tick: Tick;
  readonly alpha: number;
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly visibleDistance: number;
  readonly commands: readonly RenderEntityCommand[];
}

export interface NetworkPeerState {
  readonly peerId: string;
  readonly transport: NetworkTransport;
  readonly connected: boolean;
  readonly lastReceivedTick: Tick;
  readonly lastAck: number;
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly packetLossRatio: number;
  readonly bandwidthBytesPerSecond: number;
}

export interface ReplicationEnvelope {
  readonly protocol: 3;
  readonly session: string;
  readonly sequence: number;
  readonly ack: number;
  readonly sentTick: Tick;
  readonly kind: 'snapshot' | 'delta' | 'input' | 'event' | 'ack';
  readonly payload: unknown;
}

export interface SaveDescriptor {
  readonly slot: string;
  readonly kind: SaveSlotKind;
  readonly version: number;
  readonly tick: Tick;
  readonly bytes: number;
  readonly checksum: string;
  readonly createdAtMs: number;
}

export interface RuntimeFault {
  readonly subsystem: SubsystemId;
  readonly policy: FailurePolicy;
  readonly message: string;
  readonly tick: Tick;
  readonly recoverable: boolean;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface SubsystemHealth {
  readonly subsystem: SubsystemId;
  readonly level: HealthLevel;
  readonly score: number;
  readonly consecutiveFailures: number;
  readonly lastFault?: RuntimeFault;
  readonly updatedTick: Tick;
}

export interface RuntimeHealthReport {
  readonly identity: RuntimeIdentity;
  readonly mode: RuntimeMode;
  readonly clock: RuntimeClock;
  readonly budget: RuntimeBudget;
  readonly capabilities: RuntimeCapabilities;
  readonly subsystems: readonly SubsystemHealth[];
  readonly activeEntities: number;
  readonly residentChunks: number;
  readonly queuedInputs: number;
  readonly queuedWorkers: number;
  readonly peers: readonly NetworkPeerState[];
}

export interface RuntimeEventMap {
  started: RuntimeClock;
  stopped: RuntimeClock;
  paused: RuntimeClock;
  resumed: RuntimeClock;
  frame: RuntimeClock & RuntimeBudget;
  input: InputState;
  renderPlan: RenderFramePlan;
  peer: NetworkPeerState;
  fault: RuntimeFault;
  health: RuntimeHealthReport;
  save: SaveDescriptor;
  recovery: { subsystem: SubsystemId; attempt: number; success: boolean; tick: Tick };
}

export type RuntimeEventName = keyof RuntimeEventMap;
export type RuntimeEventListener<K extends RuntimeEventName> = (payload: RuntimeEventMap[K]) => void;

export interface RuntimeEventBus {
  on<K extends RuntimeEventName>(event: K, listener: RuntimeEventListener<K>): () => void;
  emit<K extends RuntimeEventName>(event: K, payload: RuntimeEventMap[K]): void;
  clear(): void;
}

export interface LifecycleHookContext {
  readonly identity: RuntimeIdentity;
  readonly clock: RuntimeClock;
  readonly signal: AbortSignal;
}

export interface LifecycleHook {
  readonly id: string;
  readonly subsystem: SubsystemId;
  readonly priority: number;
  readonly failurePolicy: FailurePolicy;
  start?(context: LifecycleHookContext): void | Promise<void>;
  pause?(context: LifecycleHookContext): void | Promise<void>;
  resume?(context: LifecycleHookContext): void | Promise<void>;
  stop?(context: LifecycleHookContext): void | Promise<void>;
  dispose?(context: LifecycleHookContext): void | Promise<void>;
}

export interface ProductionRuntimeOptions {
  readonly identity?: Partial<RuntimeIdentity>;
  readonly simulationHz?: number;
  readonly maxSimulationStepsPerFrame?: number;
  readonly inputCapacity?: number;
  readonly coarsePointer?: boolean;
  readonly renderCapabilities?: RenderCapabilities;
  readonly networkSession?: string;
  readonly networkPeer?: string;
  readonly maxEntities?: number;
  readonly maxVisibleEntities?: number;
  readonly targetFrameMs?: number;
  readonly recoveryAttempts?: number;
}

export interface ProductionFrameInput {
  readonly deltaSeconds: number;
  readonly budget: FrameBudget;
  readonly input?: InputFrame;
  readonly wallTimeMs?: number;
}

export interface ProductionFrameResult {
  readonly tick: Tick;
  readonly steps: number;
  readonly alpha: number;
  readonly mode: RuntimeMode;
  readonly renderPlan: RenderFramePlan;
  readonly health: RuntimeHealthReport;
}

export interface ProductionEntitySeed {
  readonly id?: number;
  readonly position?: Partial<Vec3>;
  readonly velocity?: Partial<Vec3>;
  readonly yawRadians?: number;
  readonly radiusMeters?: number;
  readonly health?: number;
  readonly stamina?: number;
  readonly flags?: number;
}

export interface ProductionSnapshot {
  readonly contractVersion: ProductionContractVersion;
  readonly identity: RuntimeIdentity;
  readonly tick: Tick;
  readonly simTimeSeconds: number;
  readonly entities: readonly EntityRuntimeState[];
  readonly world?: WorldSnapshot;
  readonly inputSequence: number;
}

export function clampFinite(value: unknown, min: number, max: number, fallback = 0): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeVec3(value: Partial<Vec3> | undefined, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  return {
    x: clampFinite(value?.x, -1_000_000, 1_000_000, fallback.x),
    y: clampFinite(value?.y, -1_000_000, 1_000_000, fallback.y),
    z: clampFinite(value?.z, -1_000_000, 1_000_000, fallback.z),
  };
}

export function normalizeRuntimeIdentity(input: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  const normalize = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : fallback;
  return {
    application: normalize(input.application, 'aapw'),
    build: normalize(input.build, 'modern'),
    session: normalize(input.session, 'local'),
    contractVersion: PRODUCTION_CONTRACT_VERSION,
  };
}

export function normalizeRuntimeCapabilities(input: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities {
  const render: RenderCapabilities = {
    maxTextureSize: Math.max(256, Math.floor(input.render?.maxTextureSize ?? 4096)),
    supportsInstancing: Boolean(input.render?.supportsInstancing ?? true),
    supportsWebGL2: Boolean(input.render?.supportsWebGL2 ?? true),
    deviceMemoryGb: clampFinite(input.render?.deviceMemoryGb, 0, 128, input.deviceMemoryGb ?? 4),
    hardwareConcurrency: Math.max(1, Math.floor(input.render?.hardwareConcurrency ?? input.hardwareConcurrency ?? 4)),
  };
  return {
    render,
    crossOriginIsolated: Boolean(input.crossOriginIsolated),
    hardwareConcurrency: Math.max(1, Math.floor(input.hardwareConcurrency ?? render.hardwareConcurrency ?? 4)),
    deviceMemoryGb: clampFinite(input.deviceMemoryGb, 0, 128, render.deviceMemoryGb ?? 4),
    maxTouchPoints: Math.max(0, Math.floor(input.maxTouchPoints ?? 0)),
    supportsWorkers: Boolean(input.supportsWorkers ?? true),
    supportsSharedArrayBuffer: Boolean(input.supportsSharedArrayBuffer ?? false),
    prefersReducedMotion: Boolean(input.prefersReducedMotion ?? false),
  };
}

export function normalizeBudget(budget: FrameBudget, targetFrameMs = 16.6, render: RenderBudgetState = {
  tier: 'medium',
  pixelRatio: 1.5,
  shadowMapSize: 2048,
  visibleDistance: 0.75,
  vegetationDensity: 0.7,
  effectsDensity: 0.7,
  lodBias: 0.35,
}): RuntimeBudget {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  return {
    targetFrameMs: clampFinite(targetFrameMs, 8, 50, 16.6),
    frame: {
      simulationMs: finite(budget.simulationMs),
      renderMs: finite(budget.renderMs),
      streamingMs: finite(budget.streamingMs),
      networkMs: finite(budget.networkMs),
      totalMs: finite(budget.totalMs),
    },
    workerMs: finite(budget.simulationMs) * 0.25,
    memoryBytes: 0,
    render,
  };
}

export function normalizeEntitySeed(seed: ProductionEntitySeed): Required<ProductionEntitySeed> {
  return {
    id: Math.max(0, Math.floor(seed.id ?? 0)),
    position: normalizeVec3(seed.position),
    velocity: normalizeVec3(seed.velocity),
    yawRadians: clampFinite(seed.yawRadians, -Math.PI * 64, Math.PI * 64, 0),
    radiusMeters: clampFinite(seed.radiusMeters, 0.05, 100, 0.5),
    health: clampFinite(seed.health, 0, 1_000_000, 100),
    stamina: clampFinite(seed.stamina, 0, 1_000_000, 100),
    flags: Math.max(0, Math.floor(seed.flags ?? 0)) >>> 0,
  };
}

export function isInputFrameSafe(frame: InputFrame): boolean {
  return Number.isFinite(frame.moveX)
    && Number.isFinite(frame.moveZ)
    && Number.isFinite(frame.lookX)
    && Number.isFinite(frame.lookY)
    && Number.isFinite(frame.tick)
    && Number.isInteger(frame.buttons)
    && Math.abs(frame.moveX) <= 1
    && Math.abs(frame.moveZ) <= 1
    && Math.abs(frame.lookX) <= 1
    && Math.abs(frame.lookY) <= 1;
}

export function inputButtons(frame: InputFrame): InputButton[] {
  const buttons: InputButton[] = [];
  const values = [1,2,4,8,16,32,64,128] as const;
  for (const value of values) {
    if ((frame.buttons & value) !== 0) buttons.push(value as InputButton);
  }
  return buttons;
}

export function classifyDistance(distanceMeters: number, critical = 20, near = 60, mid = 180, far = 600): VisibilityClass {
  const distance = Math.max(0, distanceMeters);
  if (distance <= critical) return 'critical';
  if (distance <= near) return 'near';
  if (distance <= mid) return 'mid';
  if (distance <= far) return 'far';
  return 'hidden';
}

export function scoreHealth(level: HealthLevel, failures: number, expectedFailures = 1): number {
  const base = level === 'ok' ? 1 : level === 'degraded' ? 0.72 : level === 'critical' ? 0.35 : 0;
  const pressure = Math.min(0.5, Math.max(0, failures - expectedFailures) * 0.08);
  return Math.max(0, Math.min(1, base - pressure));
}

export function chooseFailurePolicy(subsystem: SubsystemId): FailurePolicy {
  switch (subsystem) {
    case 'telemetry':
    case 'audio':
      return 'ignore';
    case 'render':
    case 'streaming':
      return 'degrade';
    case 'network':
    case 'workers':
    case 'camera':
    case 'input':
      return 'restart';
    case 'simulation':
    case 'persistence':
    case 'security':
      return 'fault-runtime';
  }
}

export function productionEventNames(): RuntimeEventName[] {
  return ['started','stopped','paused','resumed','frame','input','renderPlan','peer','fault','health','save','recovery'];
}

export function emptyRuntimeHealth(identity: RuntimeIdentity, clock: RuntimeClock, budget: RuntimeBudget, capabilities: RuntimeCapabilities): RuntimeHealthReport {
  const subsystems: SubsystemId[] = ['simulation','render','streaming','network','audio','input','persistence','workers','telemetry','camera','security'];
  return {
    identity,
    mode: 'booting',
    clock,
    budget,
    capabilities,
    subsystems: subsystems.map((subsystem) => ({ subsystem, level: 'ok', score: 1, consecutiveFailures: 0, updatedTick: clock.tick })),
    activeEntities: 0,
    residentChunks: 0,
    queuedInputs: 0,
    queuedWorkers: 0,
    peers: [],
  };
}
