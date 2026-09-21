import { bridgeHealth, bridgeMetrics } from './environmentRuntimeBridgeV65.js';

export const V65_READINESS_POLICY = Object.freeze({
  id: 'environment-runtime-readiness-v65-2026-09-14',
  minAcceptance: 0.55,
  minVisibility: 0.3,
  minContinuity: 0.72,
  maxBudget: 1.18,
  minEvidence: 0.65,
});

export const evaluateReadiness = (bridge) => {
  const health = bridgeHealth(bridge);
  const metrics = bridgeMetrics(bridge);
  const checks = [
    { id: 'health', pass: health.healthy },
    { id: 'acceptance', pass: metrics.acceptanceRate >= V65_READINESS_POLICY.minAcceptance },
    { id: 'visibility', pass: metrics.visibility >= V65_READINESS_POLICY.minVisibility },
    { id: 'continuity', pass: metrics.continuity >= V65_READINESS_POLICY.minContinuity },
    { id: 'budget', pass: metrics.budgetUsage <= V65_READINESS_POLICY.maxBudget },
    { id: 'evidence', pass: metrics.evidenceScore >= V65_READINESS_POLICY.minEvidence },
    { id: 'p0', pass: metrics.p0Pass },
  ];
  return { policy: V65_READINESS_POLICY.id, checks, ready: checks.every((item) => item.pass), metrics };
};

export const readinessDigest = (readiness) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(readiness)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const readinessTelemetry = (readiness) => ({
  policy: V65_READINESS_POLICY.id,
  ready: readiness?.ready === true,
  failedChecks: (readiness?.checks || []).filter((item) => !item.pass).map((item) => item.id),
  digest: readinessDigest(readiness),
});
