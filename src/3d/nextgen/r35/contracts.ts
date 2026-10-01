export const R35_VERSION = 35 as const;

export type RuntimeMode = 'booting' | 'loading' | 'running' | 'paused' | 'recovering' | 'stopping' | 'stopped' | 'faulted';
export type RuntimePhase = 'input' | 'simulation' | 'ai' | 'navigation' | 'streaming' | 'network' | 'persistence' | 'render' | 'telemetry';
export type PriorityBand = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'unknown';
export type FeatureKey =
  | 'deterministicSimulation'
  | 'prediction'
  | 'rollback'
  | 'streaming'
  | 'dynamicQuality'
  | 'ai'
  | 'networkReplication'
  | 'offlinePersistence'
  | 'workerPool'
  | 'accessibility'
  | 'diagnostics';

export interface R35Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface R35Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface R35Transform {
  readonly position: R35Vector3;
  readonly rotation: R35Quaternion;
  readonly scale: R35Vector3;
}

export interface R35InputFrame {
  readonly tick: number;
  readonly sequence: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly buttons: number;
  readonly pressed: readonly string[];
  readonly released: readonly string[];
  readonly source: 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'mixed' | 'replay';
}

export interface R35PlayerRuntime {
  readonly id: number;
  readonly transform: R35Transform;
  readonly velocity: R35Vector3;
  readonly stamina: number;
  readonly health: number;
  readonly grounded: boolean;
  readonly sprinting: boolean;
  readonly crouching: boolean;
  readonly dodging: boolean;
  readonly yaw: number;
  readonly inputSequence: number;
}

export interface R35WorldRuntime {
  readonly tick: number;
  readonly seed: number;
  readonly entityCount: number;
  readonly activeCount: number;
  readonly loadedChunks: number;
  readonly streamingQueue: number;
  readonly weatherKey: string;
}

export interface R35NetworkRuntime {
  readonly connected: boolean;
  readonly serverTick: number;
  readonly lastAckSequence: number;
  readonly pendingCommands: number;
  readonly packetsIn: number;
  readonly packetsOut: number;
  readonly rejectedCommands: number;
}

export interface R35QualityRuntime {
  readonly quality: string;
  readonly renderScale: number;
  readonly pixelRatioCap: number;
  readonly shadowTier: number;
  readonly vegetationDensity: number;
  readonly postProcessing: boolean;
}

export interface R35TelemetryRuntime {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly streamingMs: number;
  readonly memoryBytes: number;
  readonly entityCount: number;
}

export interface R35FeatureSet {
  readonly [key: string]: boolean;
}

export interface R35RuntimeSnapshot {
  readonly version: typeof R35_VERSION;
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly wallClockMs: number;
  readonly player: R35PlayerRuntime | null;
  readonly world: R35WorldRuntime;
  readonly network: R35NetworkRuntime;
  readonly quality: R35QualityRuntime;
  readonly telemetry: R35TelemetryRuntime;
  readonly features: R35FeatureSet;
}

export interface R35RuntimeEventBase {
  readonly tick: number;
  readonly sequence: number;
  readonly timestampMs: number;
}

export type R35RuntimeEvent =
  | (R35RuntimeEventBase & { readonly type: 'runtime.mode'; readonly from: RuntimeMode; readonly to: RuntimeMode; readonly reason: string })
  | (R35RuntimeEventBase & { readonly type: 'input.frame'; readonly frame: R35InputFrame })
  | (R35RuntimeEventBase & { readonly type: 'world.tick'; readonly entities: number; readonly active: number })
  | (R35RuntimeEventBase & { readonly type: 'asset.state'; readonly key: string; readonly state: string })
  | (R35RuntimeEventBase & { readonly type: 'network.command'; readonly entityId: number; readonly commandType: string; readonly accepted: boolean })
  | (R35RuntimeEventBase & { readonly type: 'quality.changed'; readonly quality: string; readonly reason: string })
  | (R35RuntimeEventBase & { readonly type: 'health.warning'; readonly domain: RuntimePhase; readonly utilization: number })
  | (R35RuntimeEventBase & { readonly type: 'fault'; readonly code: string; readonly message: string });

export interface R35FrameBudget {
  readonly phase: RuntimePhase;
  readonly budgetMs: number;
  readonly warningRatio: number;
  readonly criticalRatio: number;
  readonly maxWorkItems: number;
}

export interface R35WorkItem<T = unknown> {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly priority: PriorityBand;
  readonly estimatedMs: number;
  readonly deadlineTick: number | null;
  readonly coalescingKey: string | null;
  readonly payload: T;
  readonly execute: (payload: T) => void | Promise<void>;
}

export interface R35WorkResult {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly started: boolean;
  readonly completed: boolean;
  readonly deferred: boolean;
  readonly reason: string | null;
}

export interface R35AssetNode {
  readonly key: string;
  readonly uri: string;
  readonly byteSize: number;
  readonly priority: PriorityBand;
  readonly dependencies: readonly string[];
  readonly tags: readonly string[];
  readonly state: 'idle' | 'queued' | 'loading' | 'ready' | 'failed' | 'evicted';
  readonly refs: number;
  readonly attempts: number;
  readonly lastUsedTick: number;
}

export interface R35Command {
  readonly sequence: number;
  readonly tick: number;
  readonly entityId: number;
  readonly type: string;
  readonly payload: unknown;
}

export interface R35HealthMetric {
  readonly domain: RuntimePhase;
  readonly utilization: number;
  readonly healthy: boolean;
  readonly sampleCount: number;
  readonly errorCount: number;
}

export interface R35HealthReport {
  readonly ok: boolean;
  readonly score: number;
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly metrics: readonly R35HealthMetric[];
  readonly warnings: readonly string[];
}

export interface R35RuntimeConfig {
  readonly seed: number;
  readonly fixedDeltaSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly snapshotHistory: number;
  readonly inputBufferTicks: number;
  readonly maxAssetsBytes: number;
  readonly maxWorkers: number;
  readonly frameBudgets: readonly R35FrameBudget[];
  readonly features: R35FeatureSet;
}

export interface R35RuntimeError extends Error {
  readonly code: string;
  readonly phase: RuntimePhase | null;
  readonly tick: number;
  readonly recoverable: boolean;
}

export function vec3(x = 0, y = 0, z = 0): R35Vector3 {
  return Object.freeze({ x, y, z });
}

export function quat(x = 0, y = 0, z = 0, w = 1): R35Quaternion {
  return Object.freeze({ x, y, z, w });
}

export function identityTransform(): R35Transform {
  return Object.freeze({
    position: vec3(),
    rotation: quat(),
    scale: vec3(1, 1, 1),
  });
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeFeatureSet(input: Partial<R35FeatureSet>): R35FeatureSet {
  const defaults: R35FeatureSet = {
    deterministicSimulation: true,
    prediction: true,
    rollback: true,
    streaming: true,
    dynamicQuality: true,
    ai: true,
    networkReplication: true,
    offlinePersistence: true,
    workerPool: true,
    accessibility: true,
    diagnostics: true,
  };
  return Object.freeze({ ...defaults, ...input });
}

export function validateConfig(config: R35RuntimeConfig): void {
  if (!Number.isInteger(config.seed) || config.seed < 0) throw new RangeError('seed must be a non-negative integer');
  if (!(config.fixedDeltaSeconds > 0) || !Number.isFinite(config.fixedDeltaSeconds)) throw new RangeError('fixedDeltaSeconds must be positive');
  if (!Number.isInteger(config.maxCatchUpSteps) || config.maxCatchUpSteps < 1) throw new RangeError('maxCatchUpSteps must be >= 1');
  if (!Number.isInteger(config.snapshotHistory) || config.snapshotHistory < 1) throw new RangeError('snapshotHistory must be >= 1');
  if (!Number.isInteger(config.inputBufferTicks) || config.inputBufferTicks < 1) throw new RangeError('inputBufferTicks must be >= 1');
  if (!Number.isInteger(config.maxAssetsBytes) || config.maxAssetsBytes < 1024) throw new RangeError('maxAssetsBytes is too small');
  if (!Number.isInteger(config.maxWorkers) || config.maxWorkers < 1) throw new RangeError('maxWorkers must be >= 1');
  for (const budget of config.frameBudgets) {
    if (!(budget.budgetMs > 0)) throw new RangeError('budgetMs must be positive');
    if (!(budget.warningRatio > 0 && budget.warningRatio <= budget.criticalRatio)) throw new RangeError('invalid budget ratios');
    if (!Number.isInteger(budget.maxWorkItems) || budget.maxWorkItems < 1) throw new RangeError('maxWorkItems must be >= 1');
  }
}
