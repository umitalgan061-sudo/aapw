import { buildV66ReleaseSummary, buildV66Ledger } from './environmentRuntimeObservabilityV66.js';
import { auditEnvironmentV66 } from './environmentRuntimeV66Audit.js';
import { buildStreamingBudgetV66 } from './environmentRuntimeStreamingV66.js';

export const V66_RELEASE_POLICY = Object.freeze({
  id: 'environment-runtime-release-v66-2026-09-15',
  version: 66,
  deterministic: true,
  noWorldMutation: true,
  requiredEvidence: ['p0', 'p1', 'determinism', 'budget', 'architecture'],
});

export const buildV66ReleaseGate = (runtime = {}) => {
  const budget = runtime.streaming?.budget || runtime.streaming?.usage ? runtime.streaming.budget || { max: runtime.streaming.usage.max } : buildStreamingBudgetV66({});
  const audit = auditEnvironmentV66(runtime);
  const ledger = buildV66Ledger({ ...runtime, audit, streaming: { budget } });
  const gates = {
    deterministic: runtime.deterministic === true,
    noWorldMutation: runtime.contract?.noWorldMutation === true,
    placementAuthority: runtime.contract?.placementAuthority === 'WorldAssetPlacementPipeline.js',
    materialAuthority: runtime.contract?.materialAuthority === 'MaterialAssignmentCore.js',
    audit: audit.p0Pass === true,
    evidence: ledger.evidenceScore >= 0.8,
    budget: (budget.max ?? 0) <= 1.18,
    digest: typeof runtime.digest === 'string' && runtime.digest.length === 8,
  };
  return { policy: V66_RELEASE_POLICY.id, version: 66, gates, pass: Object.values(gates).every(Boolean), audit, ledger, summary: buildV66ReleaseSummary(runtime) };
};

export const buildV66ReleaseNotes = (runtime = {}) => {
  const gate = buildV66ReleaseGate(runtime);
  return {
    version: 66,
    status: gate.pass ? 'ready' : 'blocked',
    headline: 'Adaptive environmental response, hydrology, ecology, visibility, navigation and streaming runtime',
    gates: gate.gates,
    telemetry: gate.summary,
    contract: V66_RELEASE_POLICY,
  };
};

export const compareV66ReleaseGates = (before, after) => {
  const a = buildV66ReleaseGate(before);
  const b = buildV66ReleaseGate(after);
  return {
    before: a,
    after: b,
    improved: a.pass === false && b.pass === true,
    gateDelta: Object.fromEntries(Object.keys(a.gates).map((key) => [key, Number(b.gates[key]) - Number(a.gates[key])])),
  };
};

export const validateV66ReleaseGate = (gate) => {
  const errors = [];
  if (gate?.policy !== V66_RELEASE_POLICY.id) errors.push('policy');
  if (gate?.version !== 66) errors.push('version');
  if (gate?.pass !== true) errors.push('blocked');
  for (const required of V66_RELEASE_POLICY.requiredEvidence) if (!(required === 'p0' ? gate?.gates?.audit : required === 'p1' ? gate?.gates?.evidence : true)) errors.push(`evidence:${required}`);
  return { ok: errors.length === 0, errors };
};

export const getV66ReleaseSummary = () => Object.freeze({ contract: V66_RELEASE_POLICY, features: ['release-gate', 'release-notes', 'gate-delta', 'required-evidence'] });
