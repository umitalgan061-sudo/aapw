/**
 * Living World Companion Runtime Adapter
 *
 * Composition-only runtime layer over the existing Living World reaction/integration owners.
 * It turns already-authored companion links into bounded follow/assist/regroup/hold commands,
 * delegates navigation/combat/event side effects to injected owner services, and keeps no
 * scene, spawn, persistence, ActorRegistry, or combat damage authority.
 *
 * This is intentionally not a second companion/NPC framework:
 * - actor membership remains caller/ActorRegistry-owned;
 * - perception/reaction remains livingWorldReactionIntegrationAdapter-owned;
 * - navigation remains the injected navigation owner;
 * - damage/combat remains the injected combat owner;
 * - world-event publication remains the injected world-event owner.
 *
 * The adapter adds the missing runtime application layer between the existing companion intent
 * projection and those existing owners. It is DOM/THREE-free so it is safe for PWA/headless tests.
 */

import {
  createLivingWorldReactionIntegration,
  LIVING_WORLD_REACTION_INTEGRATION_POLICY,
} from './livingWorldReactionIntegrationAdapter.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 1) => Math.max(0.0001, finite(value, fallback));
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);

const COMPANION_MODES = freeze([
  'follow',
  'escort',
  'assist',
  'regroup',
  'hold',
]);

const COMPANION_STATES = freeze([
  'linked',
  'following',
  'assisting',
  'regrouping',
  'holding',
  'recovering',
  'detached',
]);

const LOD_LEVELS = freeze(['near', 'distant', 'far', 'culled']);
const MAX_HISTORY = 8;

export const LIVING_WORLD_COMPANION_RUNTIME_POLICY = freeze({
  id: 'living-world-companion-runtime-2026-09-10-v1',
  deterministic: true,
  maxLinks: 32,
  maxActors: 128,
  maxGroups: 24,
  maxNavigationRequests: 8,
  maxCombatRequests: 8,
  maxEventPublishes: 6,
  maxHistoryPerLink: 8,
  maxDeltaSeconds: 0.25,
  nearRadiusMeters: 45,
  distantRadiusMeters: 120,
  farRadiusMeters: 260,
  followDistanceMinMeters: 2,
  followDistanceMaxMeters: 18,
  teleportRecoveryDistanceMeters: 36,
  staleTargetSeconds: 2.5,
  targetPredictionSeconds: 0.65,
  arrivalToleranceMeters: 1.25,
  regroupRadiusMeters: 20,
  emergencyRadiusMeters: 36,
  maxFormationSpreadMeters: 18,
  maxDetourMeters: 12,
  minNavigationIntervalSeconds: 0.15,
  minAssistIntervalSeconds: 0.25,
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

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
  return stableHash(stableStringify(value)).toString(16).padStart(8, '0');
}

function readPosition(actor) {
  const p = actor?.object3D?.position ?? actor?.position ?? actor?.transform?.position;
  if (!p) return null;
  const x = Number(p.x);
  const z = Number(p.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return freeze({ x, z });
}

function readVelocity(actor) {
  const v = actor?.velocity ?? actor?.movement?.velocity ?? actor?.object3D?.userData?.velocity;
  if (!v) return freeze({ x: 0, z: 0 });
  const x = finite(v.x);
  const z = finite(v.z);
  return freeze({ x, z });
}

function distance2d(a, b) {
  if (!a || !b) return Infinity;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  return Number.isFinite(dx) && Number.isFinite(dz) ? Math.hypot(dx, dz) : Infinity;
}

function normalizeLod(distanceMeters) {
  const distance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : Infinity;
  if (distance <= LIVING_WORLD_COMPANION_RUNTIME_POLICY.nearRadiusMeters) return 'near';
  if (distance <= LIVING_WORLD_COMPANION_RUNTIME_POLICY.distantRadiusMeters) return 'distant';
  if (distance <= LIVING_WORLD_COMPANION_RUNTIME_POLICY.farRadiusMeters) return 'far';
  return 'culled';
}

function lodTickInterval(lod) {
  if (lod === 'near') return 0;
  if (lod === 'distant') return 0.5;
  if (lod === 'far') return 1.5;
  return Infinity;
}

function normalizeMode(mode) {
  const candidate = asId(mode, 'follow').toLowerCase();
  return COMPANION_MODES.includes(candidate) ? candidate : 'follow';
}

function normalizeState(state) {
  const candidate = asId(state, 'linked').toLowerCase();
  return COMPANION_STATES.includes(candidate) ? candidate : 'linked';
}

function normalizePriority(value) {
  return clamp(Math.round(finite(value, 0)), -100, 100);
}

function normalizeFollowDistance(value) {
  return clamp(
    finite(value, 6),
    LIVING_WORLD_COMPANION_RUNTIME_POLICY.followDistanceMinMeters,
    LIVING_WORLD_COMPANION_RUNTIME_POLICY.followDistanceMaxMeters,
  );
}

function normalizeCompanionLinks(links) {
  const rows = Array.isArray(links) ? links : [];
  const dedupe = new Set();
  const normalized = [];
  for (let index = 0; index < Math.min(rows.length, LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxLinks); index += 1) {
    const link = rows[index] ?? {};
    const id = asId(link.id, `companion-${index}`);
    if (dedupe.has(id)) continue;
    const actorId = asId(link.actorId ?? link.companionId);
    const targetId = asId(link.targetId ?? link.leaderId ?? link.companionOf);
    if (!actorId || !targetId || actorId === targetId) continue;
    dedupe.add(id);
    normalized.push(freeze({
      id,
      actorId,
      targetId,
      mode: normalizeMode(link.mode),
      priority: normalizePriority(link.priority),
      followDistanceMeters: normalizeFollowDistance(link.followDistanceMeters),
      recoverDistanceMeters: clamp(
        finite(link.recoverDistanceMeters, 24),
        LIVING_WORLD_COMPANION_RUNTIME_POLICY.followDistanceMinMeters,
        LIVING_WORLD_COMPANION_RUNTIME_POLICY.teleportRecoveryDistanceMeters,
      ),
      role: asId(link.role, 'companion'),
      settlementId: asId(link.settlementId),
      persistent: link.persistent !== false,
      seed: asId(link.seed, id),
    }));
  }
  normalized.sort((a, b) =>
    b.priority - a.priority ||
    a.actorId.localeCompare(b.actorId) ||
    a.targetId.localeCompare(b.targetId) ||
    a.id.localeCompare(b.id)
  );
  return freeze(normalized);
}

function createLinkState(link) {
  return {
    id: link.id,
    state: 'linked',
    elapsedSeconds: 0,
    staleSeconds: 0,
    lastTargetPosition: null,
    lastCommandPosition: null,
    lastNavigationSeconds: -Infinity,
    lastAssistSeconds: -Infinity,
    lastEventSeconds: -Infinity,
    recoveryCount: 0,
    transitionCount: 0,
    history: [],
  };
}

function addHistory(state, from, to, reason) {
  if (from === to) return;
  state.transitionCount += 1;
  state.history = [
    ...state.history,
    freeze({
      from,
      to,
      reason: asId(reason, 'state-transition'),
      atSeconds: state.elapsedSeconds,
    }),
  ].slice(-LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxHistoryPerLink);
}

function setState(state, next, reason) {
  const normalized = normalizeState(next);
  if (state.state !== normalized) {
    const previous = state.state;
    addHistory(state, previous, normalized, reason);
    state.state = normalized;
  }
}

function actorIdOf(actor, fallbackIndex = 0) {
  return asId(actor?.id ?? actor?.actorId ?? actor?.object3D?.uuid ?? actor?.object3D?.name, `actor-${fallbackIndex}`);
}

function buildActorMap(collections) {
  const map = new Map();
  for (const key of ['npcs', 'animals', 'creatures', 'dragons']) {
    const rows = Array.isArray(collections?.[key]) ? collections[key] : [];
    for (const actor of rows) {
      const id = actorIdOf(actor);
      if (!map.has(id)) map.set(id, actor);
    }
  }
  return map;
}

function buildReactionMap(reactionSnapshot) {
  const result = new Map();
  const rows = Array.isArray(reactionSnapshot?.results) ? reactionSnapshot.results : [];
  for (const row of rows) {
    const id = asId(row?.actorId);
    if (id) result.set(id, row);
  }
  return result;
}

function readTargetLod(target, playerPosition) {
  if (!playerPosition) return 'near';
  return normalizeLod(distance2d(readPosition(target), playerPosition));
}

function projectedTargetPosition(target, state) {
  const current = readPosition(target);
  if (!current) return null;
  const velocity = readVelocity(target);
  const horizon = clamp(
    finite(target?.companionPredictionSeconds, LIVING_WORLD_COMPANION_RUNTIME_POLICY.targetPredictionSeconds),
    0,
    1.25,
  );
  const projected = {
    x: current.x + velocity.x * horizon,
    z: current.z + velocity.z * horizon,
  };
  return freeze({
    x: projected.x,
    z: projected.z,
    source: 'target-velocity',
    horizonSeconds: horizon,
    previous: state.lastTargetPosition,
  });
}

function slotVector(index, total, seed) {
  const slots = Math.max(1, total);
  const numericSeed = stableHash(`${seed}:${index}:${slots}`);
  const phase = (numericSeed % 3600) / 3600 * Math.PI * 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const ring = Math.floor(index / 6) + 1;
  const angle = phase + index * golden;
  const radius = Math.min(
    LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxFormationSpreadMeters,
    3 + ring * 2.75,
  );
  return freeze({
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
  });
}

function desiredFollowPoint(targetPosition, followDistanceMeters, index, total, seed) {
  if (!targetPosition) return null;
  const slot = slotVector(index, total, seed);
  const length = Math.hypot(slot.x, slot.z) || 1;
  const scale = followDistanceMeters / length;
  return freeze({
    x: targetPosition.x + slot.x * scale,
    z: targetPosition.z + slot.z * scale,
  });
}

function computeFormationLane(link, normalizedLinks, actorMap, targetPosition) {
  const siblings = normalizedLinks.filter((candidate) =>
    candidate.targetId === link.targetId && candidate.actorId !== link.actorId
  );
  const ordered = [...siblings, link].sort((a, b) => a.actorId.localeCompare(b.actorId));
  const index = Math.max(0, ordered.findIndex((candidate) => candidate.id === link.id));
  const desired = desiredFollowPoint(
    targetPosition,
    link.followDistanceMeters,
    index,
    ordered.length,
    link.seed,
  );
  const collisions = [];
  if (desired) {
    for (const sibling of ordered) {
      if (sibling.id === link.id) continue;
      const siblingActor = actorMap.get(sibling.actorId);
      const siblingPosition = readPosition(siblingActor);
      if (!siblingPosition) continue;
      if (distance2d(desired, siblingPosition) < LIVING_WORLD_COMPANION_RUNTIME_POLICY.followDistanceMinMeters) {
        collisions.push(sibling.actorId);
      }
    }
  }
  return freeze({
    desired,
    index,
    total: ordered.length,
    collisions: freeze(collisions.sort()),
  });
}

function navKindFor(mode, state, distanceMeters, formation) {
  if (state === 'regrouping') return 'regroup';
  if (state === 'recovering') return 'recover';
  if (mode === 'hold') return 'hold';
  if (mode === 'assist') return distanceMeters > LIVING_WORLD_COMPANION_RUNTIME_POLICY.arrivalToleranceMeters ? 'assist-follow' : 'assist-hold';
  if (formation?.collisions?.length) return 'formation-reposition';
  return distanceMeters > LIVING_WORLD_COMPANION_RUNTIME_POLICY.arrivalToleranceMeters ? 'follow' : 'hold';
}

function relationSignals(reactionEntry) {
  return freeze({
    phase: asId(reactionEntry?.phase, 'patrol'),
    targetId: asId(reactionEntry?.targetId),
    hostile: reactionEntry?.relation?.hostile === true,
    reportable: reactionEntry?.relation?.reportable === true,
    wanted: clamp(finite(reactionEntry?.relation?.wanted, 0), 0, 100),
    reputation: clamp(finite(reactionEntry?.relation?.reputation, 0), -100, 100),
    diplomaticRelation: asId(reactionEntry?.relation?.diplomaticRelation, 'unknown'),
  });
}

function chooseCompanionState(link, follower, target, reactionEntry, state, playerPosition) {
  const followerPosition = readPosition(follower);
  const targetPosition = readPosition(target);
  if (!follower || !target || !followerPosition || !targetPosition) {
    return freeze({ nextState: 'recovering', reason: 'target-or-follower-position-unavailable' });
  }

  const relation = relationSignals(reactionEntry);
  const distance = distance2d(followerPosition, targetPosition);
  const targetLod = readTargetLod(target, playerPosition);

  if (targetLod === 'culled') {
    return freeze({ nextState: 'recovering', reason: 'target-outside-population-radius' });
  }

  if (distance > LIVING_WORLD_COMPANION_RUNTIME_POLICY.teleportRecoveryDistanceMeters) {
    return freeze({ nextState: 'recovering', reason: 'companion-link-broken' });
  }

  if (relation.phase === 'flee' || link.mode === 'regroup') {
    return freeze({ nextState: 'regrouping', reason: 'target-or-link-regroup' });
  }

  if (relation.phase === 'attack' && ['assist', 'escort', 'follow'].includes(link.mode)) {
    return freeze({ nextState: 'assisting', reason: 'target-in-combat' });
  }

  if (link.mode === 'hold') {
    return freeze({ nextState: 'holding', reason: 'hold-mode' });
  }

  if (distance <= Math.max(
    LIVING_WORLD_COMPANION_RUNTIME_POLICY.arrivalToleranceMeters,
    link.followDistanceMeters * 0.65,
  )) {
    return freeze({ nextState: 'holding', reason: 'within-follow-envelope' });
  }

  return freeze({ nextState: 'following', reason: 'outside-follow-envelope' });
}

function buildNavigationRequest(link, follower, target, state, index, total, playerPosition) {
  const followerPosition = readPosition(follower);
  const targetPosition = projectedTargetPosition(target, state);
  if (!followerPosition || !targetPosition) return null;

  const distanceMeters = distance2d(followerPosition, targetPosition);
  const formation = computeFormationLane(link, state.normalizedLinks, state.actorMap, targetPosition);
  const desired = formation.desired ?? targetPosition;
  const targetLod = readTargetLod(target, playerPosition);

  return freeze({
    id: `${link.id}:navigation`,
    actorId: link.actorId,
    targetId: link.targetId,
    kind: navKindFor(link.mode, state.linkState, distanceMeters, formation),
    destination: desired,
    targetPosition,
    distanceMeters,
    followDistanceMeters: link.followDistanceMeters,
    targetLod,
    formationIndex: index,
    formationSize: total,
    formationCollisions: formation.collisions,
    maxDetourMeters: LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxDetourMeters,
    preserveSettlement: Boolean(link.settlementId),
    settlementId: link.settlementId,
    reason: state.linkState,
    owner: 'existing-navigation-service',
  });
}

function buildAssistRequest(link, follower, target, reactionEntry, state) {
  const phase = asId(reactionEntry?.phase, 'patrol');
  if (phase !== 'attack') return null;
  const followerPosition = readPosition(follower);
  const targetPosition = readPosition(target);
  if (!followerPosition || !targetPosition) return null;
  const distanceMeters = distance2d(followerPosition, targetPosition);
  if (distanceMeters > LIVING_WORLD_COMPANION_RUNTIME_POLICY.emergencyRadiusMeters) {
    return freeze({
      id: `${link.id}:assist`,
      actorId: link.actorId,
      targetId: link.targetId,
      kind: 'close-before-assist',
      distanceMeters,
      maxDistanceMeters: LIVING_WORLD_COMPANION_RUNTIME_POLICY.emergencyRadiusMeters,
      owner: 'existing-combat-service',
      state: state.linkState,
    });
  }
  return freeze({
    id: `${link.id}:assist`,
    actorId: link.actorId,
    targetId: link.targetId,
    kind: 'assist-combat',
    distanceMeters,
    relation: relationSignals(reactionEntry),
    attackProfile: 'owner-controlled-support',
    damageOwner: true,
    owner: 'existing-combat-service',
    state: state.linkState,
  });
}

function buildRegroupRequest(link, follower, target, state) {
  const followerPosition = readPosition(follower);
  const targetPosition = readPosition(target);
  if (!followerPosition || !targetPosition) return null;
  const distanceMeters = distance2d(followerPosition, targetPosition);
  return freeze({
    id: `${link.id}:regroup`,
    actorId: link.actorId,
    targetId: link.targetId,
    kind: 'regroup',
    destination: targetPosition,
    distanceMeters,
    regroupRadiusMeters: LIVING_WORLD_COMPANION_RUNTIME_POLICY.regroupRadiusMeters,
    owner: 'existing-navigation-service',
    reason: state.linkState,
  });
}

function callOwner(owner, methods, args, fallback = null) {
  if (!owner || typeof owner !== 'object') return fallback;
  for (const method of methods) {
    if (typeof owner[method] !== 'function') continue;
    try {
      return {
        invoked: true,
        method,
        result: owner[method](...args),
      };
    } catch (error) {
      return {
        invoked: true,
        method,
        error: asId(error?.message, 'owner-call-failed'),
      };
    }
  }
  return fallback;
}

function writeTelemetry(actor, payload) {
  const object3D = actor?.object3D;
  if (!object3D || typeof object3D !== 'object') return false;
  try {
    object3D.userData ??= {};
    object3D.userData.livingWorldCompanion = freeze(payload);
    return true;
  } catch {
    return false;
  }
}

function normalizeDelta(value) {
  return clamp(value, 0, LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxDeltaSeconds);
}

function buildEvent(link, state, reason, reactionEntry) {
  return freeze({
    type: state.linkState === 'assisting' ? 'companion-combat-intent' : 'companion-runtime',
    companionId: link.id,
    actorId: link.actorId,
    targetId: link.targetId,
    phase: state.linkState,
    reason: asId(reason, 'companion-transition'),
    reactionPhase: asId(reactionEntry?.phase, 'patrol'),
    digest: digest({
      companionId: link.id,
      actorId: link.actorId,
      targetId: link.targetId,
      phase: state.linkState,
      reason,
    }),
  });
}

function createEmptyStats() {
  return {
    linked: 0,
    following: 0,
    assisting: 0,
    regrouping: 0,
    holding: 0,
    recovering: 0,
    detached: 0,
    simulated: 0,
    throttled: 0,
    culled: 0,
    navigationInvoked: 0,
    combatInvoked: 0,
    eventsPublished: 0,
  };
}

function actorDistanceToPlayer(actorMap, actorId, playerPosition) {
  if (!playerPosition) return 0;
  return distance2d(readPosition(actorMap.get(actorId)), playerPosition);
}

function sortLinksForRuntime(links, actorMap, playerPosition) {
  return [...links].sort((a, b) =>
    actorDistanceToPlayer(actorMap, a.actorId, playerPosition) - actorDistanceToPlayer(actorMap, b.actorId, playerPosition) ||
    b.priority - a.priority ||
    a.actorId.localeCompare(b.actorId) ||
    a.id.localeCompare(b.id)
  );
}

export function createLivingWorldCompanionRuntime({
  seed = 0,
  clockSeconds = 0,
  services = {},
  integrationOptions = {},
} = {}) {
  const normalizedServices = services ?? {};
  const integration = createLivingWorldReactionIntegration({
    ...integrationOptions,
    seed,
    clockSeconds,
    services: normalizedServices,
  });

  const linkStates = new Map();
  let nowSeconds = Math.max(0, finite(clockSeconds));
  let tickCount = 0;
  let disposed = false;
  let eventPublishes = 0;

  function ensureLinkState(link) {
    if (!linkStates.has(link.id)) linkStates.set(link.id, createLinkState(link));
    return linkStates.get(link.id);
  }

  function invokeNavigation(request, follower) {
    const result = callOwner(
      normalizedServices.navigation ?? normalizedServices.navigationService,
      ['requestTravel', 'requestMove', 'navigate', 'travel'],
      [follower, request],
      { invoked: false, reason: 'navigation-service-unavailable' },
    );
    return freeze(result);
  }

  function invokeCombat(request, follower, target) {
    const result = callOwner(
      normalizedServices.combat ?? normalizedServices.encounters ?? normalizedServices.encounter,
      ['requestSupport', 'requestAttack', 'assist', 'attack'],
      [follower, target, request],
      { invoked: false, reason: 'combat-service-unavailable' },
    );
    return freeze(result);
  }

  function invokeEvent(event) {
    if (eventPublishes >= LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxEventPublishes) {
      return freeze({ invoked: false, reason: 'event-budget' });
    }
    const result = callOwner(
      normalizedServices.worldEventsPublisher ?? normalizedServices.worldEvents,
      ['publish', 'emit', 'dispatch'],
      [event],
      { invoked: false, reason: 'world-event-service-unavailable' },
    );
    if (result?.invoked) eventPublishes += 1;
    return freeze(result);
  }

  function tick({
    deltaSeconds = 0,
    collections = {},
    companions = [],
    groups = [],
    occupations = [],
    faunaRequests = [],
    eventContext = {},
    eventTypes = [],
    playerPosition = null,
    reactionOptions = {},
  } = {}) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed' });

    const delta = normalizeDelta(deltaSeconds);
    nowSeconds += delta;
    tickCount += 1;
    const actors = buildActorMap(collections);
    const links = normalizeCompanionLinks(companions);
    const orderedLinks = sortLinksForRuntime(links, actors, playerPosition);
    const stats = createEmptyStats();
    const navigationRequests = [];
    const combatRequests = [];
    const publishedEvents = [];
    const results = [];

    const integrationSnapshot = integration.tick({
      deltaSeconds: delta,
      collections,
      companions,
      groups,
      occupations,
      faunaRequests,
      eventContext: {
        ...eventContext,
        clockSeconds: finite(eventContext?.clockSeconds, nowSeconds),
      },
      eventTypes,
      playerPosition,
      reactionOptions,
    });
    const reactionMap = buildReactionMap(integrationSnapshot?.reaction);

    const totalCompanions = orderedLinks.length;

    for (let index = 0; index < totalCompanions; index += 1) {
      const link = orderedLinks[index];
      const follower = actors.get(link.actorId);
      const target = actors.get(link.targetId);
      const state = ensureLinkState(link);
      state.elapsedSeconds += delta;
      state.normalizedLinks = links;
      state.actorMap = actors;

      const followerDistance = actorDistanceToPlayer(actors, link.actorId, playerPosition);
      const lod = normalizeLod(followerDistance);
      const interval = lodTickInterval(lod);
      const elapsedSinceNavigation = nowSeconds - state.lastNavigationSeconds;
      const elapsedSinceAssist = nowSeconds - state.lastAssistSeconds;

      if (lod === 'culled') {
        stats.culled += 1;
        setState(state, 'linked', 'offscreen-cull');
        results.push(freeze({
          accepted: true,
          companionId: link.id,
          actorId: link.actorId,
          targetId: link.targetId,
          state: state.state,
          lod,
          simulated: false,
          reason: 'culled',
        }));
        continue;
      }

      if (state.lastTargetPosition && target) {
        const currentTarget = readPosition(target);
        if (currentTarget && distance2d(currentTarget, state.lastTargetPosition) < 0.01) {
          state.staleSeconds += delta;
        } else {
          state.staleSeconds = 0;
        }
      }

      if (state.staleSeconds > LIVING_WORLD_COMPANION_RUNTIME_POLICY.staleTargetSeconds) {
        setState(state, 'recovering', 'stale-target');
      }

      if (interval > 0 && state.elapsedSeconds < interval) {
        stats.throttled += 1;
        results.push(freeze({
          accepted: true,
          companionId: link.id,
          actorId: link.actorId,
          targetId: link.targetId,
          state: state.state,
          lod,
          simulated: false,
          reason: 'lod-throttle',
        }));
        continue;
      }

      if (interval > 0) state.elapsedSeconds = 0;
      stats.simulated += 1;

      const reactionEntry = reactionMap.get(link.targetId) ?? null;
      const chosen = chooseCompanionState(link, follower, target, reactionEntry, state, playerPosition);
      setState(state, chosen.nextState, chosen.reason);

      const targetPosition = readPosition(target);
      if (targetPosition) state.lastTargetPosition = targetPosition;

      let navigation = freeze({ invoked: false, reason: 'not-requested' });
      let combat = freeze({ invoked: false, reason: 'not-requested' });
      let event = null;

      const followerPosition = readPosition(follower);
      const distanceMeters = distance2d(followerPosition, targetPosition);

      if (state.state === 'recovering') {
        const recoveryRequest = buildRegroupRequest(link, follower, target, state);
        if (recoveryRequest && navigationRequests.length < LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxNavigationRequests) {
          navigationRequests.push(recoveryRequest);
          navigation = invokeNavigation(recoveryRequest, follower);
          if (navigation?.invoked) stats.navigationInvoked += 1;
          state.lastNavigationSeconds = nowSeconds;
        }
        state.recoveryCount += 1;
        if (distanceMeters <= link.recoverDistanceMeters) {
          setState(state, 'following', 'recovery-restored');
        }
      } else if (state.state === 'regrouping') {
        const regroupRequest = buildRegroupRequest(link, follower, target, state);
        if (regroupRequest && navigationRequests.length < LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxNavigationRequests) {
          navigationRequests.push(regroupRequest);
          navigation = invokeNavigation(regroupRequest, follower);
          if (navigation?.invoked) stats.navigationInvoked += 1;
          state.lastNavigationSeconds = nowSeconds;
        }
      } else {
        const shouldNavigate =
          (state.state === 'following' || state.state === 'holding' || state.state === 'assisting') &&
          elapsedSinceNavigation >= LIVING_WORLD_COMPANION_RUNTIME_POLICY.minNavigationIntervalSeconds &&
          navigationRequests.length < LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxNavigationRequests;

        if (shouldNavigate) {
          const request = buildNavigationRequest(
            link,
            follower,
            target,
            { ...state, linkState: state.state },
            index,
            totalCompanions,
            playerPosition,
          );
          if (request) {
            navigationRequests.push(request);
            navigation = invokeNavigation(request, follower);
            if (navigation?.invoked) stats.navigationInvoked += 1;
            state.lastNavigationSeconds = nowSeconds;
            state.lastCommandPosition = request.destination;
          }
        }

        const assistRequest = buildAssistRequest(link, follower, target, reactionEntry, { ...state, linkState: state.state });
        if (
          assistRequest &&
          elapsedSinceAssist >= LIVING_WORLD_COMPANION_RUNTIME_POLICY.minAssistIntervalSeconds &&
          combatRequests.length < LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxCombatRequests
        ) {
          combatRequests.push(assistRequest);
          combat = invokeCombat(assistRequest, follower, target);
          if (combat?.invoked) stats.combatInvoked += 1;
          state.lastAssistSeconds = nowSeconds;
        }
      }

      if (state.state !== 'holding' || chosen.reason !== 'within-follow-envelope') {
        event = buildEvent(link, state, chosen.reason, reactionEntry);
        if (event && nowSeconds - state.lastEventSeconds >= 0.5) {
          const published = invokeEvent(event);
          if (published?.invoked) {
            stats.eventsPublished += 1;
            publishedEvents.push(event);
            state.lastEventSeconds = nowSeconds;
          }
        }
      }

      const telemetry = freeze({
        companionId: link.id,
        actorId: link.actorId,
        targetId: link.targetId,
        state: state.state,
        lod,
        distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
        followDistanceMeters: link.followDistanceMeters,
        mode: link.mode,
        priority: link.priority,
        targetPhase: asId(reactionEntry?.phase, 'patrol'),
        targetLod: readTargetLod(target, playerPosition),
        staleSeconds: state.staleSeconds,
        recoveryCount: state.recoveryCount,
        transitionCount: state.transitionCount,
        history: freeze([...state.history]),
        navigation,
        combat,
        event: publishedEvents.includes(event) ? event : null,
        digest: digest({
          companionId: link.id,
          state: state.state,
          targetPhase: asId(reactionEntry?.phase, 'patrol'),
          lod,
        }),
      });
      writeTelemetry(follower, telemetry);
      results.push(telemetry);
    }

    for (const row of results) {
      const key = row.state;
      if (Object.prototype.hasOwnProperty.call(stats, key)) stats[key] += 1;
    }
    stats.linked = results.length;

    return freeze({
      accepted: integrationSnapshot?.accepted !== false,
      tick: tickCount,
      clockSeconds: nowSeconds,
      companionCount: results.length,
      simulatedCompanions: results.filter((row) => row.simulated !== false).length,
      results: freeze(results),
      navigationRequests: freeze(navigationRequests.slice(0, LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxNavigationRequests)),
      combatRequests: freeze(combatRequests.slice(0, LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxCombatRequests)),
      publishedEvents: freeze(publishedEvents),
      integration: integrationSnapshot,
      stats: freeze(stats),
      policyId: LIVING_WORLD_COMPANION_RUNTIME_POLICY.id,
      integrationPolicyId: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
      digest: digest({
        tick: tickCount,
        results: results.map((row) => ({
          companionId: row.companionId,
          state: row.state,
          targetId: row.targetId,
          lod: row.lod,
        })),
      }),
    });
  }

  function snapshot() {
    return freeze({
      clockSeconds: nowSeconds,
      tick: tickCount,
      disposed,
      companionCount: linkStates.size,
      links: freeze([...linkStates.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((state) => freeze({
          id: state.id,
          state: state.state,
          elapsedSeconds: state.elapsedSeconds,
          staleSeconds: state.staleSeconds,
          recoveryCount: state.recoveryCount,
          transitionCount: state.transitionCount,
          lastTargetPosition: state.lastTargetPosition,
          lastCommandPosition: state.lastCommandPosition,
          history: freeze([...state.history]),
        }))),
      policyId: LIVING_WORLD_COMPANION_RUNTIME_POLICY.id,
      digest: digest([...linkStates.values()].map((state) => ({
        id: state.id,
        state: state.state,
        recoveryCount: state.recoveryCount,
      })).sort((a, b) => a.id.localeCompare(b.id))),
    });
  }

  function reset() {
    for (const state of linkStates.values()) {
      state.state = 'linked';
      state.elapsedSeconds = 0;
      state.staleSeconds = 0;
      state.lastTargetPosition = null;
      state.lastCommandPosition = null;
      state.lastNavigationSeconds = -Infinity;
      state.lastAssistSeconds = -Infinity;
      state.lastEventSeconds = -Infinity;
      state.recoveryCount = 0;
      state.transitionCount = 0;
      state.history = [];
    }
    nowSeconds = Math.max(0, finite(clockSeconds));
    tickCount = 0;
    eventPublishes = 0;
    integration.reset?.();
    return true;
  }

  function audit() {
    const errors = [];
    if (linkStates.size > LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxLinks) errors.push('tracked-link-overflow');
    if (disposed) errors.push('disposed');
    for (const state of linkStates.values()) {
      if (!COMPANION_STATES.includes(state.state)) errors.push(`invalid-state:${state.id}`);
      if (state.history.length > LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxHistoryPerLink) errors.push(`history-overflow:${state.id}`);
      if (!Number.isFinite(state.elapsedSeconds)) errors.push(`non-finite-elapsed:${state.id}`);
      if (!Number.isFinite(state.staleSeconds)) errors.push(`non-finite-stale:${state.id}`);
    }
    const integrationAudit = typeof integration.audit === 'function' ? integration.audit() : { ok: true, errors: [] };
    errors.push(...(integrationAudit.errors ?? []));
    return freeze({
      ok: errors.length === 0,
      errors: freeze(errors),
      trackedLinks: linkStates.size,
      policyId: LIVING_WORLD_COMPANION_RUNTIME_POLICY.id,
    });
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    integration.dispose?.();
    return true;
  }

  return freeze({
    tick,
    snapshot,
    reset,
    audit,
    dispose,
    get disposed() {
      return disposed;
    },
  });
}

export function auditLivingWorldCompanionRuntime(result) {
  const errors = [];
  if (!result || result.accepted !== true) errors.push('runtime-not-accepted');
  if (result?.companionCount > LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxLinks) errors.push('companion-overflow');
  if (result?.navigationRequests?.length > LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxNavigationRequests) errors.push('navigation-budget');
  if (result?.combatRequests?.length > LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxCombatRequests) errors.push('combat-budget');
  if (result?.publishedEvents?.length > LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxEventPublishes) errors.push('event-budget');
  if (result?.simulatedCompanions > result?.companionCount) errors.push('simulation-count-overflow');
  const digestValue = result?.digest;
  if (typeof digestValue !== 'string' || digestValue.length !== 8) errors.push('digest-invalid');
  return freeze({
    ok: errors.length === 0,
    errors: freeze(errors),
  });
}
