/**
 * Declarative render pipeline policy for WebGPU and WebGL2.
 *
 * This module describes desired effects rather than instantiating passes. WebGPURenderer can use the
 * newer RenderPipeline/TSL post-processing architecture; WebGL2 receives a conservative equivalent.
 * The policy is derived from quality, device, scene and accessibility signals and is stable for equal
 * inputs, which makes it suitable for deterministic acceptance matrices.
 * @module renderPipelinePolicy
 */

export const RENDER_PIPELINE_TIERS = Object.freeze(['minimal', 'balanced', 'high', 'ultra']);
export const RENDER_EFFECTS = Object.freeze(['taa', 'fxaa', 'bloom', 'ssao', 'ssgi', 'dof', 'lut', 'vignette', 'fog']);

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }
function bool(value) { return value === true; }
function tier(value) { return RENDER_PIPELINE_TIERS.includes(value) ? value : 'balanced'; }

const TIER_WEIGHTS = Object.freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });

export function derivePipelineTier({ runtimeTier = 'balanced', backend = 'webgl2', hardwareScore = 0.5, reducedMotion = false, batterySaver = false, thermalPressure = 0 } = {}) {
  const runtimeRank = TIER_WEIGHTS[tier(runtimeTier)];
  const backendBonus = backend === 'webgpu' ? 1 : 0;
  const hardwareRank = hardwareScore >= 0.8 ? 3 : hardwareScore >= 0.58 ? 2 : hardwareScore >= 0.35 ? 1 : 0;
  let rank = Math.min(3, Math.max(0, Math.min(runtimeRank + backendBonus, hardwareRank + backendBonus)));
  if (reducedMotion || batterySaver || thermalPressure >= 0.5) rank = Math.max(0, rank - 1);
  return RENDER_PIPELINE_TIERS[rank];
}

function effectEnabled(effect, tierName, options) {
  const rank = TIER_WEIGHTS[tierName];
  if (options.disabled?.includes(effect)) return false;
  if (effect === 'ssgi' || effect === 'dof') return options.backend === 'webgpu' && rank >= 3;
  if (effect === 'ssao') return rank >= 2;
  if (effect === 'bloom') return rank >= 2;
  if (effect === 'taa') return rank >= 2;
  if (effect === 'fxaa') return rank < 2;
  if (effect === 'lut') return rank >= 1;
  if (effect === 'vignette') return rank >= 1 && !options.reducedMotion;
  return true;
}

export function buildRenderPipelinePolicy(options = {}) {
  const backend = options.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  const pipelineTier = derivePipelineTier({ ...options, backend });
  const enabledEffects = RENDER_EFFECTS.filter((effect) => effectEnabled(effect, pipelineTier, { ...options, backend }));
  const rank = TIER_WEIGHTS[pipelineTier];
  const dprScale = clamp(options.dprScale, 0.55, 1.15);
  const renderScale = clamp(options.renderScale, 0.5, 1.1) * (options.reducedMotion ? 1 : 1);
  const mrt = backend === 'webgpu' && rank >= 2;
  const dynamicResolution = rank >= 1;
  const temporalHistory = backend === 'webgpu' && rank >= 2 && !bool(options.reducedMotion);
  return Object.freeze({
    version: 2,
    backend,
    tier: pipelineTier,
    effects: Object.freeze(enabledEffects),
    mrt,
    temporalHistory,
    dynamicResolution,
    dprScale: Number(dprScale.toFixed(3)),
    renderScale: Number(renderScale.toFixed(3)),
    msaaSamples: backend === 'webgpu' ? (rank >= 3 ? 4 : 2) : 4,
    outputBuffer: backend === 'webgpu' && rank >= 1 ? 'half-float' : 'unsigned-byte',
    toneMapping: rank >= 2 ? 'aces-filmic' : 'reinhard',
    exposure: Number(clamp(options.exposure, 0.5, 2).toFixed(3)),
  });
}

export function estimatePipelineCost(policy, scene = {}) {
  const calls = Math.max(0, n(scene.drawCalls, 0));
  const triangles = Math.max(0, n(scene.triangles, 0));
  const foliage = Math.max(0, n(scene.foliageInstances, 0));
  const passes = 1 + policy.effects.length + (policy.mrt ? 0.35 : 0) + (policy.temporalHistory ? 0.45 : 0);
  const estimatedGpuMs = 0.35 + passes * 0.18 + calls * 0.0024 + triangles / 1_500_000 + foliage / 9000;
  return Object.freeze({
    renderPasses: Number(passes.toFixed(3)),
    gpuMs: Number(estimatedGpuMs.toFixed(3)),
    bandwidthClass: triangles > 2_500_000 ? 'high' : triangles > 1_000_000 ? 'medium' : 'low',
  });
}

export function validatePipelinePolicy(policy) {
  return Boolean(policy && policy.version >= 1 && ['webgpu', 'webgl2'].includes(policy.backend) && RENDER_PIPELINE_TIERS.includes(policy.tier) && Array.isArray(policy.effects) && policy.msaaSamples >= 0);
}

export function migratePipelinePolicy(policy = {}) {
  if (policy.version >= 2) return policy;
  return buildRenderPipelinePolicy({
    backend: policy.backend,
    runtimeTier: policy.tier,
    renderScale: policy.renderScale,
    dprScale: policy.dprScale,
    reducedMotion: policy.reducedMotion,
    exposure: policy.exposure,
    disabled: policy.disabled,
  });
}
