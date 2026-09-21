import type { CameraState, FrameExecutionContext, FrameId, QualityTier, RuntimeSnapshot, UnixMillis, Vec3 } from './types';
import { checksum } from './deterministic';
import { RuntimeKernel, type KernelFrameInput, type KernelFrameResult } from './runtimeKernel';
import { SaveCoordinator } from './saveCoordinator';
import { ActionMap, ReplayPlayer, ReplayRecorder } from './inputCommandLayer';
import {
  average,
  clampFinite,
  makeFrameState,
  sanitizeBudget,
  sanitizeSettings,
  summarizeTelemetry,
  type CameraFrameState,
  type InputActionEvent,
  type PlayerFrameState,
  type ReplayRecording,
  type RuntimeFrameMetrics,
  type RuntimeSessionOptions,
  type RuntimeSessionStatus,
  type SessionBudget,
  type SessionEventBus,
  type SessionEventMap,
  type SessionFrameState,
  type SessionSavePayload,
  type SessionSettings,
  type SessionSnapshot,
  type SessionTelemetryPoint,
  type WorldFrameState,
} from './runtimeContracts';
import { PerformanceLab } from './performanceLab';

class LocalSessionBus implements SessionEventBus {
  #listeners = new Map<keyof SessionEventMap, Set<(event: never) => void>>();

  emit<K extends keyof SessionEventMap>(event: K, payload: SessionEventMap[K]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload as never);
  }

  on<K extends keyof SessionEventMap>(event: K, listener: (payload: SessionEventMap[K]) => void): () => void {
    const listeners = this.#listeners.get(event) ?? new Set<(event: never) => void>();
    listeners.add(listener as (event: never) => void);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener as (event: never) => void);
  }
}

export interface RuntimeSceneAdapter {
  capturePlayer?(): PlayerFrameState;
  captureCamera?(): CameraFrameState;
  captureWorld?(): WorldFrameState;
  applySnapshot?(snapshot: SessionSnapshot): Promise<void> | void;
  getViewport?(): { readonly width: number; readonly height: number; readonly dpr: number };
  getRenderMetrics?(): { readonly drawCalls: number; readonly triangles: number; readonly visibleObjects: number; readonly textureBytes: number; readonly gpuMs?: number; readonly memoryPressure?: number; readonly thermalPressure?: number };
}

export interface RuntimeSessionOptionsExtended extends RuntimeSessionOptions {
  readonly scene?: RuntimeSceneAdapter;
  readonly kernel?: RuntimeKernel;
  readonly save?: SaveCoordinator;
}

export interface SessionTickResult {
  readonly runtime: KernelFrameResult;
  readonly snapshot: SessionSnapshot;
  readonly input: ReturnType<ActionMap['snapshot']>;
  readonly metrics: RuntimeFrameMetrics;
}

export interface RuntimeSessionDiagnostics {
  readonly status: RuntimeSessionStatus;
  readonly settings: SessionSettings;
  readonly budget: SessionBudget;
  readonly save: Readonly<Record<string, unknown>>;
  readonly performance: Readonly<Record<string, unknown>>;
  readonly telemetry: Readonly<Record<string, number>>;
  readonly lastSnapshot: SessionSnapshot | null;
}

const DEFAULT_PLAYER: PlayerFrameState = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  velocity: Object.freeze({ x: 0, y: 0, z: 0 }),
  grounded: true,
  health: 100,
  maxHealth: 100,
});

const DEFAULT_CAMERA: CameraFrameState = Object.freeze({
  position: Object.freeze({ x: 0, y: 3, z: 6 }),
  target: Object.freeze({ x: 0, y: 1, z: 0 }),
  yaw: 0,
  pitch: 0.25,
  zoom: 6,
});

const DEFAULT_WORLD: WorldFrameState = Object.freeze({
  timeOfDaySeconds: 0,
  weather: 'clear',
  loadedCells: Object.freeze([]),
  discoveredSettlements: Object.freeze([]),
});

function asCameraState(camera: CameraFrameState, adapter?: RuntimeSceneAdapter): CameraState {
  const viewport = adapter?.getViewport?.() ?? { width: 1280, height: 720, dpr: 1 };
  return {
    position: { ...camera.position },
    target: { ...camera.target },
    fov: 60,
    near: 0.1,
    far: 5000,
    viewportWidth: Math.max(1, viewport.width),
    viewportHeight: Math.max(1, viewport.height),
    dpr: Math.max(1, viewport.dpr),
  };
}

function clonePlayer(value: PlayerFrameState): PlayerFrameState {
  return Object.freeze({
    ...value,
    position: Object.freeze({ ...value.position }),
    velocity: Object.freeze({ ...value.velocity }),
  });
}

function cloneCamera(value: CameraFrameState): CameraFrameState {
  return Object.freeze({ ...value, position: Object.freeze({ ...value.position }), target: Object.freeze({ ...value.target }) });
}

function cloneWorld(value: WorldFrameState): WorldFrameState {
  return Object.freeze({
    ...value,
    loadedCells: Object.freeze([...value.loadedCells]),
    discoveredSettlements: Object.freeze([...value.discoveredSettlements]),
  });
}

/**
 * Full modern session coordinator.
 *
 * Responsibilities are intentionally narrow: input normalization, deterministic kernel ticks,
 * persistent autosave, replay capture/playback, performance telemetry and immutable session snapshots.
 * Three.js remains an adapter concern, so the same coordinator runs in browser, test and headless CI.
 */
export class RuntimeSession {
  readonly kernel: RuntimeKernel;
  readonly inputs: ActionMap;
  readonly recorder: ReplayRecorder;
  readonly player: ReplayPlayer;
  readonly saves: SaveCoordinator;
  readonly performance: PerformanceLab;
  readonly events: SessionEventBus;
  readonly budget: SessionBudget;
  #scene?: RuntimeSceneAdapter;
  #settings: SessionSettings;
  #runtimeVersion: string;
  #startedAt: UnixMillis | null = null;
  #lastTimestamp: UnixMillis | null = null;
  #lastSaveAt: UnixMillis | null = null;
  #frame = 0;
  #playtimeMs = 0;
  #running = false;
  #dirty = false;
  #replayRecording = false;
  #lastSnapshot: SessionSnapshot | null = null;
  #telemetry: SessionTelemetryPoint[] = [];
  #telemetryCapacity: number;
  #destroyed = false;

  constructor(options: RuntimeSessionOptionsExtended = {}) {
    const seed = options.seed ?? 0x5745535445524f53;
    this.kernel = options.kernel ?? new RuntimeKernel({ seed, fixedStepMs: options.fixedStepMs });
    this.inputs = new ActionMap({ now: options.clock?.now });
    const runtime = {
      seed,
      fixedStepMs: options.fixedStepMs ?? 1000 / 60,
      runtimeVersion: options.runtimeVersion ?? 'aapw-modern-runtime',
      maxFrames: options.maxReplayFrames,
      now: options.clock?.now,
    };
    this.recorder = new ReplayRecorder(runtime);
    this.player = new ReplayPlayer({
      onEvent: (event) => {
        this.inputs.handleAxis(event.action, event.value, 'replay', event.frame);
      },
      strictSeed: seed,
      strictFixedStepMs: runtime.fixedStepMs,
    });
    this.saves = options.save ?? new SaveCoordinator({ now: options.clock?.now, autoSaveMinutes: options.settings?.autoSaveMinutes });
    this.performance = new PerformanceLab({
      now: options.clock?.now,
      capacity: options.telemetryCapacity,
      budget: sanitizeBudget(options.budget),
    });
    this.budget = sanitizeBudget(options.budget);
    this.#settings = sanitizeSettings(options.settings);
    this.#runtimeVersion = runtime.runtimeVersion;
    this.#scene = options.scene;
    this.#telemetryCapacity = Math.max(120, Math.trunc(options.telemetryCapacity ?? 3600));
    this.events = new LocalSessionBus();
    this.saves.configure(() => this.#buildSavePayload(), this.#settings, {
      onDirty: (dirty) => { this.#dirty = dirty; },
    });
  }

  get status(): RuntimeSessionStatus {
    return Object.freeze({
      running: this.#running,
      frame: this.#frame as FrameId,
      startedAt: this.#startedAt,
      playtimeMs: this.#playtimeMs,
      lastSaveAt: this.#lastSaveAt,
      dirty: this.#dirty,
      replayRecording: this.#replayRecording,
      quality: this.kernel.quality.tier,
    });
  }

  get settings(): SessionSettings {
    return this.#settings;
  }

  start(): void {
    this.#assertLive();
    if (this.#running) return;
    const now = this.#now();
    this.#startedAt = now;
    this.#lastTimestamp = now;
    this.#running = true;
    this.kernel.start();
    this.events.emit('session:started', { at: now });
  }

  async stop(save = true): Promise<void> {
    this.#assertLive();
    if (!this.#running) return;
    if (save && this.#dirty) await this.requestSave('shutdown');
    const now = this.#now();
    this.#running = false;
    this.kernel.stop();
    this.#finalizePlaytime(now);
    this.events.emit('session:stopped', { at: now, playtimeMs: this.#playtimeMs });
    this.#lastTimestamp = now;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#running = false;
    this.kernel.stop();
    this.inputs.clear();
    this.#scene = undefined;
  }

  updateSettings(settings: Partial<SessionSettings>): SessionSettings {
    this.#settings = sanitizeSettings({ ...this.#settings, ...settings });
    this.#dirty = true;
    this.saves.markDirty('settings-changed');
    return this.#settings;
  }

  handleAction(event: Omit<InputActionEvent, 'timestamp' | 'frame'> & Partial<Pick<InputActionEvent, 'timestamp' | 'frame'>>): InputActionEvent {
    this.#assertLive();
    const normalized: InputActionEvent = Object.freeze({
      ...event,
      timestamp: event.timestamp ?? this.#now(),
      frame: event.frame ?? (this.#frame as FrameId),
      value: clampFinite(event.value, -1, 1, 0),
      repeat: Boolean(event.repeat),
    });
    const captured = Object.freeze(normalized);
    if (captured.phase === 'value') this.inputs.handleAxis(captured.action, captured.value, captured.source, captured.frame);
    else this.inputs.handleDigital(captured.action, captured.phase === 'pressed', captured.source, captured.repeat);
    this.recorder.capture(captured);
    this.events.emit('input:action', captured);
    this.#dirty = true;
    return captured;
  }

  startReplayRecording(): void {
    if (this.#replayRecording) return;
    this.recorder.start(this.#frame as FrameId);
    this.#replayRecording = true;
    this.events.emit('input:replay-started', { frame: this.#frame as FrameId });
  }

  stopReplayRecording(): ReplayRecording | null {
    if (!this.#replayRecording) return null;
    const recording = this.recorder.stop();
    this.#replayRecording = false;
    this.events.emit('input:replay-stopped', { frames: recording?.frames.length ?? 0 });
    return recording;
  }

  loadReplay(recording: ReplayRecording): boolean {
    return this.player.load(recording);
  }

  playReplay(): boolean {
    const result = this.player.play();
    if (result) this.events.emit('input:replay-started', { frame: this.#frame as FrameId });
    return result;
  }

  pauseReplay(): void {
    this.player.pause();
  }

  async tick(deltaMs = 1000 / 60): Promise<SessionTickResult> {
    this.#assertLive();
    if (!this.#running) this.start();
    const start = this.#now();
    const clampedDeltaMs = Math.max(0, Math.min(250, Number.isFinite(deltaMs) ? deltaMs : 1000 / 60));
    this.#frame += 1;
    this.#playtimeMs += clampedDeltaMs;
    const frameId = this.#frame as FrameId;
    this.inputs.beginFrame(frameId);
    this.performance.beginFrame();
    this.player.tick(frameId);

    const playerState = this.#scene?.capturePlayer?.() ?? DEFAULT_PLAYER;
    const cameraState = this.#scene?.captureCamera?.() ?? DEFAULT_CAMERA;
    const worldState = this.#scene?.captureWorld?.() ?? DEFAULT_WORLD;
    const camera = asCameraState(cameraState, this.#scene);
    const render = this.#scene?.getRenderMetrics?.() ?? { drawCalls: 0, triangles: 0, visibleObjects: 0, textureBytes: 0 };
    const kernelInput: KernelFrameInput = {
      frameMs: clampedDeltaMs,
      cpuMs: Math.max(0, Number(this.performance.clockDrift(clampedDeltaMs))),
      gpuMs: render.gpuMs,
      drawCalls: render.drawCalls,
      triangles: render.triangles,
      visibleObjects: render.visibleObjects,
      textureBytes: render.textureBytes,
      memoryPressure: render.memoryPressure,
      thermalPressure: render.thermalPressure,
      camera,
    };
    const runtime = await this.kernel.tick(kernelInput);
    const saveStart = this.#now();
    await this.saves.tick();
    const saveMs = Math.max(0, Number(this.#now()) - Number(saveStart));
    const inputMs = Math.max(0, Number(start) - Number(start));
    const presentationStart = this.#now();
    const snapshot = this.#makeSnapshot(frameId, clampedDeltaMs, playerState, cameraState, worldState, runtime.context);
    await Promise.resolve(this.#scene?.applySnapshot?.(snapshot));
    const presentationMs = Math.max(0, Number(this.#now()) - Number(presentationStart));
    const frameMs = Math.max(clampedDeltaMs, Number(this.#now()) - Number(start));
    const metrics: RuntimeFrameMetrics = {
      frameMs,
      simulationMs: Math.max(0, runtime.context.deltaSeconds * 1000),
      presentationMs,
      inputMs,
      saveMs,
      entityCount: snapshot.runtime.entities.length,
      streamedCells: snapshot.world.loadedCells.length,
      pressure: runtime.context.pressure.combined,
      memoryBytes: render.textureBytes,
    };
    this.performance.endFrame(frameId, metrics);
    this.#recordTelemetry({ frame: frameId, timestamp: this.#now(), ...metrics });
    this.#lastSnapshot = snapshot;
    this.events.emit('session:frame', { state: snapshot });
    this.saves.markDirty('frame-state');
    if (this.recorder.recording) this.recorder.commitFrame(frameId);
    return Object.freeze({ runtime, snapshot, input: this.inputs.snapshot(), metrics });
  }

  async requestSave(reason = 'manual', slot?: number): Promise<boolean> {
    this.#assertLive();
    const chosen = slot ?? this.saves.status.activeSlot;
    this.events.emit('session:save-requested', { slot: chosen, reason });
    const result = await this.saves.requestSave(reason, chosen);
    if (result.ok) {
      this.#lastSaveAt = this.#now();
      this.events.emit('session:saved', { slot: chosen, checksum: this.#lastSnapshot?.digest ?? '' });
      return true;
    }
    this.events.emit('session:save-failed', { slot: chosen, error: result.error });
    return false;
  }

  async loadSave(slot = this.saves.status.activeSlot): Promise<boolean> {
    this.#assertLive();
    const result = await this.saves.load(slot);
    if (!result.ok || !result.value) return false;
    this.#settings = sanitizeSettings(result.value.settings);
    this.#lastSnapshot = result.value.snapshot;
    await this.#scene?.applySnapshot?.(result.value.snapshot);
    this.#dirty = false;
    return true;
  }

  async autosave(): Promise<boolean> {
    return (await this.saves.requestAutoSave()) !== null;
  }

  snapshot(): SessionSnapshot | null {
    return this.#lastSnapshot;
  }

  telemetrySummary(): ReturnType<typeof summarizeTelemetry> {
    return summarizeTelemetry(this.#telemetry);
  }

  diagnostics(): RuntimeSessionDiagnostics {
    const performance = this.performance.summary();
    return Object.freeze({
      status: this.status,
      settings: this.#settings,
      budget: this.budget,
      save: this.saves.diagnostics(),
      performance: Object.freeze({ ...performance, budgetCounts: this.performance.budgetCounts() }),
      telemetry: this.telemetrySummary() as unknown as Readonly<Record<string, number>>,
      lastSnapshot: this.#lastSnapshot,
    });
  }

  #makeSnapshot(frame: FrameId, deltaSeconds: number, player: PlayerFrameState, camera: CameraFrameState, world: WorldFrameState, context: FrameExecutionContext): SessionSnapshot {
    const state: SessionFrameState = makeFrameState({
      frame,
      timestamp: this.#now(),
      deltaSeconds,
      quality: context.quality,
      player: clonePlayer(player),
      camera: cloneCamera(camera),
      world: cloneWorld(world),
    });
    const runtime = this.kernel.createSnapshot();
    const digest = checksum({
      frame: state.frame,
      timestamp: state.timestamp,
      player: state.player,
      camera: state.camera,
      world: state.world,
      runtime,
    });
    return Object.freeze({
      ...state,
      schema: 'aapw.session',
      schemaVersion: 4,
      digest,
      playtimeMs: this.#playtimeMs,
      totalFrames: this.#frame,
      runtime,
    });
  }

  #buildSavePayload(): SessionSavePayload {
    const snapshot = this.#lastSnapshot ?? this.#makeSnapshot(this.#frame as FrameId, 0, this.#scene?.capturePlayer?.() ?? DEFAULT_PLAYER, this.#scene?.captureCamera?.() ?? DEFAULT_CAMERA, this.#scene?.captureWorld?.() ?? DEFAULT_WORLD, {
      frame: this.#frame as FrameId,
      deltaSeconds: 0,
      absoluteSeconds: this.#playtimeMs / 1000,
      camera: asCameraState(this.#scene?.captureCamera?.() ?? DEFAULT_CAMERA, this.#scene),
      quality: this.kernel.quality.tier,
      pressure: { cpu: 0, gpu: 0, frame: 0, memory: 0, thermal: 0, combined: 0 },
    });
    return Object.freeze({
      settings: this.#settings,
      snapshot,
      replay: this.#replayRecording ? this.recorder.stop() ?? undefined : undefined,
      metadata: Object.freeze({
        runtimeVersion: this.#runtimeVersion,
        seed: this.kernel.seed,
        frames: this.#frame,
        playtimeMs: this.#playtimeMs,
      }),
    });
  }

  #recordTelemetry(point: SessionTelemetryPoint): void {
    this.#telemetry.push(Object.freeze({ ...point }));
    while (this.#telemetry.length > this.#telemetryCapacity) this.#telemetry.shift();
  }

  #finalizePlaytime(now: UnixMillis): void {
    if (this.#lastTimestamp === null) return;
    this.#playtimeMs += Math.max(0, Number(now) - Number(this.#lastTimestamp));
  }

  #now(): UnixMillis {
    return (this.#lastTimestamp === null ? Date.now() : Date.now()) as UnixMillis;
  }

  #assertLive(): void {
    if (this.#destroyed) throw new Error('RuntimeSession has been destroyed');
  }
}

export function createRuntimeSession(options: RuntimeSessionOptionsExtended = {}): RuntimeSession {
  return new RuntimeSession(options);
}
