export type R29Phase =
  | 'boot'
  | 'input'
  | 'simulation'
  | 'streaming'
  | 'render'
  | 'network'
  | 'telemetry'
  | 'shutdown';

export type R29RuntimeMode =
  | 'created'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'paused'
  | 'recovering'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type R29QualityTier = 'safe' | 'low' | 'medium' | 'high' | 'ultra';

export type R29Severity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export type R29Backend = 'webgpu' | 'webgl2' | 'webgl1' | 'headless';

export interface R29Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface R29Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface R29Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface R29InputIntent {
  readonly tick: number;
  readonly sequence: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly interact: boolean;
  readonly pause: boolean;
}

export interface R29EntityTransform {
  readonly entityId: number;
  readonly position: R29Vector3;
  readonly velocity: R29Vector3;
  readonly rotationY: number;
  readonly scale: R29Vector3;
  readonly active: boolean;
  readonly revision: number;
}

export interface R29EntityRecord {
  readonly id: number;
  readonly generation: number;
  readonly kind: string;
  readonly transform: R29EntityTransform;
  readonly importance: number;
  readonly tags: readonly string[];
}

export interface R29WorldInterest {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly radiusMeters: number;
  readonly prefetchMeters: number;
  readonly importance: number;
}

export type R29ZoneState = 'cold' | 'loading' | 'ready' | 'cooling' | 'failed';

export interface R29WorldZone {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
  readonly estimatedBytes: number;
  readonly priority: number;
  readonly state: R29ZoneState;
  readonly lastTouchedTick: number;
  readonly generation: number;
}

export interface R29StreamingPlan {
  readonly frame: number;
  readonly load: readonly string[];
  readonly retain: readonly string[];
  readonly unload: readonly string[];
  readonly prefetch: readonly string[];
  readonly estimatedBytesAfter: number;
}

export interface R29RenderPass {
  readonly id: string;
  readonly phase: R29Phase;
  readonly costMs: number;
  readonly gpuCostMs: number;
  readonly priority: number;
  readonly optional: boolean;
  readonly dependencies: readonly string[];
}

export interface R29RenderPlan {
  readonly backend: R29Backend;
  readonly tier: R29QualityTier;
  readonly passes: readonly R29RenderPass[];
  readonly skippedPasses: readonly string[];
  readonly hazards: readonly string[];
  readonly estimatedCpuMs: number;
  readonly estimatedGpuMs: number;
}

export interface R29RenderObservation {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly geometryBytes: number;
  readonly backend: R29Backend;
  readonly thermalPressure: number;
}

export interface R29QualityDecision {
  readonly tier: R29QualityTier;
  readonly scale: number;
  readonly pixelRatio: number;
  readonly maxVisibleObjects: number;
  readonly maxDrawCalls: number;
  readonly workerConcurrency: number;
  readonly reason: string;
}

export interface R29RuntimeBudget {
  readonly targetFrameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly telemetryMs: number;
  readonly memoryBytes: number;
  readonly visibleObjects: number;
  readonly drawCalls: number;
}

export interface R29BudgetUsage {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly telemetryMs: number;
  readonly memoryBytes: number;
  readonly visibleObjects: number;
  readonly drawCalls: number;
}

export interface R29BudgetPressure {
  readonly frame: number;
  readonly simulation: number;
  readonly render: number;
  readonly network: number;
  readonly telemetry: number;
  readonly memory: number;
  readonly visibility: number;
  readonly drawCalls: number;
  readonly aggregate: number;
}

export interface R29NetworkSample {
  readonly tick: number;
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly lossRatio: number;
  readonly inboundBytes: number;
  readonly outboundBytes: number;
  readonly acknowledgedSequence: number;
}

export type R29NetworkHealth = 'excellent' | 'good' | 'degraded' | 'poor' | 'offline';

export interface R29NetworkReport {
  readonly health: R29NetworkHealth;
  readonly score: number;
  readonly averageRttMs: number;
  readonly jitterMs: number;
  readonly lossRatio: number;
  readonly inboundBytesPerSecond: number;
  readonly outboundBytesPerSecond: number;
  readonly interpolationTicks: number;
  readonly inputRedundancy: number;
}

export interface R29PredictionFrame {
  readonly tick: number;
  readonly sequence: number;
  readonly input: R29InputIntent;
  readonly stateHash: string;
}

export interface R29SnapshotEntity {
  readonly id: number;
  readonly position: R29Vector3;
  readonly velocity: R29Vector3;
  readonly rotationY: number;
  readonly revision: number;
}

export interface R29NetworkSnapshot {
  readonly tick: number;
  readonly serverTick: number;
  readonly sequence: number;
  readonly acknowledgedInput: number;
  readonly entities: readonly R29SnapshotEntity[];
  readonly worldRevision: number;
  readonly digest: string;
}

export interface R29AssetManifestEntry {
  readonly id: string;
  readonly url: string;
  readonly kind: 'texture' | 'geometry' | 'audio' | 'shader' | 'data' | 'binary';
  readonly bytes: number;
  readonly priority: number;
  readonly required: boolean;
  readonly digest?: string;
  readonly version: string;
}

export type R29AssetState = 'declared' | 'loading' | 'resident' | 'stale' | 'failed' | 'disposed';

export interface R29AssetRecord {
  readonly manifest: R29AssetManifestEntry;
  readonly state: R29AssetState;
  readonly residentBytes: number;
  readonly lastUsedTick: number;
  readonly refCount: number;
  readonly failures: number;
}

export interface R29ResourceStats {
  readonly residentBytes: number;
  readonly reservedBytes: number;
  readonly maxBytes: number;
  readonly assetCount: number;
  readonly zoneCount: number;
}

export interface R29TelemetryPoint {
  readonly tick: number;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface R29Incident {
  readonly id: string;
  readonly tick: number;
  readonly severity: R29Severity;
  readonly code: string;
  readonly message: string;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export interface R29HealthSnapshot {
  readonly status: 'healthy' | 'degraded' | 'critical';
  readonly score: number;
  readonly mode: R29RuntimeMode;
  readonly tick: number;
  readonly quality: R29QualityDecision;
  readonly budget: R29BudgetPressure;
  readonly network: R29NetworkReport;
  readonly resources: R29ResourceStats;
  readonly incidents: readonly R29Incident[];
  readonly recommendations: readonly string[];
}

export interface R29RuntimeSnapshot {
  readonly runtimeVersion: 'r29';
  readonly mode: R29RuntimeMode;
  readonly phase: R29Phase;
  readonly tick: number;
  readonly frame: number;
  readonly backend: R29Backend;
  readonly quality: R29QualityDecision;
  readonly budget: R29BudgetPressure;
  readonly worldRevision: number;
  readonly entityCount: number;
  readonly activeEntityCount: number;
  readonly streaming: R29StreamingPlan;
  readonly render: R29RenderPlan;
  readonly network: R29NetworkReport;
  readonly resources: R29ResourceStats;
  readonly health: R29HealthSnapshot;
}

export interface R29RuntimeOptions {
  readonly tickRate?: number;
  readonly maxStepsPerFrame?: number;
  readonly maxFrameDeltaSeconds?: number;
  readonly qualityTier?: R29QualityTier;
  readonly backend?: R29Backend;
  readonly memoryBudgetBytes?: number;
  readonly debug?: boolean;
}

export interface R29LifecycleComponent {
  readonly id: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  dispose(): void;
}

export interface R29FrameContext {
  readonly frame: number;
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly fixedDeltaSeconds: number;
  readonly nowMs: number;
  readonly budget: R29RuntimeBudget;
}

export interface R29FrameResult {
  readonly steps: number;
  readonly droppedSteps: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly telemetryMs: number;
}

export interface R29TaskContext {
  readonly frame: number;
  readonly tick: number;
  readonly phase: R29Phase;
  readonly budget: R29RuntimeBudget;
}

export interface R29Task {
  readonly id: string;
  readonly phase: R29Phase;
  readonly priority: number;
  readonly budgetMs: number;
  readonly cadenceFrames: number;
  readonly optional: boolean;
  readonly run: (context: R29TaskContext) => void | Promise<void>;
}

export interface R29TaskResult {
  readonly id: string;
  readonly phase: R29Phase;
  readonly elapsedMs: number;
  readonly skipped: boolean;
  readonly failed: boolean;
  readonly error?: string;
}

export interface R29SchedulerSnapshot {
  readonly frame: number;
  readonly executed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly budgetUsedMs: number;
  readonly byPhase: Readonly<Record<R29Phase, number>>;
}

export interface R29ServiceState {
  readonly id: string;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly dependencies: readonly string[];
}

export interface R29RuntimeHooks {
  readonly onSnapshot?: (snapshot: R29RuntimeSnapshot) => void;
  readonly onIncident?: (incident: R29Incident) => void;
  readonly onError?: (error: unknown) => void;
}

export interface R29RuntimeCapabilities {
  readonly webGpu: boolean;
  readonly webGl2: boolean;
  readonly worker: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly pointerLock: boolean;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
}

export const R29_DEFAULT_BUDGET: R29RuntimeBudget = Object.freeze({
  targetFrameMs: 16.67,
  simulationMs: 6,
  renderMs: 8,
  networkMs: 1.5,
  telemetryMs: 0.75,
  memoryBytes: 768 * 1024 * 1024,
  visibleObjects: 1800,
  drawCalls: 3500,
});

export const R29_DEFAULT_CAPABILITIES: R29RuntimeCapabilities = Object.freeze({
  webGpu: false,
  webGl2: true,
  worker: true,
  sharedArrayBuffer: false,
  pointerLock: true,
  devicePixelRatio: 1,
  hardwareConcurrency: 4,
});

export function clampR29(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function finiteR29(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function freezeR29<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export function distanceSqR29(a: R29Vector3, b: R29Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function hashR29(input: string): string {
  let hashA = 2166136261 >>> 0;
  let hashB = 2246822519 >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 2246822519);
  }
  return (hashA >>> 0).toString(16).padStart(8, '0') + (hashB >>> 0).toString(16).padStart(8, '0');
}

export function stableObjectDigestR29(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      const source = input as Record<string, unknown>;
      return Object.fromEntries(Object.keys(source).sort().map((key) => [key, normalize(source[key])]));
    }
    if (typeof input === 'number' && !Number.isFinite(input)) return null;
    return input;
  };
  return hashR29(JSON.stringify(normalize(value)));
}
