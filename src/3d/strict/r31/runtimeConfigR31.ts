import type { RuntimeBudgetR31 } from './applicationTypesR31.ts';
import { R31_DEFAULT_BUDGET, clampR31 } from './applicationTypesR31.ts';

export interface RuntimeQualityConfigR31 {
  readonly renderScale: number;
  readonly lodBias: number;
  readonly shadowDistance: number;
  readonly maxVisibleEntities: number;
  readonly particleBudget: number;
}

export interface RuntimeConfigR31 {
  readonly version: 31;
  readonly worldSeed: number;
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly budget: RuntimeBudgetR31;
  readonly quality: RuntimeQualityConfigR31;
  readonly networkEnabled: boolean;
  readonly persistenceEnabled: boolean;
  readonly diagnosticsEnabled: boolean;
}

export const DEFAULT_RUNTIME_QUALITY_R31: RuntimeQualityConfigR31 = Object.freeze({
  renderScale: 1,
  lodBias: 0,
  shadowDistance: 1200,
  maxVisibleEntities: 1200,
  particleBudget: 2500,
});

export const DEFAULT_RUNTIME_CONFIG_R31: RuntimeConfigR31 = Object.freeze({
  version: 31,
  worldSeed: 31_091_530,
  fixedStepSeconds: 1 / 60,
  maxCatchUpSteps: 8,
  budget: R31_DEFAULT_BUDGET,
  quality: DEFAULT_RUNTIME_QUALITY_R31,
  networkEnabled: true,
  persistenceEnabled: true,
  diagnosticsEnabled: true,
});

export function normalizeRuntimeConfigR31(input: Partial<RuntimeConfigR31>): RuntimeConfigR31 {
  const quality = (input.quality ?? {}) as Partial<RuntimeQualityConfigR31>;
  const sourceBudget = (input.budget ?? {}) as Partial<RuntimeBudgetR31>;
  return Object.freeze({
    version: 31,
    worldSeed: Number.isFinite(input.worldSeed) ? Math.trunc(input.worldSeed as number) : DEFAULT_RUNTIME_CONFIG_R31.worldSeed,
    fixedStepSeconds: clampR31(input.fixedStepSeconds ?? DEFAULT_RUNTIME_CONFIG_R31.fixedStepSeconds, 1 / 240, 0.25),
    maxCatchUpSteps: Math.max(1, Math.min(32, Math.floor(input.maxCatchUpSteps ?? DEFAULT_RUNTIME_CONFIG_R31.maxCatchUpSteps))),
    budget: Object.freeze({
      ...R31_DEFAULT_BUDGET,
      ...sourceBudget,
      frameMs: clampR31(sourceBudget.frameMs ?? R31_DEFAULT_BUDGET.frameMs, 1, 1000),
      simulationMs: clampR31(sourceBudget.simulationMs ?? R31_DEFAULT_BUDGET.simulationMs, 0.1, 500),
      renderMs: clampR31(sourceBudget.renderMs ?? R31_DEFAULT_BUDGET.renderMs, 0.1, 500),
      networkMs: clampR31(sourceBudget.networkMs ?? R31_DEFAULT_BUDGET.networkMs, 0.1, 100),
      persistenceMs: clampR31(sourceBudget.persistenceMs ?? R31_DEFAULT_BUDGET.persistenceMs, 0.1, 100),
      maxCommandsPerFrame: Math.max(1, Math.min(4096, Math.floor(sourceBudget.maxCommandsPerFrame ?? R31_DEFAULT_BUDGET.maxCommandsPerFrame))),
      maxEventsPerFrame: Math.max(1, Math.min(8192, Math.floor(sourceBudget.maxEventsPerFrame ?? R31_DEFAULT_BUDGET.maxEventsPerFrame))),
    }),
    quality: Object.freeze({
      renderScale: clampR31(quality.renderScale ?? DEFAULT_RUNTIME_QUALITY_R31.renderScale, 0.5, 1.5),
      lodBias: clampR31(quality.lodBias ?? DEFAULT_RUNTIME_QUALITY_R31.lodBias, -2, 3),
      shadowDistance: clampR31(quality.shadowDistance ?? DEFAULT_RUNTIME_QUALITY_R31.shadowDistance, 50, 5000),
      maxVisibleEntities: Math.max(32, Math.min(10000, Math.floor(quality.maxVisibleEntities ?? DEFAULT_RUNTIME_QUALITY_R31.maxVisibleEntities))),
      particleBudget: Math.max(0, Math.min(50000, Math.floor(quality.particleBudget ?? DEFAULT_RUNTIME_QUALITY_R31.particleBudget))),
    }),
    networkEnabled: input.networkEnabled ?? DEFAULT_RUNTIME_CONFIG_R31.networkEnabled,
    persistenceEnabled: input.persistenceEnabled ?? DEFAULT_RUNTIME_CONFIG_R31.persistenceEnabled,
    diagnosticsEnabled: input.diagnosticsEnabled ?? DEFAULT_RUNTIME_CONFIG_R31.diagnosticsEnabled,
  });
}

export function validateRuntimeConfigR31(config: RuntimeConfigR31): readonly string[] {
  const errors: string[] = [];
  if (config.version !== 31) errors.push('version-mismatch');
  if (!Number.isFinite(config.worldSeed)) errors.push('invalid-world-seed');
  if (!(config.fixedStepSeconds > 0)) errors.push('invalid-fixed-step');
  if (config.maxCatchUpSteps < 1) errors.push('invalid-catch-up');
  if (config.quality.maxVisibleEntities < 32) errors.push('visible-entity-budget-too-small');
  if (config.budget.frameMs < config.budget.simulationMs) errors.push('simulation-budget-exceeds-frame-budget');
  return Object.freeze(errors);
}
