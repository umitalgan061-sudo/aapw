export type Brand<T, B extends string> = T & { readonly __brand: B };
export type EntityId = Brand<string, 'EntityId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type ZoneId = Brand<string, 'ZoneId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type PassId = Brand<string, 'PassId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type TraceId = Brand<string, 'TraceId'>;

export type RuntimePhase = 'input' | 'simulation' | 'streaming' | 'animation' | 'render' | 'post-render' | 'telemetry';
export type RuntimeState = 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed';
export type BackendKind = 'webgpu' | 'webgl2' | 'webgl' | 'none';
export type QualityTier = 'ultra' | 'high' | 'balanced' | 'low' | 'safe';
export type Result<T, E = RuntimeError> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export interface RuntimeError { readonly code: string; readonly message: string; readonly cause?: unknown; readonly recoverable: boolean; readonly timestampMs: number; }
export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface RuntimeBudget { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly memoryBytes: number; readonly assetBytes: number; readonly residentZones: number; }
export interface RuntimeBudgetObservation extends RuntimeBudget { readonly frameOverBudget: boolean; readonly cpuOverBudget: boolean; readonly gpuOverBudget: boolean; readonly memoryOverBudget: boolean; readonly timestampMs: number; }
export interface RuntimeFrameContext { readonly frame: number; readonly simulationTick: number; readonly deltaMs: number; readonly fixedDeltaMs: number; readonly timestampMs: number; readonly phase: RuntimePhase; readonly budget: RuntimeBudget; readonly signal?: AbortSignal; }
export interface ScheduledTask { readonly id: TaskId; readonly phase: RuntimePhase; readonly priority: number; readonly budgetMs: number; readonly cadenceFrames: number; readonly enabled: boolean; readonly run: (context: RuntimeFrameContext) => void | Promise<void>; }
export interface TaskRunRecord { readonly id: TaskId; readonly phase: RuntimePhase; readonly startedAtMs: number; readonly elapsedMs: number; readonly skipped: boolean; readonly error: string | null; }
export interface SchedulerSnapshot { readonly frame: number; readonly executedTasks: number; readonly skippedTasks: number; readonly failedTasks: number; readonly budgetUsedMs: number; readonly budgetLimitMs: number; readonly phaseUtilization: Readonly<Record<RuntimePhase, number>>; readonly records: readonly TaskRunRecord[]; }

export interface RenderCapabilities { readonly backend: BackendKind; readonly webgpu: boolean; readonly webgl2: boolean; readonly webgl: boolean; readonly secureContext: boolean; readonly offscreenCanvas: boolean; readonly sharedArrayBuffer: boolean; readonly crossOriginIsolated: boolean; readonly maxTextureSize: number; readonly maxSamples: number; readonly maxUniformBufferSize: number; readonly deviceMemoryGb: number; readonly hardwareConcurrency: number; readonly pixelRatio: number; readonly viewportWidth: number; readonly viewportHeight: number; readonly prefersReducedMotion: boolean; readonly saveData: boolean; readonly coarsePointer: boolean; }
export interface RenderProfile { readonly tier: QualityTier; readonly backend: BackendKind; readonly pixelRatio: number; readonly shadowResolution: number; readonly drawDistanceMeters: number; readonly vegetationDensity: number; readonly particleDensity: number; readonly postFxQuality: number; readonly temporalHistory: boolean; readonly targetFps: number; readonly maxVisibleObjects: number; }
export interface RenderObservation { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly memoryPressure: number; readonly thermalPressure: number; readonly drawCalls: number; readonly visibleObjects: number; readonly timestampMs: number; }
export interface RenderDecision extends RenderProfile { readonly changed: boolean; readonly reason: string; readonly score: number; readonly timestampMs: number; }
export type RenderResourceKind = 'texture' | 'buffer' | 'depth' | 'history';
export interface RenderResourceDescriptor { readonly id: ResourceId; readonly kind: RenderResourceKind; readonly width: number; readonly height: number; readonly format: string; readonly bytesPerPixel: number; readonly transient: boolean; readonly samples: number; }
export interface RenderPassDescriptor { readonly id: PassId; readonly name: string; readonly reads: readonly ResourceId[]; readonly writes: readonly ResourceId[]; readonly estimatedGpuMs: number; readonly enabled?: boolean; readonly execute: (context: RenderPassExecutionContext) => void; }
export interface RenderPassExecutionContext { readonly frame: number; readonly backend: BackendKind; readonly getResource: (id: ResourceId) => RenderResourceDescriptor | undefined; readonly debug: boolean; }
export interface RenderGraphPlan { readonly passes: readonly RenderPassDescriptor[]; readonly resources: readonly RenderResourceDescriptor[]; readonly transientResources: readonly ResourceId[]; readonly gpuEstimateMs: number; readonly dependencies: Readonly<Record<PassId, readonly PassId[]>>; readonly hazards: readonly string[]; }

export interface AssetManifestEntry { readonly id: AssetId; readonly url: string; readonly type: 'gltf' | 'texture' | 'audio' | 'json' | 'binary'; readonly priority: number; readonly bytes: number; readonly critical: boolean; readonly sha256?: string; readonly tags: readonly string[]; readonly dependencies: readonly AssetId[]; }
export type AssetState = 'declared' | 'queued' | 'loading' | 'ready' | 'failed' | 'evicted' | 'aborted';
export interface AssetRecord extends AssetManifestEntry { readonly state: AssetState; readonly attempts: number; readonly residentBytes: number; readonly lastUsedFrame: number; readonly lastError: string | null; readonly progress: number; }
export interface AssetLoadRequest { readonly id: AssetId; readonly requestedAtFrame: number; readonly deadlineFrame: number; readonly priorityBoost: number; readonly signal?: AbortSignal; }
export interface AssetLoadResult { readonly id: AssetId; readonly ok: boolean; readonly bytes: number; readonly durationMs: number; readonly attempts: number; readonly error: string | null; }
export interface AssetTransport { load(entry: AssetManifestEntry, signal?: AbortSignal): Promise<Readonly<{ bytes: number; payload: unknown }>>; }
export interface AssetRuntimeOptions { readonly maxResidentBytes: number; readonly maxConcurrentLoads: number; readonly maxAttempts: number; readonly retryBaseDelayMs: number; readonly retryMaxDelayMs: number; readonly clock: RuntimeClock; readonly transport: AssetTransport; }
export interface AssetRuntimeSnapshot { readonly residentBytes: number; readonly maxResidentBytes: number; readonly inFlight: number; readonly queueLength: number; readonly records: readonly AssetRecord[]; }

export interface RuntimeClock { nowMs(): number; simulationTick(): number; fixedStepMs(): number; }
export interface WorldZoneDescriptor { readonly id: ZoneId; readonly center: Vec2; readonly radiusMeters: number; readonly memoryBytes: number; readonly loadCostMs: number; readonly priority: number; readonly critical: boolean; readonly dependencies: readonly ZoneId[]; readonly tags: readonly string[]; }
export type ZoneState = 'absent' | 'loading' | 'ready' | 'degraded' | 'unloading';
export interface WorldZoneRecord extends WorldZoneDescriptor { readonly state: ZoneState; readonly distanceMeters: number; readonly score: number; readonly lastTouchedFrame: number; readonly failure: string | null; }
export interface WorldInterest { readonly position: Vec2; readonly velocity: Vec2; readonly horizonSeconds: number; readonly prefetchRadiusMeters: number; readonly importance: number; }
export interface WorldPlan { readonly frame: number; readonly load: readonly ZoneId[]; readonly keep: readonly ZoneId[]; readonly unload: readonly ZoneId[]; readonly predicted: readonly ZoneId[]; readonly blockedUnload: readonly ZoneId[]; readonly residentBytes: number; readonly pressure: number; }
export interface WorldRuntimeSnapshot { readonly frame: number; readonly residentBytes: number; readonly maxResidentBytes: number; readonly pressure: number; readonly zones: readonly WorldZoneRecord[]; }

export interface MetricValue { readonly name: string; readonly value: number; readonly tags: Readonly<Record<string, string>>; readonly timestampMs: number; }
export interface HistogramSnapshot { readonly name: string; readonly count: number; readonly min: number; readonly max: number; readonly mean: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly buckets: readonly number[]; }
export interface TraceSpan { readonly traceId: TraceId; readonly name: string; readonly startMs: number; readonly durationMs: number; readonly attributes: Readonly<Record<string, string | number | boolean>>; }
export interface RuntimeEvent { readonly id: string; readonly name: string; readonly severity: 'debug' | 'info' | 'warn' | 'error'; readonly frame: number; readonly timestampMs: number; readonly attributes: Readonly<Record<string, string | number | boolean>>; }
export interface ObservabilitySnapshot { readonly counters: Readonly<Record<string, number>>; readonly gauges: Readonly<Record<string, number>>; readonly histograms: readonly HistogramSnapshot[]; readonly spans: readonly TraceSpan[]; readonly events: readonly RuntimeEvent[]; }

export interface RuntimeSecurityPolicy { readonly maxInputPayloadBytes: number; readonly maxMessageBytes: number; readonly maxTextLength: number; readonly maxIdLength: number; readonly allowedOrigins: readonly string[]; readonly maxMessagesPerSecond: number; }
export interface SecurityEnvelope { readonly version: 1; readonly type: string; readonly nonce: string; readonly timestampMs: number; readonly payload: unknown; readonly byteLength: number; }
export interface SecurityValidationResult { readonly ok: boolean; readonly code: string; readonly reason: string; readonly sanitized?: unknown; }
export interface RuntimeHealthSnapshot { readonly state: RuntimeState; readonly frame: number; readonly score: number; readonly grade: 'A' | 'B' | 'C' | 'D' | 'F'; readonly frameP95Ms: number; readonly memoryPressure: number; readonly renderPressure: number; readonly assetPressure: number; readonly worldPressure: number; readonly recommendations: readonly string[]; }
export interface R25RuntimeSnapshot { readonly state: RuntimeState; readonly frame: number; readonly timestampMs: number; readonly backend: BackendKind; readonly profile: RenderDecision; readonly scheduler: SchedulerSnapshot; readonly assets: AssetRuntimeSnapshot; readonly world: WorldRuntimeSnapshot; readonly observability: ObservabilitySnapshot; readonly health: RuntimeHealthSnapshot; }

export function entityId(value: string): EntityId { const v = value.trim(); if (!v) throw new Error('R25_ENTITY_ID_EMPTY'); return v as EntityId; }
export function assetId(value: string): AssetId { const v = value.trim(); if (!v) throw new Error('R25_ASSET_ID_EMPTY'); return v as AssetId; }
export function zoneId(value: string): ZoneId { const v = value.trim(); if (!v) throw new Error('R25_ZONE_ID_EMPTY'); return v as ZoneId; }
export function taskId(value: string): TaskId { const v = value.trim(); if (!v) throw new Error('R25_TASK_ID_EMPTY'); return v as TaskId; }
export function passId(value: string): PassId { const v = value.trim(); if (!v) throw new Error('R25_PASS_ID_EMPTY'); return v as PassId; }
export function resourceId(value: string): ResourceId { const v = value.trim(); if (!v) throw new Error('R25_RESOURCE_ID_EMPTY'); return v as ResourceId; }
export function traceId(value: string): TraceId { const v = value.trim(); if (!v) throw new Error('R25_TRACE_ID_EMPTY'); return v as TraceId; }
export function ok<T, E = never>(value: T): Result<T, E> { return Object.freeze({ ok: true as const, value }); }
export function fail<E = RuntimeError>(error: E): Result<never, E> { return Object.freeze({ ok: false as const, error }); }
export function freezeRecord<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
export function clamp01(value: number): number { return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)); }
export function distance2D(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function predictPosition(position: Vec2, velocity: Vec2, seconds: number): Vec2 { const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0); return Object.freeze({ x: position.x + velocity.x * t, y: position.y + velocity.y * t }); }
export function sanitizeFinite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
export function normalizeRatio(value: number, fallback = 1): number { return Math.max(0.001, sanitizeFinite(value, fallback)); }
export function comparePriority(a: { priority: number; id: string }, b: { priority: number; id: string }): number { const priority = b.priority - a.priority; return priority !== 0 ? priority : a.id.localeCompare(b.id); }
export function percentile(values: readonly number[], percentileValue: number): number { if (values.length === 0) return 0; const sorted = [...values].sort((a,b)=>a-b); const p = Math.min(1, Math.max(0, percentileValue)); const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * p))); return sorted[index] ?? 0; }
export function gradeFromScore(score: number): RuntimeHealthSnapshot['grade'] { const n = clamp01(score); return n >= .9 ? 'A' : n >= .8 ? 'B' : n >= .68 ? 'C' : n >= .5 ? 'D' : 'F'; }
export function createBudgetObservation(budget: RuntimeBudget, values: Pick<RuntimeBudgetObservation,'frameOverBudget'|'cpuOverBudget'|'gpuOverBudget'|'memoryOverBudget'>, timestampMs: number): RuntimeBudgetObservation { return Object.freeze({ ...budget, ...values, timestampMs }); }
export function immutable<T>(value: T): T { if (value && typeof value === 'object') return Object.freeze(value); return value; }
export function stableString(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return '[' + value.map(stableString).join(',') + ']'; const object = value as Record<string, unknown>; return '{' + Object.keys(object).sort().map(key => JSON.stringify(key)+':'+stableString(object[key])).join(',') + '}'; }
export function stableHash(value: unknown): string { let hash = 2166136261; for (const char of stableString(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
