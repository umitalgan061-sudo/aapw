/**
 * Composition-only bridge for the existing Living World directors.
 *
 * The established Living World Director owns occupation/ecology/ambient event coordination;
 * the established Group Director owns group formation/threat directives. This adapter composes
 * those existing outputs with the new Reaction Runtime without moving ownership of controllers,
 * factions, navigation, combat, spawning, world events, materials or placement.
 */

import { createLivingWorldDirector } from './livingWorldDirectorRuntimeAdapter.js';
import { createGroupDirectorSnapshot } from './livingWorldGroupDirectorAdapter.js';
import {
  createLivingWorldReactionRuntime,
  LIVING_WORLD_REACTION_RUNTIME_POLICY,
} from './livingWorldReactionRuntime.js';

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

function normalizeCollection(collection) {
  return Array.isArray(collection) ? collection.slice(0, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors) : [];
}

function normalizeCollections(collections = {}) {
  return {
    npcs: normalizeCollection(collections.npcs),
    animals: normalizeCollection(collections.animals),
    creatures: normalizeCollection(collections.creatures),
    dragons: normalizeCollection(collections.dragons),
  };
}

function collectActors(collections) {
  const all = [];
  for (const key of ['npcs', 'animals', 'creatures', 'dragons']) {
    for (const actor of collections[key]) {
      if (all.length >= LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors) break;
      all.push(actor);
    }
  }
  return all;
}

function normalizeGroups(groups = []) {
  return Array.isArray(groups)
    ? groups.slice(0, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxGroups)
    : [];
}

function makeGroupRequests(groups, actors) {
  const actorById = new Map(actors.map((actor) => [asString(actor?.id ?? actor?.actorId), actor]));
  return normalizeGroups(groups).map((group, index) => {
    const members = Array.isArray(group?.memberIds)
      ? group.memberIds.map((id) => actorById.get(asString(id))).filter(Boolean)
      : Array.isArray(group?.members)
        ? group.members.slice(0, 32)
        : [];
    return {
      id: group?.id ?? `group-${index}`,
      members,
      threatPositions: Array.isArray(group?.threatPositions) ? group.threatPositions : [],
      seed: group?.seed ?? `${index}`,
      leaderId: group?.leaderId ?? null,
      cohesionRadiusMeters: group?.cohesionRadiusMeters,
      threatRadiusMeters: group?.threatRadiusMeters,
      separationMeters: group?.separationMeters,
    };
  });
}

function normalizeCompanionLinks(links = []) {
  if (!Array.isArray(links)) return [];
  return links.slice(0, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxCompanionLinks).map((link, index) => ({
    id: asString(link?.id, `companion-${index}`),
    actorId: asString(link?.actorId ?? link?.companionId, ''),
    targetId: asString(link?.targetId ?? link?.leaderId ?? link?.companionOf, ''),
    mode: asString(link?.mode, 'follow'),
    followDistanceMeters: Math.max(2, Math.min(18, finite(link?.followDistanceMeters, 6))),
  })).filter((link) => link.actorId && link.targetId && link.actorId !== link.targetId);
}

function distanceBetweenActors(actor, target) {
  const a = actor?.object3D?.position ?? actor?.position;
  const b = target?.object3D?.position ?? target?.position;
  if (!a || !b) return Infinity;
  const x = Number(a.x) - Number(b.x);
  const z = Number(a.z) - Number(b.z);
  return Number.isFinite(x) && Number.isFinite(z) ? Math.hypot(x, z) : Infinity;
}

function buildCompanionIntents(actors, links, reactionResult) {
  const actorById = new Map(actors.map((actor) => [asString(actor?.id ?? actor?.actorId), actor]));
  const reactionById = new Map((reactionResult?.results ?? []).map((entry) => [entry.actorId, entry]));
  return freeze(normalizeCompanionLinks(links).map((link) => {
    const companion = actorById.get(link.actorId);
    const target = actorById.get(link.targetId);
    const targetReaction = reactionById.get(link.targetId);
    const distanceMeters = distanceBetweenActors(companion, target);
    const phase = asString(targetReaction?.phase, 'patrol');
    const intent = phase === 'attack'
      ? 'assist-combat'
      : phase === 'flee'
        ? 'regroup'
        : ['detect', 'investigate', 'chase'].includes(phase)
          ? 'follow-contact'
          : 'follow';
    const positionAction = distanceMeters > link.followDistanceMeters ? 'close-rank' : 'hold-rank';
    return freeze({
      id: link.id,
      actorId: link.actorId,
      targetId: link.targetId,
      mode: link.mode,
      intent,
      positionAction,
      targetPhase: phase,
      targetLod: asString(targetReaction?.lod, 'unknown'),
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
      followDistanceMeters: link.followDistanceMeters,
    });
  }));
}

function buildGroupIntentSummary(groupSnapshot) {
  const groups = Array.isArray(groupSnapshot?.groups) ? groupSnapshot.groups : [];
  const intentCounts = new Map();
  for (const group of groups) {
    const intent = asString(group?.intent, 'roam');
    intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
  }
  const distribution = [...intentCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([intent, count]) => ({ intent, count }));
  const leaders = groups
    .map((group) => asString(group?.leader?.id, ''))
    .filter(Boolean)
    .sort();
  return freeze({
    groupCount: groups.length,
    acceptedGroups: Number(groupSnapshot?.acceptedGroups ?? 0),
    leaders: freeze(leaders),
    intentDistribution: freeze(distribution),
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

export function createLivingWorldReactionIntegration({
  seed = 0,
  clockSeconds = 0,
  services = {},
  directorOptions = {},
  lodThresholds,
} = {}) {
  const director = createLivingWorldDirector({
    ...directorOptions,
    seed,
    clockSeconds,
    worldEventPublisher: services?.worldEventsPublisher ?? directorOptions.worldEventPublisher,
  });
  const reaction = createLivingWorldReactionRuntime({
    actors: [],
    services,
    seed,
    clockSeconds,
    lodThresholds,
  });
  let disposed = false;
  let integrationTick = 0;

  function tick({
    deltaSeconds = 0,
    collections = {},
    occupations = [],
    faunaRequests = [],
    eventContext = {},
    eventTypes = [],
    groups = [],
    companions = [],
    playerPosition = null,
    reactionOptions = {},
  } = {}) {
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
    const reactionResult = reaction.tick({
      deltaSeconds: delta,
      actors,
      playerPosition,
      options: reactionOptions,
    });
    const groupSnapshot = createGroupDirectorSnapshot(makeGroupRequests(groups, actors));
    const groupIntentSummary = buildGroupIntentSummary(groupSnapshot);
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
      ownerSnapshot: buildOwnerSnapshot(normalizedCollections, {
        director: directorSnapshot,
        groups: groupSnapshot,
        groupIntentSummary,
        companions: companionIntents,
        reaction: reactionResult,
      }),
    });
  }

  function audit() {
    const directorAudit = typeof director.audit === 'function' ? director.audit() : { ok: true, errors: [] };
    const reactionAudit = reaction.audit();
    return freeze({
      ok: directorAudit.ok !== false && reactionAudit.ok === true,
      errors: freeze([...(directorAudit.errors ?? []), ...(reactionAudit.errors ?? [])]),
      policyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
    });
  }

  function snapshot() {
    return freeze({
      tick: integrationTick,
      director: typeof director.snapshot === 'function' ? director.snapshot() : null,
      reaction: reaction.snapshot(),
      policyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
    });
  }

  return {
    tick,
    audit,
    snapshot,
    dispose() {
      disposed = true;
      reaction.dispose();
      return true;
    },
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
