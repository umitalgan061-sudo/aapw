/** Strict TypeScript production render-health supervisor. */

import {
  evaluateGpuPressure,
  pressureRecommendations,
  type GpuPressureInput,
  type GpuPressureResult,
  type PressureRecommendation,
} from './gpuPressureModel.ts';
import {
  createDynamicResolutionGovernor,
  type DynamicResolutionGovernor,
  type DynamicResolutionInput,
  type DynamicResolutionSnapshot,
} from './dynamicResolutionGovernor.ts';
import {
  createRenderPassBudgetPlanner,
  type RenderPassBudgetPlan,
  type RenderPassBudgetPlanner,
  type RenderPassDescriptor,
} from './renderPassBudgetPlanner.ts';

export interface RenderHealthEvaluationInput extends GpuPressureInput, DynamicResolutionInput {
  readonly passDescriptors?: readonly RenderPassDescriptor[];
  readonly passBudgetMs?: number;
  readonly emergencyPassBudget?: boolean;
}

export interface RenderHealthEvaluation {
  readonly version: 1;
  readonly pressure: GpuPressureResult;
  readonly recommendations: readonly PressureRecommendation[];
  readonly resolution: DynamicResolutionSnapshot;
  readonly passBudget: RenderPassBudgetPlan;
  readonly overallAction: 'retain' | 'adapt' | 'shed';
}

export interface RenderHealthSupervisor {
  readonly evaluate: (input?: RenderHealthEvaluationInput) => RenderHealthEvaluation;
  readonly snapshot: () => RenderHealthEvaluation;
  readonly reset: () => void;
  readonly governor: DynamicResolutionGovernor;
  readonly passPlanner: RenderPassBudgetPlanner;
}

function actionFor(
  pressure: GpuPressureResult,
  resolution: DynamicResolutionSnapshot,
  passBudget: RenderPassBudgetPlan,
): RenderHealthEvaluation['overallAction'] {
  if (pressure.state === 'critical' || resolution.tier === 'survival' || passBudget.utilization > 0.98) {
    return 'shed';
  }
  if (pressure.state === 'warning' || resolution.direction === 'down' || passBudget.utilization > 0.82) {
    return 'adapt';
  }
  return 'retain';
}

export function createRenderHealthSupervisor(): RenderHealthSupervisor {
  const governor = createDynamicResolutionGovernor();
  const passPlanner = createRenderPassBudgetPlanner();
  let latest: RenderHealthEvaluation = Object.freeze({
    version: 1,
    pressure: evaluateGpuPressure(),
    recommendations: pressureRecommendations(evaluateGpuPressure()),
    resolution: governor.snapshot(),
    passBudget: passPlanner.plan(),
    overallAction: 'retain',
  });

  const evaluate = (input: RenderHealthEvaluationInput = {}): RenderHealthEvaluation => {
    const pressure = evaluateGpuPressure(input);
    const resolution = governor.update({
      frameMs: input.frameMs,
      thermalPressure: input.thermalPressure,
      visibility: input.visibility,
      saveData: input.saveData,
      reducedMotion: input.reducedMotion,
    });
    const passBudget = passPlanner.plan(input.passDescriptors ?? [], {
      budgetMs: input.passBudgetMs,
      emergency: input.emergencyPassBudget === true || pressure.state === 'critical',
    });
    latest = Object.freeze({
      version: 1,
      pressure,
      recommendations: pressureRecommendations(pressure),
      resolution,
      passBudget,
      overallAction: actionFor(pressure, resolution, passBudget),
    });
    return latest;
  };

  const snapshot = (): RenderHealthEvaluation => latest;

  const reset = (): void => {
    governor.reset();
    latest = Object.freeze({
      version: 1,
      pressure: evaluateGpuPressure(),
      recommendations: pressureRecommendations(evaluateGpuPressure()),
      resolution: governor.snapshot(),
      passBudget: passPlanner.plan(),
      overallAction: 'retain',
    });
  };

  return Object.freeze({ evaluate, snapshot, reset, governor, passPlanner });
}
