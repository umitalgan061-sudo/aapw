/**
 * Backend-aware declarative post-processing composer.
 *
 * Three.js WebGPURenderer has a RenderPipeline/TSL path distinct from legacy EffectComposer. This
 * composer does not instantiate either stack. It compiles the repository's render policy into a
 * bounded node/effect descriptor that the application can apply to the appropriate renderer.
 *
 * @module renderPipelineComposer
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

const COST = freeze({ taa: 1.6, fxaa: 0.7, bloom: 1.2, ssao: 1.4, ssgi: 3.8, dof: 2.4, lut: 0.6, vignette: 0.25, fog: 0.2 });

export const RENDER_PIPELINE_COMPOSER_POLICY = freeze({
  id: 'render-pipeline-composer-2026-09-v1',
  maxEffects: 9,
  maxPasses: 12,
  maxBudgetMs: 8,
});

function effectDescriptor(effect, backend, quality) {
  const backendSupport = backend === 'webgpu' ? true : !['ssgi', 'dof'].includes(effect);
  return freeze({ id: effect, backendSupported: backendSupport, costMs: finite(COST[effect], 0.2) * (quality === 'ultra' ? 1.1 : quality === 'minimal' ? 0.65 : 1) });
}

export function compileRenderPipelineDescriptor(policy = {}, options = {}) {
  const backend = policy.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  const requested = Array.isArray(policy.effects) ? policy.effects : [];
  const effects = [];
  let spent = 0;
  for (const effect of requested.slice(0, RENDER_PIPELINE_COMPOSER_POLICY.maxEffects)) {
    const descriptor = effectDescriptor(String(effect), backend, policy.tier || 'balanced');
    if (!descriptor.backendSupported) continue;
    if (spent + descriptor.costMs > (options.maxBudgetMs ?? RENDER_PIPELINE_COMPOSER_POLICY.maxBudgetMs)) continue;
    effects.push(descriptor);
    spent += descriptor.costMs;
  }
  const passes = Math.min(RENDER_PIPELINE_COMPOSER_POLICY.maxPasses, 1 + effects.length + (policy.mrt ? 0 : 1));
  return freeze({
    backend,
    pipelineMode: backend === 'webgpu' ? 'render-pipeline-tsl' : 'conservative-webgl2',
    effects: freeze(effects),
    effectIds: freeze(effects.map((effect) => effect.id)),
    estimatedEffectMs: Number(spent.toFixed(3)),
    estimatedPasses: passes,
    mrt: backend === 'webgpu' && policy.mrt === true,
    temporalHistory: backend === 'webgpu' && policy.temporalHistory === true,
    outputBuffer: policy.outputBuffer === 'half-float' ? 'half-float' : 'unsigned-byte',
    toneMapping: String(policy.toneMapping || 'reinhard'),
    exposure: Number(clamp(policy.exposure, 0.25, 4).toFixed(3)),
  });
}

export function validateRenderPipelineDescriptor(descriptor) {
  return Boolean(descriptor && ['webgpu', 'webgl2'].includes(descriptor.backend) && Array.isArray(descriptor.effects) && descriptor.effects.length <= RENDER_PIPELINE_COMPOSER_POLICY.maxEffects && descriptor.estimatedPasses <= RENDER_PIPELINE_COMPOSER_POLICY.maxPasses);
}

export function migrateLegacyPostProcess({ backend = 'webgl2', legacyEffects = [], quality = 'balanced' } = {}) {
  const policy = {
    backend,
    tier: quality,
    effects: legacyEffects,
    mrt: backend === 'webgpu',
    temporalHistory: backend === 'webgpu' && quality !== 'minimal',
    outputBuffer: backend === 'webgpu' ? 'half-float' : 'unsigned-byte',
    toneMapping: quality === 'high' || quality === 'ultra' ? 'aces-filmic' : 'reinhard',
  };
  return compileRenderPipelineDescriptor(policy);
}

export function pipelineCostClass(descriptor) {
  const ms = finite(descriptor?.estimatedEffectMs, 0);
  if (ms >= 6) return 'heavy';
  if (ms >= 3) return 'medium';
  return 'light';
}
