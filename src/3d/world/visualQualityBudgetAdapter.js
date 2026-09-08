/**
 * Runtime-facing visual quality budget adapter for shipped world scenes.
 *
 * This module does not create geometry or own scene/camera/renderer lifecycle. It consumes
 * caller-owned render observations and returns a deterministic bounded quality decision that
 * can be applied by an existing runtime owner (for example createScene/game loop) without
 * introducing another rendering framework.
 *
 * @module visualQualityBudgetAdapter
 */

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const positive = (value, fallback = 1) => Math.max(0, finite(value, fallback));

const stableStringify = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());

function normalizeObservation(observation = {}) {
  const fogVisibility = positive(observation.fogVisibility, 0);
  const drawCalls = Math.round(positive(observation.drawCalls));
  const triangles = Math.round(positive(observation.triangles));
  const frameMs = positive(observation.frameMs, 16.67);
  const textureMb = positive(observation.textureMb);
  const seamRisk = clamp01(observation.seamRisk);
  const waterArtifactRisk = clamp01(observation.waterArtifactRisk);
  const blackSkyRisk = clamp01(observation.blackSkyRisk);
  const placeholderRisk = clamp01(observation.placeholderRisk);
  const groundedRisk = clamp01(observation.groundedRisk);
  const detailEnergy = clamp01(observation.detailEnergy);
  const daylight = clamp01(observation.daylight);
  return {
    fogVisibility,
    drawCalls,
    triangles,
    frameMs,
    textureMb,
    seamRisk,
    waterArtifactRisk,
    blackSkyRisk,
    placeholderRisk,
    groundedRisk,
    detailEnergy,
    daylight,
  };
}

function scoreVisualRisk(sample) {
  const structural = Math.max(sample.seamRisk, sample.waterArtifactRisk, sample.blackSkyRisk);
  const content = Math.max(sample.placeholderRisk, sample.groundedRisk);
  const budget = Math.max(
    clamp01(sample.drawCalls / 500),
    clamp01(sample.triangles / 500000),
    clamp01(sample.frameMs / 33.33),
    clamp01(sample.textureMb / 256),
  );
  return {
    structural,
    content,
    budget,
    total: clamp01(structural * 0.45 + content * 0.25 + budget * 0.30),
  };
}

function deriveTier(score, sample) {
  if (score.structural >= 0.65 || score.content >= 0.65) return 'reject';
  if (score.total >= 0.70 || sample.frameMs > 33.33) return 'degrade';
  if (score.total >= 0.40 || sample.frameMs > 22.22) return 'guarded';
  return 'full';
}

function deriveRuntimeHints(sample, tier, score) {
  const shouldSuppressFarMicro = tier !== 'full' || sample.detailEnergy < 0.35;
  const shouldBiasFog = score.structural > 0.20 || sample.fogVisibility < 1200;
  const shouldEnableBlackSkyGuard = sample.blackSkyRisk > 0.05 || sample.daylight < 0.08;
  const normalEnergy = tier === 'full' ? 1 : tier === 'guarded' ? 0.72 : tier === 'degrade' ? 0.48 : 0;
  return {
    shouldSuppressFarMicro,
    shouldBiasFog,
    shouldEnableBlackSkyGuard,
    normalEnergy,
    vegetationDensityScale: tier === 'full' ? 1 : tier === 'guarded' ? 0.82 : tier === 'degrade' ? 0.62 : 0,
    waterMicroScale: sample.waterArtifactRisk > 0.25 ? 0.35 : 1,
    confidence: clamp01(1 - score.total),
  };
}

export function evaluateVisualQualityBudget(observation = {}) {
  const sample = normalizeObservation(observation);
  const score = scoreVisualRisk(sample);
  const tier = deriveTier(score, sample);
  const hints = deriveRuntimeHints(sample, tier, score);
  return Object.freeze({
    sample: Object.freeze(sample),
    score: Object.freeze(score),
    tier,
    hints: Object.freeze(hints),
    acceptance: Object.freeze({
      visibleSeam: sample.seamRisk === 0,
      visibleRectangularWater: sample.waterArtifactRisk === 0,
      blackSky: sample.blackSkyRisk === 0,
      placeholder: sample.placeholderRisk === 0,
      grounded: sample.groundedRisk === 0,
      withinMobileBudget: sample.drawCalls <= 500 && sample.triangles <= 500000 && sample.frameMs <= 33.33 && sample.textureMb <= 256,
    }),
    deterministicKey: stableStringify({ sample, score, tier, hints }),
  });
}

export function applyVisualQualityBudgetHints(target = {}, observation = {}) {
  const decision = evaluateVisualQualityBudget(observation);
  if (!target || typeof target !== 'object') return decision;
  if ('farMicroEnabled' in target) target.farMicroEnabled = !decision.hints.shouldSuppressFarMicro;
  if ('normalEnergy' in target) target.normalEnergy = decision.hints.normalEnergy;
  if ('vegetationDensityScale' in target) target.vegetationDensityScale = decision.hints.vegetationDensityScale;
  if ('waterMicroScale' in target) target.waterMicroScale = decision.hints.waterMicroScale;
  if ('blackSkyGuardEnabled' in target) target.blackSkyGuardEnabled = decision.hints.shouldEnableBlackSkyGuard;
  return decision;
}

export function serializeVisualQualityBudget(observation = {}) {
  return evaluateVisualQualityBudget(observation).deterministicKey;
}
