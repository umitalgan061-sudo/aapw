import type { FrameId, PlatformError, QualityTier, Result, RuntimeSnapshot, UnixMillis, Vec3 } from './types';

/** Canonical runtime action identifiers shared by input, replay, accessibility and AI layers. */
export type RuntimeAction =
  | 'move.forward'
  | 'move.backward'
  | 'move.left'
  | 'move.right'
  | 'move.sprint'
  | 'move.jump'
  | 'camera.orbit.left'
  | 'camera.orbit.right'
  | 'camera.zoom.in'
  | 'camera.zoom.out'
  | 'interaction.primary'
  | 'interaction.secondary'
  | 'ui.pause'
  | 'ui.inventory'
  | 'ui.map'
  | 'ui.settings'
  | 'debug.toggle';

export type RuntimeInputSource = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'replay' | 'programmatic';

export interface InputActionEvent {
  readonly action: RuntimeAction;
  readonly source: RuntimeInputSource;
  readonly phase: 'pressed' | 'released' | 'value';
  readonly value: number;
  readonly timestamp: UnixMillis;
  readonly frame: FrameId;
  readonly repeat: boolean;
}

export interface Axis2D {
  readonly x: number;
  readonly y: number;
}

export interface InputFrameState {
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly axes: Readonly<Record<RuntimeAction, number>>;
  readonly pressed: readonly RuntimeAction[];
  readonly released: readonly RuntimeAction[];
  readonly sources: readonly RuntimeInputSource[];
}

export interface CameraFrameState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
}

export interface PlayerFrameState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly grounded: boolean;
  readonly health: number;
  readonly maxHealth: number;
}

export interface WorldFrameState {
  readonly timeOfDaySeconds: number;
  readonly weather: string;
  readonly loadedCells: readonly string[];
  readonly discoveredSettlements: readonly string[];
}

export interface SessionFrameState {
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly deltaSeconds: number;
  readonly quality: QualityTier;
  readonly player: PlayerFrameState;
  readonly camera: CameraFrameState;
  readonly world: WorldFrameState;
}

export interface SessionSnapshot extends SessionFrameState {
  readonly schema: 'aapw.session';
  readonly schemaVersion: number;
  readonly digest: string;
  readonly playtimeMs: number;
  readonly totalFrames: number;
  readonly runtime: RuntimeSnapshot;
}

export interface ReplayFrame {
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly actions: readonly InputActionEvent[];
}

export interface ReplayHeader {
  readonly schema: 'aapw.replay';
  readonly version: number;
  readonly seed: number;
  readonly fixedStepMs: number;
  readonly createdAt: UnixMillis;
  readonly runtimeVersion: string;
}

export interface ReplayRecording {
  readonly header: ReplayHeader;
  readonly frames: readonly ReplayFrame[];
  readonly checksum: string;
}

export interface SessionSettings {
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly quality: QualityTier;
  readonly reducedMotion: boolean;
  readonly cameraSensitivity: number;
  readonly touchSensitivity: number;
  readonly showPerformance: boolean;
  readonly autoSaveMinutes: number;
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = Object.freeze({
  masterVolume: 0.8,
  muted: false,
  quality: 'high',
  reducedMotion: false,
  cameraSensitivity: 1,
  touchSensitivity: 1,
  showPerformance: false,
  autoSaveMinutes: 3,
});

export interface SessionTelemetryPoint {
  readonly frame: FrameId;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly presentationMs: number;
  readonly inputMs: number;
  readonly saveMs: number;
  readonly entities: number;
  readonly streamedCells: number;
  readonly pressure: number;
}

export interface SessionTelemetrySummary {
  readonly sampleCount: number;
  readonly p50FrameMs: number;
  readonly p95FrameMs: number;
  readonly p99FrameMs: number;
  readonly avgEntities: number;
  readonly avgStreamedCells: number;
  readonly maxPressure: number;
  readonly budgetViolations: number;
}

export interface SessionEventMap {
  'session:started': { readonly at: UnixMillis };
  'session:stopped': { readonly at: UnixMillis; readonly playtimeMs: number };
  'session:frame': { readonly state: SessionFrameState };
  'session:save-requested': { readonly slot: number; readonly reason: string };
  'session:saved': { readonly slot: number; readonly checksum: string };
  'session:save-failed': { readonly slot: number; readonly error: PlatformError };
  'input:action': InputActionEvent;
  'input:replay-started': { readonly frame: FrameId };
  'input:replay-stopped': { readonly frames: number };
  'quality:changed': { readonly previous: QualityTier; readonly next: QualityTier; readonly reason: string };
  'performance:budget': { readonly name: string; readonly actualMs: number; readonly budgetMs: number };
  'performance:memory': { readonly usedBytes: number; readonly limitBytes: number; readonly ratio: number };
}

export type SessionListener<K extends keyof SessionEventMap> = (event: SessionEventMap[K]) => void;

export interface SessionClock {
  now(): UnixMillis;
}

export interface SessionEventBus {
  emit<K extends keyof SessionEventMap>(event: K, payload: SessionEventMap[K]): void;
  on<K extends keyof SessionEventMap>(event: K, listener: SessionListener<K>): () => void;
}

export interface SessionStateCodec<T> {
  capture(): T;
  restore(payload: T): Result<void>;
}

export interface SessionSavePayload {
  readonly settings: SessionSettings;
  readonly snapshot: SessionSnapshot;
  readonly replay?: ReplayRecording;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface SessionSaveHooks {
  beforeSave?: (payload: SessionSavePayload) => Promise<SessionSavePayload> | SessionSavePayload;
  afterSave?: (payload: SessionSavePayload) => void | Promise<void>;
}

export interface SessionBudget {
  readonly simulationMs: number;
  readonly inputMs: number;
  readonly presentationMs: number;
  readonly saveMs: number;
  readonly memoryBytes: number;
}

export const DEFAULT_SESSION_BUDGET: SessionBudget = Object.freeze({
  simulationMs: 5,
  inputMs: 1,
  presentationMs: 10,
  saveMs: 20,
  memoryBytes: 512 * 1024 * 1024,
});

export interface RuntimeSessionOptions {
  readonly seed?: number;
  readonly runtimeVersion?: string;
  readonly fixedStepMs?: number;
  readonly maxReplayFrames?: number;
  readonly telemetryCapacity?: number;
  readonly budget?: Partial<SessionBudget>;
  readonly clock?: SessionClock;
  readonly settings?: Partial<SessionSettings>;
}

export interface RuntimeSessionStatus {
  readonly running: boolean;
  readonly frame: FrameId;
  readonly startedAt: UnixMillis | null;
  readonly playtimeMs: number;
  readonly lastSaveAt: UnixMillis | null;
  readonly dirty: boolean;
  readonly replayRecording: boolean;
  readonly quality: QualityTier;
}

export interface RuntimeFrameMetrics {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly presentationMs: number;
  readonly inputMs: number;
  readonly saveMs: number;
  readonly entityCount: number;
  readonly streamedCells: number;
  readonly pressure: number;
  readonly memoryBytes?: number;
}

export function clampUnit(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizeAxis(value: number, deadZone = 0.08): number {
  const normalized = clampFinite(value, -1, 1, 0);
  const magnitude = Math.abs(normalized);
  if (magnitude <= deadZone) return 0;
  const sign = normalized < 0 ? -1 : 1;
  return sign * ((magnitude - deadZone) / (1 - deadZone));
}

export function normalizeAxis2D(axis: Axis2D, deadZone = 0.08): Axis2D {
  const x = normalizeAxis(axis.x, deadZone);
  const y = normalizeAxis(axis.y, deadZone);
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 1) return { x, y };
  return { x: x / magnitude, y: y / magnitude };
}

export function mergeAxes(a: Axis2D, b: Axis2D): Axis2D {
  return normalizeAxis2D({ x: a.x + b.x, y: a.y + b.y });
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = clampFinite(p, 0, 1, 0) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower] ?? 0;
  const t = rank - lower;
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * t;
}

export function average(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

export function sanitizeSettings(settings: Partial<SessionSettings> | undefined): SessionSettings {
  const merged = { ...DEFAULT_SESSION_SETTINGS, ...(settings ?? {}) };
  return Object.freeze({
    masterVolume: clampUnit(merged.masterVolume, DEFAULT_SESSION_SETTINGS.masterVolume),
    muted: Boolean(merged.muted),
    quality: merged.quality,
    reducedMotion: Boolean(merged.reducedMotion),
    cameraSensitivity: clampFinite(merged.cameraSensitivity, 0.1, 4, DEFAULT_SESSION_SETTINGS.cameraSensitivity),
    touchSensitivity: clampFinite(merged.touchSensitivity, 0.1, 4, DEFAULT_SESSION_SETTINGS.touchSensitivity),
    showPerformance: Boolean(merged.showPerformance),
    autoSaveMinutes: clampFinite(merged.autoSaveMinutes, 1, 60, DEFAULT_SESSION_SETTINGS.autoSaveMinutes),
  });
}

export function sanitizeBudget(budget: Partial<SessionBudget> | undefined): SessionBudget {
  const source = { ...DEFAULT_SESSION_BUDGET, ...(budget ?? {}) };
  return Object.freeze({
    simulationMs: clampFinite(source.simulationMs, 0.25, 25, DEFAULT_SESSION_BUDGET.simulationMs),
    inputMs: clampFinite(source.inputMs, 0.1, 10, DEFAULT_SESSION_BUDGET.inputMs),
    presentationMs: clampFinite(source.presentationMs, 1, 40, DEFAULT_SESSION_BUDGET.presentationMs),
    saveMs: clampFinite(source.saveMs, 1, 500, DEFAULT_SESSION_BUDGET.saveMs),
    memoryBytes: Math.max(32 * 1024 * 1024, Math.trunc(Number.isFinite(source.memoryBytes) ? source.memoryBytes : DEFAULT_SESSION_BUDGET.memoryBytes)),
  });
}

export function freezeInputEvent(event: InputActionEvent): InputActionEvent {
  return Object.freeze({
    action: event.action,
    source: event.source,
    phase: event.phase,
    value: clampFinite(event.value, -1, 1, 0),
    timestamp: event.timestamp,
    frame: event.frame,
    repeat: Boolean(event.repeat),
  });
}

export function freezeReplay(recording: ReplayRecording): ReplayRecording {
  const frames = recording.frames.map((frame) => Object.freeze({
    frame: frame.frame,
    timestamp: frame.timestamp,
    actions: Object.freeze(frame.actions.map(freezeInputEvent)),
  }));
  return Object.freeze({
    header: Object.freeze({ ...recording.header }),
    frames: Object.freeze(frames),
    checksum: recording.checksum,
  });
}

export function makeFrameState(snapshot: SessionFrameState): SessionFrameState {
  return Object.freeze({
    frame: snapshot.frame,
    timestamp: snapshot.timestamp,
    deltaSeconds: Math.max(0, snapshot.deltaSeconds),
    quality: snapshot.quality,
    player: Object.freeze({
      position: Object.freeze({ ...snapshot.player.position }),
      velocity: Object.freeze({ ...snapshot.player.velocity }),
      grounded: Boolean(snapshot.player.grounded),
      health: Math.max(0, snapshot.player.health),
      maxHealth: Math.max(0, snapshot.player.maxHealth),
    }),
    camera: Object.freeze({
      position: Object.freeze({ ...snapshot.camera.position }),
      target: Object.freeze({ ...snapshot.camera.target }),
      yaw: Number.isFinite(snapshot.camera.yaw) ? snapshot.camera.yaw : 0,
      pitch: Number.isFinite(snapshot.camera.pitch) ? snapshot.camera.pitch : 0,
      zoom: Math.max(0, snapshot.camera.zoom),
    }),
    world: Object.freeze({
      timeOfDaySeconds: Math.max(0, snapshot.world.timeOfDaySeconds),
      weather: String(snapshot.world.weather),
      loadedCells: Object.freeze([...snapshot.world.loadedCells]),
      discoveredSettlements: Object.freeze([...snapshot.world.discoveredSettlements]),
    }),
  });
}

export function mergeRuntimeOptions(options: RuntimeSessionOptions = {}): Required<RuntimeSessionOptions> {
  return {
    seed: options.seed ?? 0x5745535445524f53,
    runtimeVersion: options.runtimeVersion ?? 'aapw-modern-runtime',
    fixedStepMs: clampFinite(options.fixedStepMs ?? 1000 / 60, 4, 100, 1000 / 60),
    maxReplayFrames: Math.max(60, Math.trunc(options.maxReplayFrames ?? 60 * 60 * 30)),
    telemetryCapacity: Math.max(120, Math.trunc(options.telemetryCapacity ?? 3600)),
    budget: sanitizeBudget(options.budget),
    clock: options.clock ?? { now: () => Date.now() as UnixMillis },
    settings: sanitizeSettings(options.settings),
  };
}

export function isFiniteVec3(value: Vec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function validateFrameMetrics(metrics: RuntimeFrameMetrics): Result<void> {
  const numeric = [metrics.frameMs, metrics.simulationMs, metrics.presentationMs, metrics.inputMs, metrics.saveMs, metrics.entityCount, metrics.streamedCells, metrics.pressure];
  if (numeric.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ok: false, error: { code: 'SESSION_METRICS_INVALID', message: 'Runtime frame metrics contain an invalid numeric value', retryable: false } };
  }
  if (metrics.memoryBytes !== undefined && (!Number.isFinite(metrics.memoryBytes) || metrics.memoryBytes < 0)) {
    return { ok: false, error: { code: 'SESSION_MEMORY_INVALID', message: 'Runtime memory usage is invalid', retryable: false } };
  }
  return { ok: true, value: undefined };
}

export function summarizeTelemetry(points: readonly SessionTelemetryPoint[]): SessionTelemetrySummary {
  const frameMs = points.map((point) => point.frameMs);
  const entities = points.map((point) => point.entities);
  const streamed = points.map((point) => point.streamedCells);
  const pressures = points.map((point) => point.pressure);
  return Object.freeze({
    sampleCount: points.length,
    p50FrameMs: percentile(frameMs, 0.5),
    p95FrameMs: percentile(frameMs, 0.95),
    p99FrameMs: percentile(frameMs, 0.99),
    avgEntities: average(entities),
    avgStreamedCells: average(streamed),
    maxPressure: pressures.length ? Math.max(...pressures) : 0,
    budgetViolations: points.reduce((count, point) => count + Number(point.frameMs > 33.333 || point.simulationMs > 10 || point.presentationMs > 25), 0),
  });
}
