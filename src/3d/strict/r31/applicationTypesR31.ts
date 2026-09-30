/**
 * R31 — strict application/runtime contracts.
 * The module is intentionally framework-neutral so browser, renderer, worker, network and
 * persistence implementations can evolve independently without widening the legacy surface.
 */
export type R31Id = string & { readonly __r31Id: unique symbol };
export type RuntimeStatus = 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed';
export type RuntimePhase =
  | 'bootstrap'
  | 'input'
  | 'simulation'
  | 'world'
  | 'gameplay'
  | 'render'
  | 'audio'
  | 'network'
  | 'persistence'
  | 'diagnostics'
  | 'teardown';
export type RuntimePriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type RuntimeCommandKind =
  | 'input'
  | 'simulation'
  | 'world'
  | 'gameplay'
  | 'render'
  | 'audio'
  | 'network'
  | 'persistence'
  | 'diagnostic'
  | 'lifecycle';

export interface Vec2R31 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3R31 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RuntimeBudgetR31 {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly persistenceMs: number;
  readonly maxCommandsPerFrame: number;
  readonly maxEventsPerFrame: number;
}

export interface RuntimeFrameR31 {
  readonly frame: number;
  readonly simulationTick: number;
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly alpha: number;
  readonly phase: RuntimePhase;
}

export interface RuntimeCommandContextR31 {
  readonly frame: number;
  readonly simulationTick: number;
  readonly source: string;
  readonly acceptedAt: number;
}

export interface RuntimeCommandR31<TPayload = unknown> {
  readonly id: R31Id;
  readonly kind: RuntimeCommandKind;
  readonly name: string;
  readonly priority: RuntimePriority;
  readonly payload: TPayload;
  readonly context: RuntimeCommandContextR31;
}

export interface RuntimeCommandResultR31 {
  readonly accepted: boolean;
  readonly executed: boolean;
  readonly commandId: R31Id;
  readonly reason?: string;
  readonly durationMs: number;
}

export interface RuntimeEventR31<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
  readonly tick: number;
  readonly sequence: number;
}

export interface RuntimeSubscriptionR31 {
  readonly id: number;
  readonly dispose: () => void;
}

export interface RuntimeTaskR31 {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly priority: RuntimePriority;
  readonly enabled: boolean;
  readonly maxWorkMs: number;
  readonly update: (frame: RuntimeFrameR31) => void;
}

export interface RuntimeTaskResultR31 {
  readonly id: string;
  readonly durationMs: number;
  readonly budgetExceeded: boolean;
}

export interface RuntimeResourceDescriptorR31 {
  readonly id: string;
  readonly kind: string;
  readonly weight: number;
  readonly critical: boolean;
  readonly estimatedBytes: number;
  readonly tags: readonly string[];
}

export interface RuntimeResourceR31<T = unknown> {
  readonly descriptor: RuntimeResourceDescriptorR31;
  readonly value: T;
  readonly release: () => void;
}

export interface RuntimeSnapshotEnvelopeR31<TState = unknown> {
  readonly version: 31;
  readonly schema: string;
  readonly tick: number;
  readonly createdAt: number;
  readonly digest: string;
  readonly state: TState;
}

export interface RuntimeSnapshotMetaR31 {
  readonly version: 31;
  readonly schema: string;
  readonly tick: number;
  readonly digest: string;
  readonly byteLength: number;
}

export interface RuntimeHealthSampleR31 {
  readonly timestampMs: number;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly memoryBytes: number | null;
  readonly droppedCommands: number;
  readonly droppedEvents: number;
  readonly errors: number;
}

export interface RuntimeHealthReportR31 {
  readonly healthy: boolean;
  readonly score: number;
  readonly samples: number;
  readonly p95FrameMs: number;
  readonly maxFrameMs: number;
  readonly totalErrors: number;
  readonly recommendations: readonly string[];
}

export interface RuntimeLifecycleStateR31 {
  readonly status: RuntimeStatus;
  readonly generation: number;
  readonly reason: string | null;
}

export interface RuntimeKernelPortsR31 {
  readonly nowMs: () => number;
  readonly onError?: (error: unknown, context: string) => void;
}

export interface BrowserInputPortR31 {
  readonly start: () => void;
  readonly stop: () => void;
}

export interface RenderPortR31 {
  readonly beginFrame: (frame: RuntimeFrameR31) => void;
  readonly draw: () => void;
  readonly endFrame: () => void;
  readonly resize: (width: number, height: number, pixelRatio: number) => void;
  readonly dispose: () => void;
}

export interface NetworkPortR31 {
  readonly connected: () => boolean;
  readonly send: (bytes: Uint8Array) => void;
  readonly receive: (bytes: Uint8Array) => void;
  readonly close: () => void;
}

export interface PersistencePortR31 {
  readonly write: (key: string, value: Uint8Array) => Promise<void>;
  readonly read: (key: string) => Promise<Uint8Array | null>;
  readonly remove: (key: string) => Promise<void>;
}

export interface RuntimePluginR31 {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly priority: RuntimePriority;
  readonly start?: () => void | Promise<void>;
  readonly update?: (frame: RuntimeFrameR31) => void;
  readonly pause?: () => void;
  readonly resume?: () => void;
  readonly stop?: () => void | Promise<void>;
}

export const R31_RUNTIME_SCHEMA = 'aapw.runtime.r31';
export const R31_DEFAULT_BUDGET: RuntimeBudgetR31 = Object.freeze({
  frameMs: 16.67,
  simulationMs: 6,
  renderMs: 7,
  networkMs: 1.5,
  persistenceMs: 0.5,
  maxCommandsPerFrame: 256,
  maxEventsPerFrame: 512,
});

export function asR31Id(value: string): R31Id {
  const normalized = value.trim();
  if (!normalized) throw new Error('R31 id cannot be empty');
  if (normalized.length > 128) throw new Error('R31 id exceeds 128 characters');
  return normalized as R31Id;
}

export function finiteR31(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampR31(value: number, min: number, max: number): number {
  if (min > max) throw new Error('Invalid clamp interval');
  return Math.min(max, Math.max(min, finiteR31(value, min)));
}
