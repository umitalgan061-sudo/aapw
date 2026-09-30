const round = (v, p = 4) => Number((Number.isFinite(v) ? v : 0).toFixed(p));
const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

export const V65_OBSERVABILITY_POLICY = Object.freeze({
  id: 'environment-runtime-observability-v65-2026-09-14',
  schema: 1,
  severity: Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4', 'P5']),
  deterministic: true,
  evidenceCameras: Object.freeze([
    Object.freeze({ id: 'world-full', x: 0, z: 0, distance: 7000, projection: 'orthographic' }),
    Object.freeze({ id: 'terrain-near', x: 140, z: 240, distance: 320, projection: 'orthographic' }),
    Object.freeze({ id: 'far-mountain', x: 2600, z: 1600, distance: 5200, projection: 'orthographic' }),
  ]),
});

export const metric = (name, value, threshold, severity = 'P2') => ({
  name,
  value: round(value),
  threshold: round(threshold),
  severity,
  pass: Number(value) <= Number(threshold),
});

export const recordIssue = (issues, id, severity, message, context = {}) => [...issues, { id, severity, message, context }];

export const auditRuntime = ({ adaptive = {}, surface = {}, continuity = {}, streaming = {}, phenology = {} } = {}) => {
  const issues = [];
  const metrics = [];
  const acceptanceRate = adaptive?.summary?.acceptanceRate ?? 0;
  const visibility = surface?.meanVisibility ?? 1;
  const continuityRate = continuity?.continuityRate ?? 1;
  const budgetPressure = streaming?.usage?.max ?? 0;
  const green = phenology?.green ?? 0;
  metrics.push(metric('acceptanceRateFloor', 1 - acceptanceRate, 0.45, 'P1'));
  metrics.push(metric('visibilityLoss', 1 - visibility, 0.7, 'P0'));
  metrics.push(metric('continuityGap', 1 - continuityRate, 0.28, 'P0'));
  metrics.push(metric('budgetOverage', Math.max(0, budgetPressure - 1), 0.18, 'P1'));
  metrics.push(metric('phenologyNoGreen', green, 0.02, 'P3'));
  if (acceptanceRate < 0.55) issues.push({ id: 'low-acceptance', severity: 'P1', message: 'Adaptive habitat acceptance is below target.' });
  if (visibility < 0.3) issues.push({ id: 'visibility-collapse', severity: 'P0', message: 'Atmosphere visibility is too low.' });
  if (continuityRate < 0.72) issues.push({ id: 'seam-risk', severity: 'P0', message: 'Cross-chunk continuity is below safe threshold.' });
  if (budgetPressure > 1.18) issues.push({ id: 'critical-budget', severity: 'P1', message: 'Frame budget is critically exceeded.' });
  return { metrics, issues, passed: !issues.some((x) => x.severity === 'P0' || x.severity === 'P1') };
};

export const p0Checklist = ({ water = {}, material = {}, geometry = {}, atmosphere = {} } = {}) => [
  { id: 'rectangular-water', pass: water.rectangular !== true, severity: 'P0' },
  { id: 'moire', pass: water.moire !== true, severity: 'P0' },
  { id: 'cyan-water', pass: water.cyan !== true, severity: 'P0' },
  { id: 'seam', pass: material.seam !== true, severity: 'P0' },
  { id: 'post-process', pass: material.postProcessed !== true, severity: 'P0' },
  { id: 'floating', pass: geometry.floating !== true, severity: 'P1' },
  { id: 'interpenetration', pass: geometry.interpenetration !== true, severity: 'P1' },
  { id: 'black-sky', pass: atmosphere.blackSky !== true, severity: 'P0' },
];

export const evidenceScore = (cameraResults = []) => {
  if (!cameraResults.length) return 0;
  let score = 0;
  for (const result of cameraResults) {
    score += clamp(result.readability ?? 0, 0, 1) * 0.4;
    score += clamp(result.grounding ?? 0, 0, 1) * 0.25;
    score += clamp(result.biomeSeparation ?? 0, 0, 1) * 0.2;
    score += clamp(result.waterClarity ?? 0, 0, 1) * 0.15;
  }
  return round(score / cameraResults.length);
};

export const buildEvidenceRecord = ({ camera, metrics = {}, digest = null, notes = [] } = {}) => ({
  camera,
  metrics,
  digest,
  notes: Array.isArray(notes) ? notes.slice(0, 12) : [],
  capturedAtPolicy: V65_OBSERVABILITY_POLICY.id,
});

export const beforeAfterDelta = (before = {}, after = {}) => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...keys].map((key) => [key, round((after[key] ?? 0) - (before[key] ?? 0))]));
};

export const qualityLedger = ({ runtime = {}, p0 = [], evidence = [], deltas = {} } = {}) => ({
  policy: V65_OBSERVABILITY_POLICY.id,
  runtime,
  p0,
  evidenceScore: evidenceScore(evidence),
  evidence,
  deltas,
  green: p0.every((entry) => entry.pass) && runtime?.passed !== false,
});

export const digestObject = (value) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const runtimeSnapshot = ({ plan = {}, metrics = {}, evidence = [] } = {}) => ({
  schema: V65_OBSERVABILITY_POLICY.schema,
  digest: digestObject(plan),
  metrics,
  evidenceCount: evidence.length,
  cameras: V65_OBSERVABILITY_POLICY.evidenceCameras.map((camera) => camera.id),
});

export const compareSnapshots = (before, after) => ({
  samePlan: before?.digest === after?.digest,
  metricsDelta: beforeAfterDelta(before?.metrics || {}, after?.metrics || {}),
  evidenceDelta: (after?.evidenceCount || 0) - (before?.evidenceCount || 0),
});

export const validateLedger = (ledger) => {
  const errors = [];
  if (ledger?.policy !== V65_OBSERVABILITY_POLICY.id) errors.push('policy');
  if (typeof ledger?.green !== 'boolean') errors.push('green');
  if (ledger?.evidenceScore < 0 || ledger?.evidenceScore > 1) errors.push('evidence-score');
  for (const item of ledger?.p0 || []) if (typeof item.pass !== 'boolean') errors.push(`p0:${item.id}`);
  return { ok: errors.length === 0, errors };
};

export const routeSeverity = (issues = []) => issues.reduce((worst, issue) => {
  const order = V65_OBSERVABILITY_POLICY.severity;
  return order.indexOf(issue.severity) < order.indexOf(worst) ? issue.severity : worst;
}, 'P5');

export const buildRuntimeReport = (input = {}) => {
  const audit = auditRuntime(input);
  const p0 = p0Checklist(input);
  const ledger = qualityLedger({ runtime: audit, p0, evidence: input.evidence || [], deltas: input.deltas || {} });
  return {
    policy: V65_OBSERVABILITY_POLICY.id,
    audit,
    p0,
    ledger,
    highestSeverity: routeSeverity([...audit.issues, ...p0.filter((x) => !x.pass)]),
    digest: digestObject({ audit, p0, ledger }),
  };
};
