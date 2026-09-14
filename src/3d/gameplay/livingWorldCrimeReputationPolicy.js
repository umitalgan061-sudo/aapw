/**
 * Şafak Kartalı — crime / reputation reaction projection.
 *
 * Pure adapter policy over caller-owned law, wanted, faction and reputation services.
 * It never creates a second crime ledger; incidents are normalized into bounded event intents,
 * then delegated to the existing law/world-event owners by the director.
 */

const freeze = (value) => Object.freeze(value);
const num = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, num(v, lo)));
const str = (v, f = '') => v == null || v === '' ? f : String(v);

export const CRIME_REPUTATION_POLICY = freeze({
  id: 'safak-kartali-crime-reputation-2026-09-14-v1',
  deterministic: true,
  maxIncidentsPerTick: 8,
  maxWitnessesPerIncident: 16,
  maxWantedScore: 100,
  witnessDecaySeconds: 18,
  suspicionHalfLifeSeconds: 45,
  bountyScale: 1.35,
  reputationImpactScale: 0.75,
  hostileThreshold: 0.68,
  arrestThreshold: 0.62,
});

const SEVERITY_BANDS = freeze([
  freeze({ id: 'minor', min: 0, max: 0.2, wanted: 8, reputation: -2 }),
  freeze({ id: 'moderate', min: 0.2, max: 0.45, wanted: 20, reputation: -6 }),
  freeze({ id: 'major', min: 0.45, max: 0.7, wanted: 45, reputation: -14 }),
  freeze({ id: 'severe', min: 0.7, max: 0.9, wanted: 70, reputation: -28 }),
  freeze({ id: 'critical', min: 0.9, max: 1.01, wanted: 100, reputation: -50 }),
]);

const RELATIONS = freeze(['allied', 'friendly', 'neutral', 'suspicious', 'hostile']);

function hash(value) {
  let h = 2166136261;
  for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function round(v, d = 5) { const p = 10 ** d; return Math.round(num(v) * p) / p; }
function normalizeId(v) { return str(v).trim(); }

export function severityBand(severity) { const s = clamp(severity); return SEVERITY_BANDS.find((band) => s >= band.min && s < band.max)?.id ?? 'critical'; }
export function bandForSeverity(severity) { return SEVERITY_BANDS.find((band) => severity >= band.min && severity < band.max) ?? SEVERITY_BANDS[0]; }

export function normalizeCrimeIncident(incident = {}, index = 0) {
  const severity = clamp(incident.severity ?? incident.crimeSeverity);
  const witnesses = Array.isArray(incident.witnesses) ? incident.witnesses.slice(0, CRIME_REPUTATION_POLICY.maxWitnessesPerIncident).map((w) => normalizeId(w)).filter(Boolean) : [];
  return freeze({
    id: normalizeId(incident.id) || `crime-${index}`,
    actorId: normalizeId(incident.actorId ?? incident.offenderId),
    factionId: normalizeId(incident.factionId),
    lawId: normalizeId(incident.lawId, 'default'),
    type: normalizeId(incident.type, 'unknown'),
    severity: round(severity),
    witnesses: freeze([...new Set(witnesses)]),
    public: incident.public !== false,
    locationId: normalizeId(incident.locationId),
    timestamp: Math.max(0, num(incident.timestamp)),
    targetFactionId: normalizeId(incident.targetFactionId),
  });
}

export function calculateWantedDelta(incident) {
  const item = normalizeCrimeIncident(incident);
  const band = bandForSeverity(item.severity);
  const witnessFactor = Math.min(2, 1 + item.witnesses.length * 0.08);
  return round(Math.min(CRIME_REPUTATION_POLICY.maxWantedScore, band.wanted * witnessFactor));
}

export function calculateReputationImpact(incident, relationWeight = 1) {
  const item = normalizeCrimeIncident(incident);
  const band = bandForSeverity(item.severity);
  return round(band.reputation * clamp(relationWeight, 0, 2) * CRIME_REPUTATION_POLICY.reputationImpactScale);
}

export function calculateBounty(incident, economyMultiplier = 1) {
  const item = normalizeCrimeIncident(incident);
  return round(calculateWantedDelta(item) * CRIME_REPUTATION_POLICY.bountyScale * Math.max(0, num(economyMultiplier, 1)));
}

export function ageWantedScore(wantedScore, deltaSeconds) {
  const score = clamp(wantedScore, 0, CRIME_REPUTATION_POLICY.maxWantedScore);
  const delta = Math.max(0, num(deltaSeconds));
  const decay = delta / Math.max(1, CRIME_REPUTATION_POLICY.witnessDecaySeconds);
  return round(Math.max(0, score - score * decay * 0.12));
}

export function suspicionDecay(suspicion, deltaSeconds) {
  const value = clamp(suspicion);
  const delta = Math.max(0, num(deltaSeconds));
  const factor = Math.pow(0.5, delta / Math.max(1, CRIME_REPUTATION_POLICY.suspicionHalfLifeSeconds));
  return round(value * factor);
}

export function relationFromReputation(reputation, diplomacy = 'neutral', wantedScore = 0) {
  const rep = num(reputation, 0);
  const wanted = clamp(wantedScore, 0, 100);
  const dip = str(diplomacy, 'neutral').toLowerCase();
  if (dip === 'war' || dip === 'hostile' || wanted >= 70 || rep <= -60) return 'hostile';
  if (dip === 'allied' && rep >= 45) return 'allied';
  if (rep >= 25) return 'friendly';
  if (rep <= -20 || wanted >= 30) return 'suspicious';
  return 'neutral';
}

export function actionFromRelation({ relation = 'neutral', wantedScore = 0, evidence = 0, actorRole = 'guard' } = {}) {
  const rel = RELATIONS.includes(relation) ? relation : 'neutral';
  const wanted = clamp(wantedScore, 0, 100) / 100;
  const confidence = clamp(evidence);
  if (rel === 'hostile' || (wanted >= CRIME_REPUTATION_POLICY.hostileThreshold && confidence >= .45)) return 'attack-or-pursue';
  if ((rel === 'suspicious' || wanted >= .45) && confidence >= CRIME_REPUTATION_POLICY.arrestThreshold) return actorRole === 'guard' ? 'arrest' : 'challenge';
  if (rel === 'friendly' || rel === 'allied') return 'assist';
  if (confidence >= .5) return 'observe';
  return 'ignore';
}

export function mergeCrimeIncidents(incidents = []) {
  const byActor = new Map();
  for (const incident of Array.isArray(incidents) ? incidents.slice(0, CRIME_REPUTATION_POLICY.maxIncidentsPerTick) : []) {
    const item = normalizeCrimeIncident(incident);
    if (!item.actorId) continue;
    const prior = byActor.get(item.actorId);
    if (!prior) byActor.set(item.actorId, item);
    else byActor.set(item.actorId, freeze({ ...prior, severity: Math.max(prior.severity, item.severity), witnesses: freeze([...new Set([...prior.witnesses, ...item.witnesses])]), public: prior.public || item.public, timestamp: Math.max(prior.timestamp, item.timestamp) }));
  }
  return freeze([...byActor.values()].sort((a, b) => a.actorId.localeCompare(b.actorId)));
}

export function buildWantedProjection(incident, existing = {}) {
  const item = normalizeCrimeIncident(incident);
  const previous = clamp(existing.wantedScore, 0, 100);
  const next = Math.min(CRIME_REPUTATION_POLICY.maxWantedScore, previous + calculateWantedDelta(item));
  return freeze({ actorId: item.actorId, factionId: item.factionId, wantedBefore: round(previous), wantedAfter: round(next), bountyDelta: calculateBounty(item), reputationDelta: calculateReputationImpact(item), band: severityBand(item.severity), witnessCount: item.witnesses.length });
}

export function buildWitnessPropagation(incident, witnessReputation = {}) {
  const item = normalizeCrimeIncident(incident);
  const severity = item.severity;
  const rows = [];
  for (const witnessId of item.witnesses) {
    const confidence = clamp((num(witnessReputation[witnessId], 0) + severity) / 2);
    rows.push(freeze({ witnessId, offenderId: item.actorId, confidence: round(confidence), memoryBand: confidence >= .7 ? 'certain' : confidence >= .45 ? 'suspicious' : 'uncertain', reportable: item.public && confidence >= .4 }));
  }
  return freeze(rows);
}

export function buildCrimeWorldEvent(incident, context = {}) {
  const item = normalizeCrimeIncident(incident);
  const projection = buildWantedProjection(item, context);
  return freeze({ type: 'crime-updated', incidentId: item.id, actorId: item.actorId, factionId: item.factionId, severity: item.severity, wanted: projection.wantedAfter, bountyDelta: projection.bountyDelta, reputationDelta: projection.reputationDelta, locationId: item.locationId, deterministicKey: hash(`${context.seed ?? 0}|${item.id}|${item.timestamp}`).toString(16).padStart(8, '0') });
}

export function processCrimeBatch(incidents, context = {}) {
  const merged = mergeCrimeIncidents(incidents);
  const rows = merged.map((incident) => freeze({ incident, projection: buildWantedProjection(incident, context.wantedByActor?.[incident.actorId]), witnessPropagation: buildWitnessPropagation(incident, context.witnessReputation), event: buildCrimeWorldEvent(incident, context) }));
  return freeze({ rows: freeze(rows), count: rows.length, fingerprint: hash(JSON.stringify(rows)).toString(16).padStart(8, '0') });
}

export function auditCrimeProjection(projection) {
  const errors = [];
  if (num(projection?.count) > CRIME_REPUTATION_POLICY.maxIncidentsPerTick) errors.push('incident-overflow');
  for (const row of projection?.rows ?? []) {
    if (!row?.incident?.actorId) errors.push('missing-offender');
    if (num(row?.projection?.wantedAfter) > CRIME_REPUTATION_POLICY.maxWantedScore) errors.push('wanted-overflow');
  }
  return freeze({ ok: !errors.length, errors: freeze(errors), fingerprint: hash(JSON.stringify(projection ?? null)).toString(16).padStart(8, '0') });
}

export function relationMatrix(reputationByFaction = {}, diplomacyByFaction = {}, wantedByFaction = {}) {
  const ids = [...new Set([...Object.keys(reputationByFaction), ...Object.keys(diplomacyByFaction), ...Object.keys(wantedByFaction)])].sort();
  const matrix = {};
  for (const a of ids) {
    matrix[a] = {};
    for (const b of ids) matrix[a][b] = relationFromReputation(reputationByFaction[a]?.[b], diplomacyByFaction[a]?.[b], wantedByFaction[a]?.[b]);
  }
  return freeze(matrix);
}

export function classifyWanted(wantedScore) { const score = clamp(wantedScore, 0, 100); return score >= 75 ? 'fugitive' : score >= 50 ? 'wanted' : score >= 25 ? 'flagged' : 'clear'; }
export function wantedPriority(wantedScore, role = 'citizen') { const score = clamp(wantedScore, 0, 100) / 100; const roleBoost = role === 'guard' ? .3 : role === 'bounty-hunter' ? .45 : 0; return round(clamp(score + roleBoost)); }
export function deterministicCrimeFingerprint(input, seed = 0) { return hash(`${seed}|${JSON.stringify(input ?? null)}`).toString(16).padStart(8, '0'); }
export function normalizeWantedState(state = {}) { return freeze({ wantedScore: round(clamp(state.wantedScore, 0, 100)), bounty: Math.max(0, round(num(state.bounty))), classification: classifyWanted(state.wantedScore), lastCrimeSeconds: Math.max(0, num(state.lastCrimeSeconds)), witnessCount: Math.max(0, Math.floor(num(state.witnessCount))) }); }
export function combineReputation(base, delta, factionTrust = 1) { return round(Math.max(-100, Math.min(100, num(base) + num(delta) * clamp(factionTrust, 0, 2)))); }
export function clampIncidentBatch(incidents) { return freeze((Array.isArray(incidents) ? incidents : []).slice(0, CRIME_REPUTATION_POLICY.maxIncidentsPerTick)); }
export function shouldReportCrime({ publicIncident = true, severity = 0, witnesses = 0, witnessConfidence = .5 } = {}) { return publicIncident && (severity >= .35 || (witnesses > 0 && witnessConfidence >= .5)); }
