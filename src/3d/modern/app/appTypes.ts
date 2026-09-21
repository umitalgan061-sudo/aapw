/**
 * Application-layer contracts for the modern runtime.
 *
 * The contract is renderer-agnostic so it can be exercised in browsers, workers,
 * deterministic replay, automated tests, and future native shells.
 */

export type AppPhase = 'created' | 'booting' | 'ready' | 'running' | 'paused' | 'recovering' | 'stopping' | 'stopped' | 'failed';
export type AppPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type AppSubsystem = 'input' | 'simulation' | 'render' | 'streaming' | 'network' | 'audio' | 'save' | 'telemetry' | 'accessibility' | 'security';
export type AppCommandSource = 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'system' | 'network' | 'ui';
export type DiagnosticSeverity = 'info' | 'warning' | 'critical';

export interface AppClock {
  readonly nowMs: number;
  readonly realNowMs: number;
  readonly frame: number;
  readonly simulationTick: number;
  readonly deltaMs: number;
  readonly realDeltaMs: number;
  readonly paused: boolean;
}

export interface AppBudget {
  readonly cpuMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly memoryMb: number;
  readonly entities: number;
  readonly commands: number;
}

export interface AppCapabilities {
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly offscreenCanvas: boolean;
  readonly gamepad: boolean;
  readonly touch: boolean;
  readonly reducedMotion: boolean;
  readonly saveStorage: boolean;
}

export interface AppFeatureConfig {
  readonly id: string;
  readonly enabled: boolean;
  readonly priority: AppPriority;
  readonly rollout: number;
  readonly tags: readonly string[];
}

export interface AppDiagnosticEvent {
  readonly code: string;
  readonly subsystem: AppSubsystem;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly frame: number;
  readonly tick: number;
  readonly value?: number;
  readonly limit?: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AppCommand<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly source: AppCommandSource;
  readonly issuedAtMs: number;
  readonly sequence: number;
  readonly consumed: boolean;
}

export interface AppInputState {
  readonly axes: Readonly<Record<string, number>>;
  readonly buttons: Readonly<Record<string, boolean>>;
  readonly pointer: Readonly<{ x: number; y: number; dx: number; dy: number; locked: boolean }>;
  readonly actions: Readonly<Record<string, { pressed: boolean; justPressed: boolean; justReleased: boolean; value: number; repeatCount: number }>>;
}

export interface AppFrameContext {
  readonly clock: AppClock;
  readonly budget: AppBudget;
  readonly input: AppInputState;
  readonly capabilities: AppCapabilities;
  readonly features: readonly AppFeatureConfig[];
  readonly commandBus: AppCommandBus;
  readonly report: (event: AppDiagnosticEvent) => void;
}

export interface AppSubsystemStats {
  readonly id: string;
  readonly subsystem: AppSubsystem;
  readonly elapsedMs: number;
  readonly invocations: number;
  readonly skipped: number;
  readonly overBudget: number;
  readonly lastError?: string;
}

export interface AppFrameReport {
  readonly frame: number;
  readonly tick: number;
  readonly phase: AppPhase;
  readonly elapsedMs: number;
  readonly subsystems: readonly AppSubsystemStats[];
  readonly diagnostics: readonly AppDiagnosticEvent[];
  readonly droppedCommands: number;
  readonly overBudget: boolean;
  readonly simulationSteps: number;
  readonly simulationDebtMs: number;
}

export interface AppLifecycleSnapshot {
  readonly phase: AppPhase;
  readonly revision: number;
  readonly uptimeMs: number;
  readonly transitions: number;
  readonly recoveries: number;
  readonly lastError?: string;
}

export interface AppServiceContext {
  readonly clock: AppClock;
  readonly capabilities: AppCapabilities;
  readonly report: (event: AppDiagnosticEvent) => void;
}

export interface AppUpdateContext extends AppServiceContext {
  readonly budget: AppBudget;
  readonly consumeBudget: (cpuMs: number) => boolean;
  readonly commandBus: AppCommandBus;
}

export interface AppService {
  readonly id: string;
  readonly subsystem: AppSubsystem;
  readonly priority: AppPriority;
  readonly dependencies: readonly string[];
  start(context: AppServiceContext): void | Promise<void>;
  update(context: AppUpdateContext): void;
  stop(context: AppServiceContext): void | Promise<void>;
}

export interface AppCommandBus {
  dispatch<T>(command: Omit<AppCommand<T>, 'sequence' | 'consumed'>): AppCommand<T>;
  consume(type?: string): AppCommand | undefined;
  drain(max?: number): readonly AppCommand[];
  peek(): readonly AppCommand[];
  pendingCount(): number;
  clear(): void;
}

export interface AppFramePolicy {
  readonly maxDeltaMs: number;
  readonly targetFrameMs: number;
  readonly fixedStepMs: number;
  readonly maxCatchUpSteps: number;
  readonly maxCommandsPerFrame: number;
  readonly maxFrameDebtMs: number;
  readonly backgroundHz: number;
}

export const DEFAULT_APP_FRAME_POLICY: AppFramePolicy = Object.freeze({
  maxDeltaMs: 100,
  targetFrameMs: 16.67,
  fixedStepMs: 16.6667,
  maxCatchUpSteps: 5,
  maxCommandsPerFrame: 256,
  maxFrameDebtMs: 250,
  backgroundHz: 5,
});

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> =>
  Object.freeze({ ...value });

export const stableKey = (...parts: readonly unknown[]): string =>
  parts.map((part) => String(part ?? '')).join('|');

export const monotonicMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const makeDiagnostic = (
  input: Omit<AppDiagnosticEvent, 'metadata'> & { metadata?: Readonly<Record<string, string | number | boolean>> },
): AppDiagnosticEvent => Object.freeze({
  ...input,
  ...(input.metadata ? { metadata: Object.freeze({ ...input.metadata }) } : {}),
});

export const emptyInputState = (): AppInputState => Object.freeze({
  axes: Object.freeze({}),
  buttons: Object.freeze({}),
  pointer: Object.freeze({ x: 0, y: 0, dx: 0, dy: 0, locked: false }),
  actions: Object.freeze({}),
});
