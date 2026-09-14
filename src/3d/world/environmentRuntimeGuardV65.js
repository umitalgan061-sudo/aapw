export const V65_GUARD_POLICY = Object.freeze({
  id: 'environment-runtime-guard-v65-2026-09-14',
  deterministic: true,
  maxChangedLines: 3000,
  minChangedLines: 2850,
  minConfidence: 0.55,
  maxSlope: 48,
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

export const guardSample = (sample = {}) => ({
  confidence: clamp(sample.confidence ?? 1, 0, 1),
  slope: clamp(sample.slope ?? 0, 0, 90),
  grounded: sample.grounded !== false,
  water: sample.water === true,
  roadDistance: Math.max(0, Number(sample.roadDistance ?? 9999)),
  settlementDistance: Math.max(0, Number(sample.settlementDistance ?? 9999)),
});

export const evaluatePlacementGuard = (sample = {}) => {
  const s = guardSample(sample);
  const reasons = [];
  if (s.confidence < V65_GUARD_POLICY.minConfidence) reasons.push('low-confidence');
  if (s.slope > V65_GUARD_POLICY.maxSlope) reasons.push('steep');
  if (!s.grounded) reasons.push('ungrounded');
  if (s.water) reasons.push('water');
  if (s.roadDistance < 7) reasons.push('road-buffer');
  if (s.settlementDistance < 12) reasons.push('settlement-buffer');
  return { allowed: reasons.length === 0, reasons };
};

export const evaluateFrameGuard = (usage = {}) => ({
  allowed: Number(usage.max ?? 0) <= 1.18,
  pressure: Number(usage.max ?? 0) <= 0.82 ? 'low' : Number(usage.max ?? 0) <= 1 ? 'target' : Number(usage.max ?? 0) <= 1.18 ? 'high' : 'critical',
});

export const evaluateVisualGuard = (audit = {}) => ({
  allowed: audit.p0Pass === true && Number(audit.meanScore ?? 0) >= 0.72,
  p0Pass: audit.p0Pass === true,
  score: clamp(audit.meanScore ?? 0, 0, 1),
});

export const evaluateRuntimeGuard = ({ samples = [], streaming = {}, visual = {} } = {}) => {
  const placement = samples.map(evaluatePlacementGuard);
  const frame = evaluateFrameGuard(streaming?.usage || streaming);
  const visuals = evaluateVisualGuard(visual);
  return {
    policy: V65_GUARD_POLICY.id,
    placement,
    frame,
    visuals,
    allowed: placement.every((item) => item.allowed) && frame.allowed && visuals.allowed,
  };
};

export const guardTelemetry = (result) => ({
  policy: V65_GUARD_POLICY.id,
  allowed: result?.allowed === true,
  rejectedSamples: (result?.placement || []).filter((item) => !item.allowed).length,
  frameAllowed: result?.frame?.allowed === true,
  visualAllowed: result?.visuals?.allowed === true,
});
