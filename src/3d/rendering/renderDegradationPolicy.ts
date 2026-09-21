// @ts-nocheck
/**
 * Unified render degradation policy.
 *
 * Collapses GPU pressure, thermal state, memory pressure and accessibility requirements into one
 * bounded degradation packet. It does not mutate renderer state; consumers use the packet to reduce
 * optional visual workload consistently across effects, instances and textures.
 *
 * @module renderDegradationPolicy
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const RENDER_DEGRADATION_MODES = freeze(['none', 'light', 'moderate', 'aggressive', 'safe']);

export const RENDER_DEGRADATION_POLICY = freeze({
  id: 'render-degradation-policy-2026-09-v1',
  lightPressure: 0.35,
  moderatePressure: 0.55,
  aggressivePressure: 0.78,
  safePressure: 0.92,
  maxEffectScaleDown: 0.85,
  maxTextureBudgetScaleDown: 0.45,
  maxInstanceBudgetScaleDown: 0.4,
  minimumRenderScale: 0.55,
});

function modeFor(score, policy) {
  if (score >= policy.safePressure) return 'safe';
  if (score >= policy.aggressivePressure) return 'aggressive';
  if (score >= policy.moderatePressure) return 'moderate';
  if (score >= policy.lightPressure) return 'light';
  return 'none';
}

export function createRenderDegradationPolicy(options = {}) {
  const policy = freeze({ ...RENDER_DEGRADATION_POLICY, ...(options.policy || {}) });
  let revision = 0;

  function evaluate(input = {}) {
    const gpu = clamp(input.gpuPressure);
    const thermal = clamp(input.thermalPressure);
    const memory = clamp(input.memoryPressure);
    const recovery = clamp(input.recoveryPressure);
    const accessibility = input.reducedMotion ? 0.08 : 0;
    const score = clamp(gpu * 0.48 + thermal * 0.2 + memory * 0.2 + recovery * 0.12 + accessibility);
    const mode = modeFor(score, policy);
    const scale = mode === 'safe' ? 0.68 : mode === 'aggressive' ? 0.76 : mode === 'moderate' ? 0.86 : mode === 'light' ? 0.94 : 1;
    const textureScale = mode === 'safe' ? policy.maxTextureBudgetScaleDown : mode === 'aggressive' ? 0.6 : mode === 'moderate' ? 0.75 : mode === 'light' ? 0.9 : 1;
    const instanceScale = mode === 'safe' ? policy.maxInstanceBudgetScaleDown : mode === 'aggressive' ? 0.55 : mode === 'moderate' ? 0.72 : mode === 'light' ? 0.9 : 1;
    const effectScale = mode === 'safe' ? 0.25 : mode === 'aggressive' ? 0.45 : mode === 'moderate' ? 0.65 : mode === 'light' ? policy.maxEffectScaleDown : 1;
    revision += 1;
    return freeze({
      revision,
      mode,
      score: Number(score.toFixed(4)),
      renderScaleMultiplier: Number(Math.max(policy.minimumRenderScale, scale).toFixed(4)),
      textureBudgetMultiplier: Number(clamp(textureScale, 0.1, 1).toFixed(4)),
      instanceBudgetMultiplier: Number(clamp(instanceScale, 0.1, 1).toFixed(4)),
      effectBudgetMultiplier: Number(clamp(effectScale, 0.1, 1).toFixed(4)),
      disableExpensivePostProcess: ['aggressive', 'safe'].includes(mode),
      preferFallbackBackend: mode === 'safe',
      suppressBackgroundRefresh: ['moderate', 'aggressive', 'safe'].includes(mode),
      reasons: freeze([
        gpu >= policy.moderatePressure ? 'gpu-pressure' : null,
        thermal >= 0.7 ? 'thermal-pressure' : null,
        memory >= 0.8 ? 'memory-pressure' : null,
        recovery >= 0.5 ? 'recovery-pressure' : null,
        input.reducedMotion ? 'reduced-motion' : null,
      ].filter(Boolean)),
    });
  }

  function snapshot() { return freeze({ policy, revision }); }
  return freeze({ evaluate, snapshot, get revision() { return revision; } });
}

export function degradationDigest(packet) {
  if (!packet) return '';
  return [packet.mode, packet.renderScaleMultiplier.toFixed(4), packet.textureBudgetMultiplier.toFixed(4), packet.instanceBudgetMultiplier.toFixed(4), packet.effectBudgetMultiplier.toFixed(4), packet.disableExpensivePostProcess ? 'post:off' : 'post:on', packet.preferFallbackBackend ? 'fallback:on' : 'fallback:off', ...packet.reasons].join('|');
}

export function validateRenderDegradationPacket(packet) {
  if (!packet || !RENDER_DEGRADATION_MODES.includes(packet.mode)) return false;
  const values = [packet.renderScaleMultiplier, packet.textureBudgetMultiplier, packet.instanceBudgetMultiplier, packet.effectBudgetMultiplier];
  return values.every((value) => Number.isFinite(value) && value >= 0.1 && value <= 1);
}
