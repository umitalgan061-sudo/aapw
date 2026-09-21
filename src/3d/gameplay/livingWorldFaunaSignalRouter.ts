// @ts-nocheck
/**
 * Signal router for fauna packs, herds and ambient groups.
 *
 * The router is intentionally read-only with respect to the world. It turns
 * existing perception/threat observations into bounded alert/regroup/activity
 * signals and leaves ActorRegistry, navigation, encounter, law and WorldEvent
 * owners responsible for mutation. It is safe for offscreen simulation because
 * all ordering is stable and every collection is capped.
 */
const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const text = (value, fallback = '') => value == null ? fallback : String(value);
const idOf = (value, fallback = '') => text(value, fallback).trim() || fallback;

export const FAUNA_SIGNAL_ROUTER_POLICY = freeze({
  id: 'safak-kartali-fauna-signal-router-2026-09-14-v1',
  deterministic: true,
  maxGroups: 64,
  maxMembers: 256,
  maxSignals: 96,
  propagationRadiusMeters: 85,
  regroupRadiusMeters: 32,
  signalTtlSeconds: 18,
  hearingConfidenceFloor: 0.35,
  visionConfidenceFloor: 0.55,
  farPropagationMeters: 340,
});

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function digest(value) {
  return stableHash(JSON.stringify(value ?? null)).toString(16).padStart(8, '0');
}

function vec(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
  return freeze({ x: Number(value.x), z: Number(value.z) });
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function stableRows(rows, key = 'id') {
  return [...rows].sort((a, b) => text(a?.[key]).localeCompare(text(b?.[key])));
}

function normalizeGroup(row, index) {
  return freeze({
    id: idOf(row?.id, `group-${index}`),
    species: text(row?.species, 'deer').toLowerCase(),
    position: vec(row?.position),
    memberIds: stableRows(Array.isArray(row?.memberIds) ? row.memberIds.map((id) => ({ id: idOf(id) })) : [], 'id').map((member) => member.id).slice(0, FAUNA_SIGNAL_ROUTER_POLICY.maxMembers),
    state: text(row?.state, 'roam').toLowerCase(),
    habitatId: idOf(row?.habitatId),
    groupRole: text(row?.groupRole, 'ambient').toLowerCase(),
  });
}

function normalizeMember(row, index) {
  return freeze({
    id: idOf(row?.id, `member-${index}`),
    groupId: idOf(row?.groupId),
    species: text(row?.species, 'deer').toLowerCase(),
    position: vec(row?.position),
    distanceMeters: Math.max(0, finite(row?.distanceMeters, Infinity)),
    lod: text(row?.lod, 'near').toLowerCase(),
    active: row?.active !== false,
  });
}

function normalizeObservation(row, index) {
  const kind = text(row?.kind, 'unknown').toLowerCase();
  const visible = row?.visible === true;
  const heard = row?.heard === true || kind === 'sound';
  const confidence = clamp(row?.confidence, 0, 1);
  return freeze({
    id: idOf(row?.id, `observation-${index}`),
    sourceId: idOf(row?.sourceId, 'unknown'),
    kind,
    visible,
    heard,
    hostile: row?.hostile !== false,
    confidence,
    ageSeconds: Math.max(0, finite(row?.ageSeconds, 0)),
    position: vec(row?.position),
    radiusMeters: Math.max(0, finite(row?.radiusMeters, 0)),
  });
}

function observationStrength(observation) {
  if (!observation || observation.ageSeconds > FAUNA_SIGNAL_ROUTER_POLICY.signalTtlSeconds) return 0;
  const modality = observation.visible ? 0.45 : observation.heard ? 0.3 : 0;
  const freshness = Math.max(0, 0.2 - observation.ageSeconds / 100);
  return clamp(observation.confidence * 0.5 + modality + freshness);
}

function signalKind(observation, group) {
  if (observation?.hostile && group?.species === 'wolf' && observationStrength(observation) >= FAUNA_SIGNAL_ROUTER_POLICY.visionConfidenceFloor) return 'pack-alert';
  if (observation?.hostile && group?.species === 'dragon' && observationStrength(observation) >= FAUNA_SIGNAL_ROUTER_POLICY.hearingConfidenceFloor) return 'territorial-alert';
  if (observation?.hostile && observation?.heard) return 'heard-threat';
  if (observation?.hostile) return 'threat';
  return 'ambient-interest';
}

function memberById(members) {
  return new Map(members.map((member) => [member.id, member]));
}

function groupMembers(group, members) {
  const map = memberById(members);
  return group.memberIds.map((id) => map.get(id)).filter(Boolean);
}

function propagationTargets(group, groups) {
  return groups.filter((candidate) => candidate.id !== group.id && candidate.position && group.position && distance(candidate.position, group.position) <= FAUNA_SIGNAL_ROUTER_POLICY.propagationRadiusMeters);
}

function makeSignal(group, observation, targetGroupId = group.id) {
  const kind = signalKind(observation, group);
  return freeze({
    id: `signal-${digest({ group: group.id, observation: observation.id, target: targetGroupId })}`,
    sourceGroupId: group.id,
    targetGroupId,
    sourceId: observation.sourceId,
    kind,
    confidence: observationStrength(observation),
    radiusMeters: observation.radiusMeters || FAUNA_SIGNAL_ROUTER_POLICY.propagationRadiusMeters,
    targetPosition: observation.position,
    expiresInSeconds: Math.max(0, FAUNA_SIGNAL_ROUTER_POLICY.signalTtlSeconds - observation.ageSeconds),
    hearing: observation.heard,
    vision: observation.visible,
    deterministicKey: digest({ group: group.id, target: targetGroupId, source: observation.sourceId, kind }),
  });
}

function memberDirective(member, signal, group) {
  const lod = member.lod;
  const offscreen = lod === 'far' || lod === 'offscreen' || lod === 'culled';
  const state = signal.kind === 'pack-alert' || signal.kind === 'territorial-alert' || signal.kind === 'threat' || signal.kind === 'heard-threat' ? 'flee' : 'investigate';
  return freeze({
    id: member.id,
    groupId: group.id,
    species: member.species,
    state,
    targetId: signal.sourceId,
    signalId: signal.id,
    lod,
    simulatedOffscreen: offscreen,
    tickIntervalSeconds: offscreen ? 5 : lod === 'far' ? 2 : lod === 'distant' ? 0.75 : 0,
    destination: signal.targetPosition || group.position,
    speedMultiplier: state === 'flee' ? 1.25 : 0.7,
  });
}

export function routeFaunaSignals({ groups = [], members = [], observations = [], seed = 'aapw', tick = 0 } = {}) {
  const safeGroups = stableRows(groups.slice(0, FAUNA_SIGNAL_ROUTER_POLICY.maxGroups).map(normalizeGroup));
  const safeMembers = stableRows(members.slice(0, FAUNA_SIGNAL_ROUTER_POLICY.maxMembers).map(normalizeMember));
  const safeObservations = stableRows(observations.slice(0, FAUNA_SIGNAL_ROUTER_POLICY.maxSignals).map(normalizeObservation));
  const signals = [];
  const updates = [];
  const events = [];
  for (const group of safeGroups) {
    const localMembers = groupMembers(group, safeMembers);
    const relevant = safeObservations.filter((observation) => observationStrength(observation) > 0 && (!observation.position || !group.position || distance(observation.position, group.position) <= FAUNA_SIGNAL_ROUTER_POLICY.propagationRadiusMeters));
    for (const observation of relevant.slice(0, 4)) {
      const localSignal = makeSignal(group, observation);
      signals.push(localSignal);
      updates.push(...localMembers.map((member) => memberDirective(member, localSignal, group)));
      for (const target of propagationTargets(group, safeGroups).slice(0, 4)) {
        const propagated = makeSignal(group, observation, target.id);
        signals.push(propagated);
        const targetMembers = groupMembers(target, safeMembers);
        updates.push(...targetMembers.map((member) => memberDirective(member, propagated, target)));
      }
    }
    if (!relevant.length && localMembers.length) {
      updates.push(...localMembers.map((member) => freeze({ id: member.id, groupId: group.id, species: member.species, state: group.state, targetId: '', signalId: '', lod: member.lod, simulatedOffscreen: member.lod === 'far' || member.lod === 'offscreen', tickIntervalSeconds: member.lod === 'near' ? 0 : member.lod === 'distant' ? 0.75 : 2, destination: group.position, speedMultiplier: group.state === 'rest' ? 0 : 0.7 })));
    }
  }
  const uniqueSignals = stableRows(signals, 'id').filter((signal, index, rows) => index === 0 || signal.id !== rows[index - 1].id).slice(0, FAUNA_SIGNAL_ROUTER_POLICY.maxSignals);
  for (const signal of uniqueSignals.filter((entry) => entry.kind !== 'ambient-interest').slice(0, 8)) {
    events.push(freeze({ type: signal.kind === 'territorial-alert' ? 'fauna-territorial-alert' : 'fauna-pack-alert', signalId: signal.id, sourceGroupId: signal.sourceGroupId, targetGroupId: signal.targetGroupId, sourceId: signal.sourceId, radiusMeters: signal.radiusMeters, deterministicKey: signal.deterministicKey }));
  }
  const result = { policy: FAUNA_SIGNAL_ROUTER_POLICY.id, deterministic: true, seed: text(seed), tick: Math.max(0, Math.floor(finite(tick))), signals: uniqueSignals, updates: stableRows(updates, 'id'), events: stableRows(events, 'deterministicKey') };
  return freeze({ ...result, digest: digest(result) });
}

export function applyFaunaSignals(plan, owners = {}) {
  const updated = [];
  const emitted = [];
  for (const update of plan?.updates || []) {
    if (typeof owners.updateActor === 'function') { owners.updateActor(update); updated.push(update.id); }
  }
  for (const event of plan?.events || []) {
    if (typeof owners.emitWorldEvent === 'function') { owners.emitWorldEvent(event); emitted.push(event.deterministicKey); }
  }
  return freeze({ updated: freeze(updated), emitted: freeze(emitted), delegated: updated.length + emitted.length, digest: digest({ updated, emitted }) });
}

export function auditFaunaSignals(plan) {
  const errors = [];
  if (!plan?.deterministic) errors.push('non-deterministic');
  if ((plan?.signals || []).length > FAUNA_SIGNAL_ROUTER_POLICY.maxSignals) errors.push('signal-budget-overflow');
  if ((plan?.updates || []).length > FAUNA_SIGNAL_ROUTER_POLICY.maxMembers * 4) errors.push('update-budget-overflow');
  const ids = new Set();
  for (const signal of plan?.signals || []) {
    if (!signal.id || ids.has(signal.id)) errors.push('duplicate-signal');
    ids.add(signal.id);
    if (!Number.isFinite(signal.confidence)) errors.push('non-finite-confidence');
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(plan) });
}
