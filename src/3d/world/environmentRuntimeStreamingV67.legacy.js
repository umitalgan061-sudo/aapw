import { clamp01, finiteV67, meanV67 } from './environmentRuntimeV67.js';

export const STREAMING_V67 = Object.freeze({
  id: 'streaming-v67',
  version: 67,
  deterministic: true,
  noWorldMutation: true,
});

export const platformBudgetV67 = (platform = 'desktop') => {
  if (platform === 'mobile') return { fps: 45, drawCalls: 850, triangles: 620000, vegetation: 0.62 };
  if (platform === 'tablet') return { fps: 50, drawCalls: 1050, triangles: 780000, vegetation: 0.74 };
  return { fps: 60, drawCalls: 1400, triangles: 1100000, vegetation: 1 };
};

export const complexityWeightV67 = ({ distance = 1, visibility = 1, hazard = 0, wildlife = 0 } = {}) =>
  clamp01(0.18 + clamp01(1 / Math.max(1, finiteV67(distance, 1))) * 0.2 + clamp01(visibility) * 0.22 + clamp01(hazard) * 0.18 + clamp01(wildlife) * 0.22);

export const tierFromWeightV67 = (weight = 0) => {
  if (weight >= 0.78) return 'near';
  if (weight >= 0.52) return 'mid';
  if (weight >= 0.28) return 'far';
  return 'culled';
};

export const admissionDecisionV67 = ({ weight = 0, budgetUse = 0, platform = 'desktop' } = {}) => {
  const budget = platformBudgetV67(platform);
  const pressure = clamp01(budgetUse);
  const effective = clamp01(weight - pressure * 0.18);
  return {
    tier: tierFromWeightV67(effective),
    admit: effective > 0.18 && pressure < 1.08,
    effective,
    budget,
  };
};

export const hysteresisV67 = ({ previous = 0, next = 0, threshold = 0.08 } = {}) => {
  if (next > previous + threshold) return 'promote';
  if (next < previous - threshold) return 'demote';
  return 'hold';
};

export const buildChunkDecisionV67 = (chunk = {}, context = {}) => {
  const weight = complexityWeightV67({
    distance: chunk.distance,
    visibility: context.visibility,
    hazard: chunk.hazard,
    wildlife: chunk.wildlife,
  });
  const decision = admissionDecisionV67({ weight, budgetUse: context.budgetUse, platform: context.platform });
  return { id: chunk.id ?? 'chunk', ...decision, transition: hysteresisV67({ previous: chunk.previousWeight, next: weight }) };
};

export const buildStreamingFieldV67 = (chunks = [], context = {}) =>
  chunks.map((chunk) => buildChunkDecisionV67(chunk, context));

export const streamingUsageV67 = (field = []) => {
  const admitted = field.filter((x) => x.admit).length;
  const near = field.filter((x) => x.tier === 'near').length;
  const mid = field.filter((x) => x.tier === 'mid').length;
  const far = field.filter((x) => x.tier === 'far').length;
  return {
    admitted,
    total: field.length,
    admissionRate: field.length ? admitted / field.length : 0,
    tierMix: { near, mid, far, culled: field.length - near - mid - far },
    pressure: clamp01(admitted / Math.max(1, field.length * 0.85)),
  };
};

export const frameBudgetV67 = ({ platform = 'desktop', drawCalls = 0, triangles = 0 } = {}) => {
  const budget = platformBudgetV67(platform);
  return {
    drawCallUse: drawCalls / budget.drawCalls,
    triangleUse: triangles / budget.triangles,
    fpsHeadroom: clamp01((budget.fps - Math.max(0, finiteV67(drawCalls) / 30)) / budget.fps),
  };
};

export const streamingSummaryV67 = (field = []) => ({
  samples: field.length,
  usage: streamingUsageV67(field),
  meanEffective: meanV67(field.map((x) => x.effective)),
});

export const validateStreamingV67 = (field = []) => {
  const errors = [];
  if (!Array.isArray(field)) errors.push('field');
  if (field.some((x) => typeof x.admit !== 'boolean')) errors.push('admit');
  if (field.some((x) => x.effective < 0 || x.effective > 1)) errors.push('effective');
  return { ok: errors.length === 0, errors };
};

export const streamingTelemetryV67 = (field = []) => ({
  policy: STREAMING_V67.id,
  valid: validateStreamingV67(field).ok,
  summary: streamingSummaryV67(field),
});

export const mobileSafeRadiusV67 = ({ platform = 'desktop', quality = 1 } = {}) =>
  platform === 'mobile' ? 280 * clamp01(quality) : 520 * clamp01(quality);

export const streamPriorityV67 = (chunk = {}) => clamp01(
  clamp01(chunk.distance ? 1 / chunk.distance : 1) * 0.35 +
  clamp01(chunk.hazard) * 0.25 +
  clamp01(chunk.wildlife) * 0.16 +
  clamp01(chunk.questCritical) * 0.24,
);
