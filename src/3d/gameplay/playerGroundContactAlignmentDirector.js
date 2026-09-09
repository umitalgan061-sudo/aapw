/**
 * Deterministic player visual/collider/ground contact projection.
 * Caller-owned runtime remains authoritative for transforms and terrain queries.
 */
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const round = (value) => Math.round(finite(value) * 1e6) / 1e6;

function sample(input = {}) {
  return {
    visualY: finite(input.visualY),
    colliderY: finite(input.colliderY),
    groundY: finite(input.groundY),
    visualRadius: clamp(input.visualRadius, 0.01, 10),
    colliderRadius: clamp(input.colliderRadius, 0.01, 10),
    slopeDegrees: clamp(input.slopeDegrees, 0, 89.9),
    grounded: input.grounded !== false,
    assetReady: input.assetReady !== false,
  };
}

export function createPlayerGroundContactAlignmentPlan(input = {}) {
  const s = sample(input);
  const maxCorrection = clamp(input.maxCorrectionMeters, 0, 2);
  const visualGroundOffset = s.visualY - s.groundY;
  const colliderGroundOffset = s.colliderY - s.groundY;
  const visualColliderGap = s.visualY - s.colliderY;
  const correction = clamp(-visualGroundOffset, -maxCorrection, maxCorrection);
  const tolerance = clamp(input.toleranceMeters, 0.005, 0.5);
  const slopeLimit = clamp(input.slopeLimitDegrees, 0, 89.9);
  const valid = s.grounded && s.assetReady && s.slopeDegrees <= slopeLimit;
  const status = !s.assetReady ? 'asset-not-ready'
    : !s.grounded ? 'airborne'
      : s.slopeDegrees > slopeLimit ? 'slope-blocked'
        : Math.abs(visualColliderGap) > tolerance ? 'visual-collider-drift'
          : Math.abs(visualGroundOffset) > tolerance || Math.abs(colliderGroundOffset) > tolerance ? 'ground-drift'
            : 'aligned';

  return Object.freeze({
    valid,
    status,
    correctionMeters: round(valid ? correction : 0),
    visualGroundOffsetMeters: round(visualGroundOffset),
    colliderGroundOffsetMeters: round(colliderGroundOffset),
    visualColliderGapMeters: round(visualColliderGap),
    slopeDegrees: round(s.slopeDegrees),
    toleranceMeters: round(tolerance),
    maxCorrectionMeters: round(maxCorrection),
    requiresTransformWrite: valid && Math.abs(correction) > tolerance,
    evidence: Object.freeze({
      visualColliderParity: Math.abs(visualColliderGap) <= tolerance,
      groundParity: Math.abs(visualGroundOffset) <= tolerance && Math.abs(colliderGroundOffset) <= tolerance,
      assetReady: s.assetReady,
      grounded: s.grounded,
    }),
  });
}

export function serializePlayerGroundContactAlignmentPlan(plan) {
  return JSON.stringify(plan);
}
