import type { RenderBackend, QualityTier, TaskAffinity, TaskPriority } from './types';

export interface RuntimeBudgets {
  readonly frameTargetMs: number;
  readonly simulationMs: number;
  readonly renderingMs: number;
  readonly streamingMs: number;
  readonly animationMs: number;
  readonly maxTasksPerFrame: number;
}

export interface RuntimeLimits {
  readonly maxEntities: number;
  readonly maxDrawItems: number;
  readonly maxStreamLoadsPerFrame: number;
  readonly maxStreamUnloadsPerFrame: number;
  readonly maxResourceBytes: number;
  readonly maxTelemetrySamples: number;
  readonly maxReplayActions: number;
  readonly maxDiagnostics: number;
}

export interface RuntimeFeatureFlags {
  readonly modernScheduler: boolean;
  readonly typedInput: boolean;
  readonly adaptiveQuality: boolean;
  readonly resourceRegistry: boolean;
  readonly frameGraph: boolean;
  readonly workerBridge: boolean;
  readonly ecs: boolean;
  readonly persistence: boolean;
  readonly replay: boolean;
  readonly diagnostics: boolean;
  readonly networkSnapshots: boolean;
}

export interface RuntimeProfile {
  readonly name: 'desktop' | 'mobile' | 'low-end' | 'headless';
  readonly preferredBackend: RenderBackend;
  readonly defaultQuality: QualityTier;
  readonly budgets: RuntimeBudgets;
  readonly limits: RuntimeLimits;
  readonly features: RuntimeFeatureFlags;
}

const BASE_FEATURES: RuntimeFeatureFlags = Object.freeze({
  modernScheduler: true,
  typedInput: true,
  adaptiveQuality: true,
  resourceRegistry: true,
  frameGraph: true,
  workerBridge: true,
  ecs: true,
  persistence: true,
  replay: true,
  diagnostics: true,
  networkSnapshots: true,
});

export const RUNTIME_PROFILES: Readonly<Record<RuntimeProfile['name'], RuntimeProfile>> = Object.freeze({
  desktop: Object.freeze({
    name: 'desktop', preferredBackend: 'webgpu', defaultQuality: 'high',
    budgets: { frameTargetMs: 16.6667, simulationMs: 4.8, renderingMs: 7.2, streamingMs: 2.8, animationMs: 1.8, maxTasksPerFrame: 48 },
    limits: { maxEntities: 50000, maxDrawItems: 20000, maxStreamLoadsPerFrame: 8, maxStreamUnloadsPerFrame: 6, maxResourceBytes: 768 * 1024 * 1024, maxTelemetrySamples: 720, maxReplayActions: 100000, maxDiagnostics: 2048 },
    features: BASE_FEATURES,
  }),
  mobile: Object.freeze({
    name: 'mobile', preferredBackend: 'webgl2', defaultQuality: 'balanced',
    budgets: { frameTargetMs: 16.6667, simulationMs: 3.8, renderingMs: 6.2, streamingMs: 1.6, animationMs: 1.2, maxTasksPerFrame: 28 },
    limits: { maxEntities: 15000, maxDrawItems: 7500, maxStreamLoadsPerFrame: 3, maxStreamUnloadsPerFrame: 3, maxResourceBytes: 256 * 1024 * 1024, maxTelemetrySamples: 360, maxReplayActions: 25000, maxDiagnostics: 768 },
    features: { ...BASE_FEATURES, networkSnapshots: false },
  }),
  'low-end': Object.freeze({
    name: 'low-end', preferredBackend: 'webgl2', defaultQuality: 'minimal',
    budgets: { frameTargetMs: 20, simulationMs: 3.2, renderingMs: 5.2, streamingMs: 1.2, animationMs: 0.9, maxTasksPerFrame: 18 },
    limits: { maxEntities: 6000, maxDrawItems: 3000, maxStreamLoadsPerFrame: 2, maxStreamUnloadsPerFrame: 2, maxResourceBytes: 128 * 1024 * 1024, maxTelemetrySamples: 240, maxReplayActions: 10000, maxDiagnostics: 512 },
    features: { ...BASE_FEATURES, frameGraph: false, workerBridge: false, networkSnapshots: false },
  }),
  headless: Object.freeze({
    name: 'headless', preferredBackend: 'headless', defaultQuality: 'minimal',
    budgets: { frameTargetMs: 16.6667, simulationMs: 8, renderingMs: 0, streamingMs: 4, animationMs: 2, maxTasksPerFrame: 96 },
    limits: { maxEntities: 100000, maxDrawItems: 1, maxStreamLoadsPerFrame: 64, maxStreamUnloadsPerFrame: 64, maxResourceBytes: 32 * 1024 * 1024, maxTelemetrySamples: 1000, maxReplayActions: 250000, maxDiagnostics: 4096 },
    features: BASE_FEATURES,
  }),
});

export interface RuntimeEnvironmentHint {
  readonly coarsePointer?: boolean;
  readonly hardwareConcurrency?: number;
  readonly deviceMemoryGb?: number;
  readonly saveData?: boolean;
  readonly preferredBackend?: RenderBackend;
}

export function selectRuntimeProfile(hint: RuntimeEnvironmentHint = {}): RuntimeProfile {
  if (hint.preferredBackend === 'headless') return RUNTIME_PROFILES.headless;
  const cores = hint.hardwareConcurrency ?? 8;
  const memory = hint.deviceMemoryGb ?? 8;
  if (hint.coarsePointer || hint.saveData || cores <= 4 || memory <= 4) {
    return cores <= 2 || memory <= 2 ? RUNTIME_PROFILES['low-end'] : RUNTIME_PROFILES.mobile;
  }
  return RUNTIME_PROFILES.desktop;
}

export function mergeRuntimeLimits(base: RuntimeLimits, override: Partial<RuntimeLimits>): RuntimeLimits {
  const merged = { ...base, ...override };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid runtime limit ${key}`);
  }
  return Object.freeze(merged);
}

export function priorityForSubsystem(subsystem: TaskAffinity): TaskPriority {
  switch (subsystem) {
    case 'input': return 4;
    case 'simulation': return 3;
    case 'render': return 3;
    case 'animation': return 2;
    case 'streaming': return 1;
    case 'persistence': return 1;
    case 'any': return 0;
  }
}
