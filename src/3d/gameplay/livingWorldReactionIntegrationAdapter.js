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

function buildOwnerSnapshot(collections, result) {
  return freeze({
    actors: freeze(collectActors(collections)),
    director: result?.director ?? null,
    groups: result?.groups ?? null,
    reaction: result?.reaction ?? null,
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
    integrationTick += 1;
    return freeze({
      accepted: directorSnapshot?.accepted !== false && reactionResult?.accepted !== false,
      tick: integrationTick,
      director: directorSnapshot,
      groups: groupSnapshot,
      reaction: reactionResult,
      actorCount: actors.length,
      policyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
      ownerSnapshot: buildOwnerSnapshot(normalizedCollections, {
        director: directorSnapshot,
        groups: groupSnapshot,
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
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
