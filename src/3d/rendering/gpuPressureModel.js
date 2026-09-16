/**
 * GPU/CPU render pressure model used by quality and feature negotiation.
 *
 * The model does not query browser performance APIs itself. Callers inject timing, memory and frame
 * data. This keeps the policy deterministic, testable and independent from the render backend.
 *
 * @module gpuPressureModel
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const GPU_PRESSURE_POLICY = freeze({
  id: 'gpu-pressure-model-2026-09-v1',
  targetFrameMs: 16.67,
  warningRatio: 0.92,
  criticalRatio: 1.2,
  memoryWarning: 0.8,
  memoryCritical: 0.95,
  thermalWarning: 0.7,
  thermalCritical: 0.9,
});

function ratio(value, target) {
  return Math.max(0, finite(value) / Math.max(0.1, finite(target, 1)));
}

export function evaluateGpuPressure(input = {}, options = {}) {
  const policy = { ...GPU_PRESSURE_POLICY, ...(options.policy || {}) };
  const gpuRatio = ratio(input.gpuMs, policy.targetFrameMs);
  const cpuRatio = ratio(input.cpuMs, policy.targetFrameMs);
  const frameRatio = ratio(input.frameMs, policy.targetFrameMs);
  const memoryRatio = clamp(input.memoryUtilization);
  const thermal = clamp(input.thermalPressure);
  const gpuScore = clamp(gpuRatio / Math.max(1, policy.criticalRatio));
  const cpuScore = clamp(cpuRatio / Math.max(1, policy.criticalRatio));
  const frameScore = clamp(frameRatio / Math.max(1, policy.criticalRatio));
  const memoryScore = memoryRatio;
  const thermalScore = thermal;
  const overall = clamp(gpuScore * 0.4 + cpuScore * 0.15 + frameScore * 0.2 + memoryScore * 0.15 + thermalScore * 0.1);
  const critical = frameRatio >= policy.criticalRatio || gpuRatio >= policy.criticalRatio || memoryRatio >= policy.memoryCritical || thermal >= policy.thermalCritical;
  const warning = critical || frameRatio >= policy.warningRatio || gpuRatio >= policy.warningRatio || memoryRatio >= policy.memoryWarning || thermal >= policy.thermalWarning;
  return freeze({ state: critical ? 'critical' : warning ? 'warning' : 'nominal', overall: Number(overall.toFixed(4)), gpuRatio: Number(gpuRatio.toFixed(4)), cpuRatio: Number(cpuRatio.toFixed(4)), frameRatio: Number(frameRatio.toFixed(4)), memoryRatio: Number(memoryRatio.toFixed(4)), thermal: Number(thermal.toFixed(4)) });
}

export function pressureRecommendations(pressure) {
  if (!pressure) return freeze(['retain-default-quality']);
  if (pressure.state === 'critical') return freeze(['reduce-render-scale', 'disable-expensive-postprocess', 'reduce-instance-budgets', 'defer-low-priority-textures', 'prefer-safe-backend']);
  if (pressure.state === 'warning') return freeze(['reduce-nonessential-postprocess', 'reduce-low-priority-texture-mips', 'slow-background-streaming']);
  return freeze(['retain-default-quality']);
}

export function pressureClass(score = 0) {
  const value = clamp(score);
  return value >= 0.85 ? 'critical' : value >= 0.55 ? 'elevated' : value >= 0.3 ? 'watch' : 'nominal';
}
