import type { CameraState, PlatformError, QualityTier, RenderBackend, Result, RuntimeSnapshot } from './types';
import { checksum, clamp01 } from './deterministic';
import type { RuntimePolicyDecision } from './runtimePolicy';
import type { RuntimeBudgetDecision } from './runtimeBudgetController';
import type { RuntimeLifecycle } from './runtimeLifecycle';

export interface RuntimeGuardLimits {
  readonly maxFrameMs: number;
  readonly maxVisibleObjects: number;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  readonly maxTextureBytes: number;
  readonly maxPressure: number;
  readonly maxCameraFar: number;
}

export interface RuntimeGuardInput {
  readonly frame: number;
  readonly camera: CameraState;
  readonly snapshot?: RuntimeSnapshot;
  readonly quality?: QualityTier;
  readonly backend?: RenderBackend;
  readonly frameMs: number;
  readonly visibleObjects: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureBytes: number;
  readonly pressure?: number;
  readonly policy?: RuntimePolicyDecision;
  readonly budget?: RuntimeBudgetDecision;
}

export interface RuntimeGuardFinding {
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly field: string;
  readonly observed?: number | string;
  readonly limit?: number | string;
}

export interface RuntimeGuardReport {
  readonly accepted: boolean;
  readonly findings: readonly RuntimeGuardFinding[];
  readonly score: number;
  readonly digest: string;
}

export interface RuntimeGuardOptions {
  readonly limits?: Partial<RuntimeGuardLimits>;
  readonly requireMonotonicFrames?: boolean;
}

const DEFAULT_LIMITS: RuntimeGuardLimits = Object.freeze({
  maxFrameMs: 250,
  maxVisibleObjects: 100_000,
  maxDrawCalls: 100_000,
  maxTriangles: 100_000_000,
  maxTextureBytes: 2 * 1024 * 1024 * 1024,
  maxPressure: 1,
  maxCameraFar: 100_000,
});

function finding(
  code: string,
  severity: RuntimeGuardFinding['severity'],
  message: string,
  field: string,
  observed?: number | string,
  limit?: number | string,
): RuntimeGuardFinding {
  return Object.freeze({ code, severity, message, field, observed, limit });
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Runtime invariant gate for frames crossing the modern platform boundary.
 * It catches malformed telemetry, impossible camera values, budget violations and non-monotonic
 * frame ids before they become renderer or simulation state.
 */
export class RuntimeGuard {
  readonly limits: RuntimeGuardLimits;
  readonly requireMonotonicFrames: boolean;
  #lastFrame = -1;

  constructor(options: RuntimeGuardOptions = {}) {
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...options.limits });
    this.requireMonotonicFrames = options.requireMonotonicFrames ?? true;
    this.#validateLimits();
  }

  inspect(input: RuntimeGuardInput): RuntimeGuardReport {
    const findings: RuntimeGuardFinding[] = [];
    const addRange = (field: string, value: number, max: number, code: string, message: string): void => {
      if (!finiteNonNegative(value)) findings.push(finding(`${code}_INVALID`, 'error', `${field} must be a finite non-negative number`, field, value));
      else if (value > max) findings.push(finding(code, 'error', message, field, value, max));
    };

    if (!Number.isSafeInteger(input.frame) || input.frame < 0) {
      findings.push(finding('FRAME_ID_INVALID', 'error', 'Frame id must be a safe non-negative integer', 'frame', input.frame));
    } else if (this.requireMonotonicFrames && input.frame <= this.#lastFrame) {
      findings.push(finding('FRAME_ID_NON_MONOTONIC', 'error', 'Frame id must increase monotonically', 'frame', input.frame, this.#lastFrame + 1));
    } else if (input.frame > this.#lastFrame) {
      this.#lastFrame = input.frame;
    }

    addRange('frameMs', input.frameMs, this.limits.maxFrameMs, 'FRAME_TIME_LIMIT', 'Frame duration exceeded the runtime boundary');
    addRange('visibleObjects', input.visibleObjects, this.limits.maxVisibleObjects, 'VISIBLE_OBJECT_LIMIT', 'Visible object count exceeded the runtime boundary');
    addRange('drawCalls', input.drawCalls, this.limits.maxDrawCalls, 'DRAW_CALL_LIMIT', 'Draw call count exceeded the runtime boundary');
    addRange('triangles', input.triangles, this.limits.maxTriangles, 'TRIANGLE_LIMIT', 'Triangle count exceeded the runtime boundary');
    addRange('textureBytes', input.textureBytes, this.limits.maxTextureBytes, 'TEXTURE_MEMORY_LIMIT', 'Texture residency exceeded the runtime boundary');
    if (input.pressure !== undefined) addRange('pressure', input.pressure, this.limits.maxPressure, 'PRESSURE_LIMIT', 'Pressure value exceeded [0,1]');

    const camera = input.camera;
    if (!camera || !Number.isFinite(camera.fov) || camera.fov <= 0 || camera.fov >= 180) {
      findings.push(finding('CAMERA_FOV_INVALID', 'error', 'Camera FOV must be inside (0,180)', 'camera.fov', camera?.fov));
    }
    if (!finiteNonNegative(camera.near) || camera.near === 0) {
      findings.push(finding('CAMERA_NEAR_INVALID', 'error', 'Camera near plane must be positive', 'camera.near', camera.near));
    }
    if (!finiteNonNegative(camera.far) || camera.far <= camera.near || camera.far > this.limits.maxCameraFar) {
      findings.push(finding('CAMERA_FAR_INVALID', 'error', 'Camera far plane is outside the allowed range', 'camera.far', camera.far, this.limits.maxCameraFar));
    }
    if (camera.viewportWidth < 1 || camera.viewportHeight < 1 || camera.dpr < 0.5 || camera.dpr > 8) {
      findings.push(finding('CAMERA_VIEWPORT_INVALID', 'error', 'Viewport and DPR must remain inside browser-safe bounds', 'camera.viewport'));
    }

    if (input.policy) this.#checkPolicy(input.policy, findings);
    if (input.budget) this.#checkBudget(input.budget, findings);
    if (input.snapshot) this.#checkSnapshot(input.snapshot, input, findings);

    const errors = findings.filter((item) => item.severity === 'error').length;
    const warnings = findings.length - errors;
    const score = clamp01(1 - errors * 0.3 - warnings * 0.07) * 100;
    return Object.freeze({
      accepted: errors === 0,
      findings: Object.freeze(findings),
      score,
      digest: checksum({ frame: input.frame, findings, score }),
    });
  }

  assert(input: RuntimeGuardInput): Result<RuntimeGuardReport> {
    const report = this.inspect(input);
    if (report.accepted) return { ok: true, value: report };
    const first = report.findings.find((item) => item.severity === 'error');
    const error: PlatformError = {
      code: first?.code ?? 'RUNTIME_GUARD_REJECTED',
      message: first?.message ?? 'Runtime frame rejected by invariant guard',
      retryable: false,
      cause: report,
    };
    return { ok: false, error };
  }

  reset(): void {
    this.#lastFrame = -1;
  }

  lifecycleReady(lifecycle: RuntimeLifecycle): boolean {
    return lifecycle.state.phase === 'running';
  }

  diagnosticDigest(): string {
    return checksum({ limits: this.limits, lastFrame: this.#lastFrame });
  }

  #checkPolicy(policy: RuntimePolicyDecision, findings: RuntimeGuardFinding[]): void {
    if (policy.renderScale < 0.5 || policy.renderScale > 1) findings.push(finding('POLICY_SCALE_OUT_OF_RANGE', 'error', 'Runtime policy render scale must remain inside [0.5,1]', 'policy.renderScale', policy.renderScale));
    if (policy.simulationRate <= 0 || policy.simulationRate > 1) findings.push(finding('POLICY_SIMULATION_RATE_INVALID', 'error', 'Simulation rate must remain inside (0,1]', 'policy.simulationRate', policy.simulationRate));
    if (policy.streamingMultiplier <= 0 || policy.streamingMultiplier > 1) findings.push(finding('POLICY_STREAMING_RATE_INVALID', 'error', 'Streaming multiplier must remain inside (0,1]', 'policy.streamingMultiplier', policy.streamingMultiplier));
    if (policy.animationsRate <= 0 || policy.animationsRate > 1) findings.push(finding('POLICY_ANIMATION_RATE_INVALID', 'error', 'Animation rate must remain inside (0,1]', 'policy.animationsRate', policy.animationsRate));
  }

  #checkBudget(budget: RuntimeBudgetDecision, findings: RuntimeGuardFinding[]): void {
    if (budget.scale <= 0 || budget.scale > 1) findings.push(finding('BUDGET_SCALE_INVALID', 'error', 'Budget scale must remain inside (0,1]', 'budget.scale', budget.scale));
    if (budget.budgets.maxTasksPerFrame < 1) findings.push(finding('BUDGET_TASKS_INVALID', 'error', 'At least one task slot must remain available', 'budget.maxTasksPerFrame', budget.budgets.maxTasksPerFrame));
    if (budget.limits.maxEntities < 256) findings.push(finding('BUDGET_ENTITY_LIMIT_TOO_LOW', 'warning', 'Entity cap is below the recommended floor', 'budget.maxEntities', budget.limits.maxEntities, 256));
    if (budget.limits.maxDrawItems < 128) findings.push(finding('BUDGET_DRAW_LIMIT_TOO_LOW', 'warning', 'Draw item cap is below the recommended floor', 'budget.maxDrawItems', budget.limits.maxDrawItems, 128));
  }

  #checkSnapshot(snapshot: RuntimeSnapshot, input: RuntimeGuardInput, findings: RuntimeGuardFinding[]): void {
    if (Number(snapshot.frame) !== input.frame) findings.push(finding('SNAPSHOT_FRAME_MISMATCH', 'error', 'Snapshot frame does not match the integration frame', 'snapshot.frame', Number(snapshot.frame), input.frame));
    if (snapshot.quality !== (input.quality ?? snapshot.quality)) findings.push(finding('SNAPSHOT_QUALITY_MISMATCH', 'error', 'Snapshot quality does not match the frame contract', 'snapshot.quality', snapshot.quality, input.quality));
    if (snapshot.backend !== (input.backend ?? snapshot.backend)) findings.push(finding('SNAPSHOT_BACKEND_MISMATCH', 'error', 'Snapshot backend does not match the frame contract', 'snapshot.backend', snapshot.backend, input.backend));
    const combined = snapshot.pressure.combined;
    if (combined < 0 || combined > 1) findings.push(finding('SNAPSHOT_PRESSURE_INVALID', 'error', 'Snapshot combined pressure must remain inside [0,1]', 'snapshot.pressure.combined', combined));
  }

  #validateLimits(): void {
    if (this.limits.maxFrameMs <= 0 || this.limits.maxVisibleObjects <= 0 || this.limits.maxDrawCalls <= 0 || this.limits.maxTriangles <= 0 || this.limits.maxTextureBytes <= 0 || this.limits.maxCameraFar <= 0) throw new RangeError('Runtime guard limits must be positive');
    if (this.limits.maxPressure < 0 || this.limits.maxPressure > 1) throw new RangeError('maxPressure must remain inside [0,1]');
  }
}

export function createRuntimeGuard(options?: RuntimeGuardOptions): RuntimeGuard {
  return new RuntimeGuard(options);
}
