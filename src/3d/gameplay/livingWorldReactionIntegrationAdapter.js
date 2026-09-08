/** Composition-only bridge over the existing Living World + Group Director owners. */

import { createLivingWorldDirector } from './livingWorldDirectorRuntimeAdapter.js';
import { createGroupDirectorSnapshot } from './livingWorldGroupDirectorAdapter.js';
import { createLivingWorldReactionRuntime, LIVING_WORLD_REACTION_RUNTIME_POLICY } from './livingWorldReactionRuntime.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const asString = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_REACTION_INTEGRATION_POLICY = freeze({
  id: 'living-world-reaction-integration-2026-09-08-v1',
  reactionPolicyId: LIVING_WORLD_REACTION_RUNTIME_POLICY.id,
  maxCollections: 4,
  maxGroups: 24,
  maxActors: 128,
  maxEventsPerFrame: 6,
  maxCompanionLinks: 32,
});

function normalizeCollections(collections = {}) {
  const cap = LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors;
  return {
    npcs: Array.isArray(collections.npcs) ? collections.npcs.slice(0, cap) : [],
    animals: Array.isArray(collections.animals) ? collections.animals.slice(0, cap) : [],
    creatures: Array.isArray(collections.creatures) ? collections.creatures.slice(0, cap) : [],
    dragons: Array.isArray(collections.dragons) ? collections.dragons.slice(0, cap) : [],
  };
}

function collectActors(collections) {
  const actors = [];
  for (const key of ['npcs', 'animals', 'creatures', 'dragons']) {
    for (const actor of collections[key]) {
      if (actors.length >= LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors) return actors;
      actors.push(actor);
    }
  }
  return actors;
}

function makeGroupRequests(groups, actors) {
  const byId = new Map(actors.map((actor) => [asString(actor?.id ?? actor?.actorId), actor]));
  return (Array.isArray(groups) ? groups : []).slice(0, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxGroups).map((group, index) => ({
    id: group?.id ?? `group-${index}`,
    members: Array.isArray(group?.memberIds)
      ? group.memberIds.map((id) => byId.get(asString(id))).filter(Boolean)
      : Array.isArray(group?.members) ? group.members.slice(0, 32) : [],
    threatPositions: Array.isArray(group?.threatPositions) ? group.threatPositions.slice(0, 32) : [],
    seed: group?.seed ?? `${index}`,
    leaderId: group?.leaderId ?? null,
    cohesionRadiusMeters: group?.cohesionRadiusMeters,
    threatRadiusMeters: group?.threatRadiusMeters,
    separationMeters: group?.separationMeters,
  }));
}

function normalizeCompanionLinks(links) {
  return (Array.isArray(links) ? links : [])
    .slice(0, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxCompanionLinks)
    .map((link, index) => ({
      id: asString(link?.id, `companion-${index}`),
      actorId: asString(link?.actorId ?? link?.companionId),
      targetId: asString(link?.targetId ?? link?.leaderId ?? link?.companionOf),
      mode: asString(link?.mode, 'follow'),
      followDistanceMeters: Math.max(2, Math.min(18, finite(link?.followDistanceMeters, 6))),
    }))
    .filter((link) => link.actorId && link.targetId && link.actorId !== link.targetId);
}

function actorDistance(a, b) {
  const pa = a?.object3D?.position ?? a?.position;
  const pb = b?.object3D?.position ?? b?.position;
  if (!pa || !pb) return Infinity;
  const dx = Number(pa.x) - Number(pb.x);
  const dz = Number(pa.z) - Number(pb.z);
  return Number.isFinite(dx) && Number.isFinite(dz) ? Math.hypot(dx, dz) : Infinity;
}

function buildCompanionIntents(actors, links, reaction) {
  const byId = new Map(actors.map((actor) => [asString(actor?.id ?? actor?.actorId), actor]));
  const reactionById = new Map((reaction?.results ?? []).map((entry) => [entry.actorId, entry]));
  return freeze(normalizeCompanionLinks(links).map((link) => {
    const targetState = reactionById.get(link.targetId);
    const phase = asString(targetState?.phase, 'patrol');
    const distanceMeters = actorDistance(byId.get(link.actorId), byId.get(link.targetId));
    return freeze({
      id: link.id,
      actorId: link.actorId,
      targetId: link.targetId,
      mode: link.mode,
      intent: phase === 'attack' ? 'assist-combat' : phase === 'flee' ? 'regroup' : ['detect', 'investigate', 'chase'].includes(phase) ? 'follow-contact' : 'follow',
      positionAction: distanceMeters > link.followDistanceMeters ? 'close-rank' : 'hold-rank',
      targetPhase: phase,
      targetLod: asString(targetState?.lod, 'unknown'),
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
      followDistanceMeters: link.followDistanceMeters,
    });
  }));
}

function summarizeGroups(groupSnapshot) {
  const groups = Array.isArray(groupSnapshot?.groups) ? groupSnapshot.groups : [];
  const counts = new Map();
  const leaders = [];
  for (const group of groups) {
    const intent = asString(group?.intent, 'roam');
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
    if (group?.leader?.id != null) leaders.push(String(group.leader.id));
  }
  return freeze({
    groupCount: groups.length,
    acceptedGroups: Number(groupSnapshot?.acceptedGroups ?? 0),
    leaders: freeze(leaders.sort()),
    intentDistribution: freeze([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([intent, count]) => ({ intent, count }))),
  });
}

function buildOwnerSnapshot(collections, result) {
  return freeze({
    actors: freeze(collectActors(collections)),
    director: result?.director ?? null,
    groups: result?.groups ?? null,
    reaction: result?.reaction ?? null,
    groupIntentSummary: result?.groupIntentSummary ?? null,
    companions: result?.companions ?? null,
  });
}

export function createLivingWorldReactionIntegration({ seed = 0, clockSeconds = 0, services = {}, directorOptions = {}, lodThresholds } = {}) {
  const director = createLivingWorldDirector({
    ...directorOptions,
    seed,
    clockSeconds,
    worldEventPublisher: services?.worldEventsPublisher ?? directorOptions.worldEventPublisher,
  });
  const reaction = createLivingWorldReactionRuntime({ actors: [], services, seed, clockSeconds, lodThresholds });
  let disposed = false;
  let integrationTick = 0;

  function tick({ deltaSeconds = 0, collections = {}, occupations = [], faunaRequests = [], eventContext = {}, eventTypes = [], groups = [], companions = [], playerPosition = null, reactionOptions = {} } = {}) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed' });
    const normalizedCollections = normalizeCollections(collections);
    const actors = collectActors(normalizedCollections);
    const delta = Math.max(0, Math.min(0.25, finite(deltaSeconds)));
    const safeEvents = Array.isArray(eventTypes) ? eventTypes.slice(0, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxEventsPerFrame) : [];
    const directorSnapshot = director.tick({
      deltaSeconds: delta,
      collections: normalizedCollections,
      occupations: Array.isArray(occupations) ? occupations.slice(0, 128) : [],
      faunaRequests: Array.isArray(faunaRequests) ? faunaRequests.slice(0, 24) : [],
      eventContext: { ...eventContext, clockSeconds: finite(eventContext?.clockSeconds, clockSeconds) },
      eventTypes: safeEvents,
      playerPosition,
    });
    const reactionResult = reaction.tick({ deltaSeconds: delta, actors, playerPosition, options: reactionOptions });
    const groupSnapshot = createGroupDirectorSnapshot(makeGroupRequests(groups, actors));
    const groupIntentSummary = summarizeGroups(groupSnapshot);
    const companionIntents = buildCompanionIntents(actors, companions, reactionResult);
    integrationTick += 1;
    return freeze({
      accepted: directorSnapshot?.accepted !== false && reactionResult?.accepted !== false,
      tick: integrationTick,
      director: directorSnapshot,
      groups: groupSnapshot,
      groupIntentSummary,
      companions: companionIntents,
      reaction: reactionResult,
      actorCount: actors.length,
      policyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
      ownerSnapshot: buildOwnerSnapshot(normalizedCollections, { director: directorSnapshot, groups: groupSnapshot, groupIntentSummary, companions: companionIntents, reaction: reactionResult }),
    });
  }

  function audit() {
    const directorAudit = typeof director.audit === 'function' ? director.audit() : { ok: true, errors: [] };
    const reactionAudit = reaction.audit();
    return freeze({ ok: directorAudit.ok !== false && reactionAudit.ok === true, errors: freeze([...(directorAudit.errors ?? []), ...(reactionAudit.errors ?? [])]), policyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id });
  }

  function snapshot() {
    return freeze({ tick: integrationTick, director: typeof director.snapshot === 'function' ? director.snapshot() : null, reaction: reaction.snapshot(), policyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id });
  }

  return {
    tick,
    audit,
    snapshot,
    dispose() { disposed = true; reaction.dispose(); return true; },
    get disposed() { return disposed; },
  };
}

export function auditLivingWorldReactionIntegration(result) {
  const errors = [];
  if (!result || result.accepted !== true) errors.push('integration-not-accepted');
  if (result?.actorCount > LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors) errors.push('actor-overflow');
  if (result?.groups?.groupCount > LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxGroups) errors.push('group-overflow');
  if (result?.reaction?.actorCount > LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors) errors.push('reaction-actor-overflow');
  if (result?.companions?.length > LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxCompanionLinks) errors.push('companion-overflow');
  if (result?.groupIntentSummary?.groupCount !== result?.groups?.groupCount) errors.push('group-summary-mismatch');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
