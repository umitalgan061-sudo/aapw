/**
 * Backend/quality feature negotiation for the modern render stack.
 *
 * Converts browser/device capabilities and scene requirements into a conservative feature contract.
 * It distinguishes requested features from actually enabled features so WebGPU-specific capabilities
 * can be adopted progressively without making WebGL2 a second-class failure path.
 *
 * @module renderFeatureNegotiator
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const RENDER_FEATURES = freeze([
  'webgpu', 'mrt', 'temporalHistory', 'ssgi', 'dof', 'taa', 'ssao', 'bloom', 'lut', 'fog',
  'instancing', 'textureCompression', 'halfFloatOutput', 'multiview', 'occlusionHints', 'dynamicResolution',
]);

export const RENDER_FEATURE_NEGOTIATION_POLICY = freeze({
  id: 'render-feature-negotiator-2026-09-v1',
  maxFeatures: 32,
  minHardwareScore: 0.15,
});

function supported(feature, input) {
  const backend = input.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  const tier = String(input.tier || 'balanced');
  const rank = tier === 'ultra' ? 3 : tier === 'high' ? 2 : tier === 'balanced' ? 1 : 0;
  if (feature === 'webgpu') return backend === 'webgpu' && input.webgpuAvailable === true;
  if (feature === 'mrt') return backend === 'webgpu' && rank >= 2;
  if (feature === 'temporalHistory') return backend === 'webgpu' && rank >= 2 && input.reducedMotion !== true;
  if (feature === 'ssgi' || feature === 'dof') return backend === 'webgpu' && rank >= 3 && input.hardwareScore >= 0.65 && input.thermalPressure < 0.65;
  if (feature === 'taa') return rank >= 2 && input.reducedMotion !== true;
  if (feature === 'ssao') return rank >= 2;
  if (feature === 'bloom') return rank >= 2 && input.thermalPressure < 0.8;
  if (feature === 'lut') return rank >= 1;
  if (feature === 'halfFloatOutput') return backend === 'webgpu' && rank >= 1;
  if (feature === 'multiview') return backend === 'webgpu' && input.multiviewAvailable === true;
  if (feature === 'textureCompression') return input.textureCompression !== false;
  if (feature === 'instancing' || feature === 'occlusionHints' || feature === 'dynamicResolution' || feature === 'fog') return true;
  return false;
}

export function negotiateRenderFeatures(requested = [], capabilities = {}) {
  const safeCapabilities = {
    backend: capabilities.backend === 'webgpu' ? 'webgpu' : 'webgl2',
    tier: String(capabilities.tier || 'balanced'),
    webgpuAvailable: capabilities.webgpuAvailable === true,
    hardwareScore: clamp(capabilities.hardwareScore, 0, 1),
    thermalPressure: clamp(capabilities.thermalPressure, 0, 1),
    reducedMotion: capabilities.reducedMotion === true,
    multiviewAvailable: capabilities.multiviewAvailable === true,
    textureCompression: capabilities.textureCompression !== false,
  };
  const requestedFeatures = [...new Set((Array.isArray(requested) ? requested : []).map((feature) => String(feature).slice(0, 48)).filter((feature) => RENDER_FEATURES.includes(feature)))].slice(0, RENDER_FEATURE_NEGOTIATION_POLICY.maxFeatures);
  const enabled = requestedFeatures.filter((feature) => supported(feature, safeCapabilities));
  const rejected = requestedFeatures.filter((feature) => !enabled.includes(feature));
  const fallback = safeCapabilities.backend === 'webgpu' && !safeCapabilities.webgpuAvailable ? 'webgl2' : safeCapabilities.backend;
  return freeze({ backend: safeCapabilities.webgpuAvailable ? safeCapabilities.backend : fallback, tier: safeCapabilities.tier, requested: freeze(requestedFeatures), enabled: freeze(enabled), rejected: freeze(rejected), fallback, hardwareScore: safeCapabilities.hardwareScore, thermalPressure: safeCapabilities.thermalPressure });
}

export function renderFeatureDigest(contract) {
  return [contract?.backend || 'webgl2', contract?.tier || 'balanced', ...(contract?.enabled || []).slice().sort()].join('|');
}

export function validateFeatureContract(contract) {
  if (!contract || !['webgpu', 'webgl2'].includes(contract.backend)) return false;
  if (!Array.isArray(contract.enabled) || !Array.isArray(contract.rejected)) return false;
  return [...contract.enabled, ...contract.rejected].every((feature) => RENDER_FEATURES.includes(feature));
}
