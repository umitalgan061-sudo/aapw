/**
 * Deterministic runtime bridge for the existing living-world owners.
 *
 * This module is deliberately an adapter, not a second NPC/faction/world-event framework.
 * It consumes caller-owned ActorRegistry/controller state and optional existing faction,
 * reputation, diplomacy, law, navigation, encounter and event services through small
 * dependency-injection seams. It computes bounded directives and invokes only the methods
 * explicitly provided by those owners.
 *
 * Runtime chain covered here:
 *   patrol -> detect -> investigate -> chase -> attack -> return
 *   threat -> flee -> regroup
 *   occupation schedule -> travel -> work -> rest
 *   faction/reputation/diplomacy/law -> reaction severity + wanted response
 *   population LOD + sensing/tick throttling -> bounded mobile simulation cost
 *
 * No THREE import, DOM access, scene attachment, model loading, spawn ownership, combat damage,
 * or persistence ownership lives here. Existing owners remain authoritative for those concerns.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_REACTION_RUNTIME_POLICY = freeze({
  id: 'living-world-reaction-runtime-2026-09-08-v1',
  deterministic: true,
  maxActors: 128,
  maxSignalsPerActor: 12,
  maxEventsPerTick: 6,
  maxDeltaSeconds: 0.25,
  sensingIntervalSeconds: 0.15,
  distantTickIntervalSeconds: 0.75,
  farTickIntervalSeconds: 2.0,
  investigateTimeoutSeconds: 12,
  chaseTimeoutSeconds: 18,
  attackCooldownSeconds: 1.25,
  returnToleranceMeters: 3,
  fleeSafetyMeters: 28,
});

const REACTION_PHASES = freeze([
  'patrol',
  'detect',
  'investigate',
  'chase',
  'attack',
  'return',
  'flee',
]);

const LOD_LEVELS = freeze(['near', 'distant', 'far', 'culled']);
const HOSTILE_WANTED_THRESHOLD = 45;
const ALERT_REPUTATION_THRESHOLD = -25;
const FRIENDLY_REPUTATION_THRESHOLD = 25;
const MAX_HISTORY = 8;

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

function readPosition(actor) {
  const p = actor?.object3D?.position ?? actor?.position ?? actor?.transform?.position;
  if (!p) return null;
  const x = Number(p.x);
  const z = Number(p.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

function distance2d(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
}

function normalizeLod(distanceMeters, thresholds = {}) {
  const near = Math.max(1, finite(thresholds.nearMeters, 45));
  const distant = Math.max(near + 1, finite(thresholds.distantMeters, 120));
  const far = Math.max(distant + 1, finite(thresholds.farMeters, 260));
  if (distanceMeters <= near) return 'near';
  if (distanceMeters <= distant) return 'distant';
  if (distanceMeters <= far) return 'far';
  return 'culled';
}

function tickIntervalForLod(lod) {
  if (lod === 'near') return 0;
  if (lod === 'distant') return LIVING_WORLD_REACTION_RUNTIME_POLICY.distantTickIntervalSeconds;
  if (lod === 'far') return LIVING_WORLD_REACTION_RUNTIME_POLICY.farTickIntervalSeconds;
  return Infinity;
}

function normalizeSeverity(value) {
  return clamp(value, 0, 100);
}

function normalizeReputation(value) {
  return Math.max(-100, Math.min(100, finite(value, 0)));
}

function normalizeWanted(value) {
  return Math.max(0, Math.min(100, finite(value, 0)));
}

function canonicalTarget(signal = {}) {
  return freeze({
    id: asId(signal.targetId ?? signal.actorId ?? signal.id),
    position: signal.position ? { x: finite(signal.position.x), z: finite(signal.position.z) } : null,
    source: asId(signal.source, 'unknown'),
  });
}

function normalizeSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.slice(0, LIVING_WORLD_REACTION_RUNTIME_POLICY.maxSignalsPerActor).map((signal, index) => freeze({
    id: asId(signal?.id, `signal-${index}`),
    kind: asId(signal?.kind, 'unknown'),
    confidence: clamp(signal?.confidence, 0, 1),
    distanceMeters: Math.max(0, finite(signal?.distanceMeters, Infinity)),
    bearingRadians: finite(signal?.bearingRadians, 0),
    ageSeconds: Math.max(0, finite(signal?.ageSeconds, 0)),
    target: canonicalTarget(signal),
    audible: Boolean(signal?.audible),
    visible: Boolean(signal?.visible),
    suspicious: Boolean(signal?.suspicious),
    severity: normalizeSeverity(signal?.severity),
  })));
}

function chooseBestSignal(signals) {
  const normalized = normalizeSignals(signals);
  const scored = normalized.map((signal) => {
    const modality = signal.visible ? 0.25 : signal.audible ? 0.15 : 0;
    const suspicion = signal.suspicious ? 0.2 : 0;
    const recency = Math.max(0, 0.2 - signal.ageSeconds * 0.01);
    const proximity = Number.isFinite(signal.distanceMeters)
      ? Math.max(0, 0.35 - signal.distanceMeters / 250)
      : 0;
    const score = clamp(signal.confidence * 0.5 + modality + suspicion + recency + proximity, 0, 1);
    return { signal, score };
  }).sort((a, b) => b.score - a.score || a.signal.id.localeCompare(b.signal.id));
  return scored[0] ?? null;
}

function defaultRelation(reputation) {
  if (reputation >= FRIENDLY_REPUTATION_THRESHOLD) return 'friendly';
  if (reputation <= ALERT_REPUTATION_THRESHOLD) return 'hostile';
  return 'neutral';
}

function callService(service, candidates, args, fallback = null) {
  if (!service || typeof service !== 'object') return fallback;
  for (const name of candidates) {
    if (typeof service[name] !== 'function') continue;
    try {
      const value = service[name](...args);
      if (value != null) return value;
    } catch {
      // An owner service is allowed to reject an optional query; the runtime falls back safely.
    }
  }
  return fallback;
}

function resolveActorId(actor, index) {
  return asId(actor?.id ?? actor?.actorId ?? actor?.object3D?.uuid ?? actor?.object3D?.name, `actor-${index}`);
}

function resolveFaction(actor, services) {
  const direct = actor?.factionId ?? actor?.faction?.id ?? actor?.userData?.factionId;
  if (direct) return asId(direct);
  const resolved = callService(services?.factions, ['getFactionIdForActor', 'resolveActorFaction', 'getActorFactionId'], [actor], null);
  return asId(resolved, 'neutral');
}

function resolveReputation(actor, target, services) {
  const actorFaction = resolveFaction(actor, services);
  const targetFaction = asId(target?.factionId ?? target?.faction?.id, 'neutral');
  const explicit = target?.reputation ?? actor?.reputationByFaction?.[targetFaction];
  if (Number.isFinite(Number(explicit))) return normalizeReputation(explicit);
  const queried = callService(
    services?.reputation,
    ['getReputation', 'getRelationScore', 'readReputation'],
    [actor, target, actorFaction, targetFaction],
    null,
  );
  return normalizeReputation(queried);
}

function resolveDiplomaticRelation(actor, target, services) {
  const actorFaction = resolveFaction(actor, services);
  const targetFaction = asId(target?.factionId ?? target?.faction?.id, 'neutral');
  const relation = callService(
    services?.diplomacy,
    ['getRelation', 'getDiplomaticState', 'resolveTreaty'],
    [actorFaction, targetFaction],
    null,
  );
  if (typeof relation === 'string') return relation;
  if (relation?.state) return asId(relation.state);
  return actorFaction === targetFaction ? 'allied' : 'unknown';
}

function resolveWanted(actor, target, services) {
  const explicit = target?.wanted ?? target?.crime?.wantedLevel;
  if (Number.isFinite(Number(explicit))) return normalizeWanted(explicit);
  const queried = callService(
    services?.law,
    ['getWantedLevel', 'getWanted', 'resolveWantedLevel'],
    [target, actor],
    null,
  );
  return normalizeWanted(queried);
}

function resolveCrimeSeverity(target, services) {
  const explicit = target?.crime?.severity ?? target?.crimeSeverity;
  if (Number.isFinite(Number(explicit))) return normalizeSeverity(explicit);
  const queried = callService(
    services?.law,
    ['getCrimeSeverity', 'resolveCrimeSeverity', 'getRecentCrimeSeverity'],
    [target],
    null,
  );
  return normalizeSeverity(queried);
}

function relationSnapshot(actor, target, services) {
  const reputation = resolveReputation(actor, target, services);
  const diplomaticRelation = resolveDiplomaticRelation(actor, target, services);
  const wanted = resolveWanted(actor, target, services);
  const crimeSeverity = resolveCrimeSeverity(target, services);
  const relation = defaultRelation(reputation);
  return freeze({
    actorFaction: resolveFaction(actor, services),
    targetFaction: asId(target?.factionId ?? target?.faction?.id, 'neutral'),
    reputation,
    relation,
    diplomaticRelation,
    wanted,
    crimeSeverity,
    hostile: relation === 'hostile' || diplomaticRelation === 'war',
    reportable: wanted >= HOSTILE_WANTED_THRESHOLD || crimeSeverity >= 50,
  });
}

function thresholdForPhase(actor, relation, options) {
  const base = Math.max(0, Math.min(1, finite(options?.detectionThreshold, 0.62)));
  const courage = clamp(actor?.courage ?? actor?.traits?.courage, 0, 1);
  let threshold = base - courage * 0.15;
  if (relation.hostile) threshold -= 0.1;
  if (relation.reputation >= FRIENDLY_REPUTATION_THRESHOLD) threshold += 0.2;
  return clamp(threshold, 0.25, 0.9);
}

function nextPhaseForSignal(actor, signal, relation, options) {
  const threshold = thresholdForPhase(actor, relation, options);
  if (!signal || signal.score < threshold) return 'patrol';
  if (relation.reportable || relation.hostile) return 'detect';
  if (signal.signal.audible && !signal.signal.visible) return 'investigate';
  if (signal.signal.suspicious || signal.signal.visible) return 'investigate';
  return 'detect';
}

function canAttack(relation, signal, services) {
  if (!signal) return false;
  if (relation.hostile) return true;
  if (relation.reportable && relation.wanted >= HOSTILE_WANTED_THRESHOLD) return true;
  const decision = callService(services?.encounters, ['canAttack', 'isAttackAuthorized', 'resolveAttackPermission'], [relation, signal.signal], null);
  return decision === true;
}

function canChase(relation, signal, services) {
  if (!signal) return false;
  const decision = callService(services?.encounters, ['shouldChase', 'isChaseAuthorized', 'resolveChaseIntent'], [relation, signal.signal], null);
  if (decision != null) return Boolean(decision);
  return relation.hostile || relation.reportable || signal.signal.suspicious;
}

function canReturn(actor, home, current, options) {
  if (!home || !current) return false;
  return distance2d(home, current) <= Math.max(1, finite(options?.returnToleranceMeters, LIVING_WORLD_REACTION_RUNTIME_POLICY.returnToleranceMeters));
}

function scheduleDirective(actor, schedule, clockSeconds, services) {
  if (!schedule) return null;
  const directive = callService(
    services?.occupation,
    ['buildOccupationDirective', 'resolveOccupationDirective', 'getCurrentOccupationDirective'],
    [schedule, clockSeconds, readPosition(actor), actor],
    null,
  );
  if (directive && typeof directive === 'object') {
    return freeze({
      accepted: directive.accepted !== false,
      phase: asId(directive.phase, 'work'),
      activityId: asId(directive.activityId, 'idle'),
      locationId: asId(directive.locationId, ''),
      shouldTravel: Boolean(directive.shouldTravel),
      destination: directive.destination ?? null,
      nextChangeSeconds: Math.max(0, finite(directive.nextChangeSeconds, 0)),
    });
  }
  return freeze({
    accepted: true,
    phase: asId(schedule.phase, 'work'),
    activityId: asId(schedule.activityId, 'idle'),
    locationId: asId(schedule.locationId, ''),
    shouldTravel: Boolean(schedule.shouldTravel),
    destination: schedule.destination ?? null,
    nextChangeSeconds: Math.max(0, finite(schedule.nextChangeSeconds, 0)),
  });
}

function writeActorTelemetry(actor, state) {
  const object3D = actor?.object3D;
  if (!object3D || typeof object3D !== 'object') return false;
  try {
    object3D.userData ??= {};
    object3D.userData.livingWorldReaction = freeze(state);
    return true;
  } catch {
    return false;
  }
}

function trimHistory(history) {
  return history.slice(-MAX_HISTORY);
}

function createActorState(actor, index) {
  return {
    id: resolveActorId(actor, index),
    phase: 'patrol',
    elapsedInPhase: 0,
    lastSenseSeconds: -Infinity,
    lastTickSeconds: -Infinity,
    lastAttackSeconds: -Infinity,
    homePosition: readPosition(actor),
    targetId: '',
    lod: 'near',
    history: [],
  };
}

function transition(state, nextPhase, reason, targetId = '') {
  if (!REACTION_PHASES.includes(nextPhase)) return;
  if (state.phase !== nextPhase) {
    state.history = trimHistory([...state.history, freeze({ from: state.phase, to: nextPhase, reason: asId(reason, 'state-transition'), targetId: asId(targetId) })]);
    state.phase = nextPhase;
    state.elapsedInPhase = 0;
  }
  state.targetId = asId(targetId, state.targetId);
}

function computeFleeDirective(actor, signal, options) {
  const current = readPosition(actor);
  const threat = signal?.signal?.target?.position;
  if (!current || !threat) return freeze({ kind: 'flee', destination: null, speedMultiplier: 1 });
  const dx = current.x - threat.x;
  const dz = current.z - threat.z;
  const magnitude = Math.hypot(dx, dz) || 1;
  const distance = Math.max(1, finite(options?.fleeDistanceMeters, LIVING_WORLD_REACTION_RUNTIME_POLICY.fleeSafetyMeters));
  return freeze({
    kind: 'flee',
    destination: { x: current.x + (dx / magnitude) * distance, z: current.z + (dz / magnitude) * distance },
    speedMultiplier: 1.25,
  });
}

function computeReturnDirective(home) {
  return freeze({ kind: 'return', destination: home ? { x: home.x, z: home.z } : null, speedMultiplier: 1 });
}

function computeInvestigateDirective(signal) {
  return freeze({
    kind: 'investigate',
    targetId: signal?.signal?.target?.id || '',
    destination: signal?.signal?.target?.position ?? null,
    radiusMeters: Math.max(2, Math.min(35, finite(signal?.signal?.distanceMeters, 8))),
  });
}

function computeChaseDirective(signal) {
  return freeze({
    kind: 'chase',
    targetId: signal?.signal?.target?.id || '',
    destination: signal?.signal?.target?.position ?? null,
    speedMultiplier: 1.1,
  });
}

function computeAttackDirective(signal) {
  return freeze({
    kind: 'attack',
    targetId: signal?.signal?.target?.id || '',
    attackProfile: 'owner-controlled',
    damageOwner: true,
  });
}

function computePatrolDirective(schedule) {
  if (schedule?.shouldTravel && schedule.destination) {
    return freeze({ kind: 'travel', destination: schedule.destination, activityId: schedule.activityId, locationId: schedule.locationId });
  }
  return freeze({ kind: 'patrol', destination: null, activityId: schedule?.activityId || 'patrol', locationId: schedule?.locationId || '' });
}

function phaseBudgetAllows(state, elapsedSinceTick) {
  const interval = tickIntervalForLod(state.lod);
  return elapsedSinceTick + 1e-9 >= interval;
}

function buildEvent(actor, state, relation, signal) {
  const interesting = state.phase !== 'patrol' || relation.reportable || relation.hostile;
  if (!interesting) return null;
  return freeze({
    type: state.phase === 'attack' ? 'npc-combat-intent' : 'living-world-reaction',
    actorId: state.id,
    targetId: state.targetId,
    factionId: relation.actorFaction,
    relation: relation.relation,
    wanted: relation.wanted,
    crimeSeverity: relation.crimeSeverity,
    phase: state.phase,
    signalId: signal?.signal?.id || '',
    digest: digest({ actor: state.id, target: state.targetId, phase: state.phase, wanted: relation.wanted }),
  });
}

function callNavigation(services, actor, directive) {
  if (!directive?.destination) return { accepted: true, invoked: false };
  const result = callService(
    services?.navigation,
    ['requestTravel', 'requestPath', 'setDestination', 'goTo'],
    [actor, directive.destination, directive],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

function callCombat(services, actor, directive) {
  if (directive?.kind !== 'attack') return freeze({ accepted: true, invoked: false });
  const result = callService(
    services?.encounters,
    ['requestAttack', 'beginCombat', 'enterCombat'],
    [actor, directive.targetId, directive],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

function callLawReport(services, event, relation) {
  if (!relation.reportable) return freeze({ accepted: true, invoked: false });
  const result = callService(
    services?.law,
    ['reportCrime', 'recordWantedObservation', 'publishCrimeObservation'],
    [event, relation],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

function callWorldEvent(services, event) {
  if (!event) return freeze({ accepted: true, invoked: false });
  const result = callService(
    services?.worldEvents,
    ['publish', 'emit', 'queue'],
    [event],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

function updatePerceptionCache(services, actor, nowSeconds, options) {
  const result = callService(
    services?.perception,
    ['sense', 'sample', 'observe', 'getSignals'],
    [actor, nowSeconds, options],
    null,
  );
  return normalizeSignals(result);
}

function chooseLod(actor, playerPosition, options) {
  const actorPosition = readPosition(actor);
  return normalizeLod(distance2d(actorPosition, playerPosition), options?.lodThresholds);
}

function normalizeActors(actors) {
  if (!Array.isArray(actors)) return [];
  return actors.slice(0, LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors);
}

export function createLivingWorldReactionRuntime({
  actors = [],
  services = {},
  seed = 0,
  clockSeconds = 0,
  lodThresholds,
  detectionThreshold = 0.62,
} = {}) {
  const normalizedActors = normalizeActors(actors);
  const states = new Map();
  normalizedActors.forEach((actor, index) => states.set(actor, createActorState(actor, index)));
  let nowSeconds = Math.max(0, finite(clockSeconds));
  let tickCount = 0;
  let emittedEvents = 0;
  let disposed = false;
  let rngState = stableHash(seed);

  function random01() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0x100000000;
  }

  function actorTick(actor, state, deltaSeconds, playerPosition, options) {
    const actorPosition = readPosition(actor);
    const lod = chooseLod(actor, playerPosition, { lodThresholds });
    state.lod = lod;
    if (lod === 'culled') return freeze({ accepted: true, simulated: false, actorId: state.id, lod, reason: 'culled' });
    const elapsedSinceTick = nowSeconds - state.lastTickSeconds;
    if (state.lastTickSeconds !== -Infinity && !phaseBudgetAllows(state, elapsedSinceTick)) {
      return freeze({ accepted: true, simulated: false, actorId: state.id, lod, reason: 'throttled' });
    }
    state.lastTickSeconds = nowSeconds;
    state.elapsedInPhase += deltaSeconds;

    let signals = [];
    if (nowSeconds - state.lastSenseSeconds >= LIVING_WORLD_REACTION_RUNTIME_POLICY.sensingIntervalSeconds) {
      signals = updatePerceptionCache(services, actor, nowSeconds, { lod, playerPosition });
      state.lastSenseSeconds = nowSeconds;
    }
    const bestSignal = chooseBestSignal(signals);
    const target = bestSignal?.signal?.target ?? { id: state.targetId, position: null };
    const relation = relationSnapshot(actor, {
      ...target,
      factionId: bestSignal?.signal?.target?.factionId,
      reputation: bestSignal?.signal?.target?.reputation,
      wanted: bestSignal?.signal?.target?.wanted,
      crime: bestSignal?.signal?.target?.crime,
    }, services);

    const schedule = scheduleDirective(actor, actor?.occupationSchedule ?? actor?.schedule, nowSeconds, services);
    const baseNext = nextPhaseForSignal(actor, bestSignal, relation, { detectionThreshold, returnToleranceMeters: options?.returnToleranceMeters });

    if (state.phase === 'patrol') transition(state, baseNext, bestSignal ? 'perception-signal' : 'patrol-no-signal', target.id);
    else if (state.phase === 'detect') transition(state, bestSignal ? (bestSignal.signal.visible || bestSignal.signal.audible ? 'investigate' : 'return') : 'return', 'detect-resolution', target.id);
    else if (state.phase === 'investigate') {
      if (!bestSignal) transition(state, 'return', 'investigation-lost', state.targetId);
      else if (state.elapsedInPhase >= LIVING_WORLD_REACTION_RUNTIME_POLICY.investigateTimeoutSeconds) transition(state, 'return', 'investigation-timeout', state.targetId);
      else if (canChase(relation, bestSignal, services)) transition(state, 'chase', 'threat-confirmed', target.id);
      else if (canAttack(relation, bestSignal, services)) transition(state, 'attack', 'authorized-attack', target.id);
    } else if (state.phase === 'chase') {
      if (!bestSignal) transition(state, 'return', 'chase-lost-target', state.targetId);
      else if (canAttack(relation, bestSignal, services)) transition(state, 'attack', 'attack-window', target.id);
      else if (state.elapsedInPhase >= LIVING_WORLD_REACTION_RUNTIME_POLICY.chaseTimeoutSeconds) transition(state, 'return', 'chase-timeout', target.id);
    } else if (state.phase === 'attack') {
      if (!bestSignal) transition(state, 'return', 'attack-target-lost', state.targetId);
      else if (nowSeconds - state.lastAttackSeconds >= LIVING_WORLD_REACTION_RUNTIME_POLICY.attackCooldownSeconds) state.lastAttackSeconds = nowSeconds;
      else if (state.elapsedInPhase > LIVING_WORLD_REACTION_RUNTIME_POLICY.attackCooldownSeconds * 2) transition(state, 'return', 'attack-window-closed', target.id);
    } else if (state.phase === 'flee') {
      if (!bestSignal || Number(bestSignal.signal.distanceMeters) >= LIVING_WORLD_REACTION_RUNTIME_POLICY.fleeSafetyMeters) transition(state, 'return', 'flee-safe-distance', target.id);
    } else if (state.phase === 'return') {
      if (canReturn(actor, state.homePosition, actorPosition, options)) transition(state, 'patrol', 'home-reached', '');
      else if (bestSignal && (relation.hostile || relation.reportable)) transition(state, 'flee', 'return-interrupted', target.id);
    }

    if (bestSignal && (relation.hostile || relation.reportable) && actor?.traits?.fleeWhenOutnumbered === true) {
      const groupSize = Math.max(1, finite(actor?.groupThreatCount, 1));
      if (groupSize >= 3 && state.phase !== 'attack') transition(state, 'flee', 'outnumbered-threat', target.id);
    }

    let directive = computePatrolDirective(schedule);
    if (state.phase === 'detect') directive = freeze({ kind: 'detect', targetId: target.id, investigate: true });
    if (state.phase === 'investigate') directive = computeInvestigateDirective(bestSignal);
    if (state.phase === 'chase') directive = computeChaseDirective(bestSignal);
    if (state.phase === 'attack') directive = computeAttackDirective(bestSignal);
    if (state.phase === 'return') directive = computeReturnDirective(state.homePosition);
    if (state.phase === 'flee') directive = computeFleeDirective(actor, bestSignal, options);

    const navigation = callNavigation(services, actor, directive);
    const combat = callCombat(services, actor, directive);
    const event = buildEvent(actor, state, relation, bestSignal);
    const law = callLawReport(services, event, relation);
    const worldEvent = callWorldEvent(services, event);
    if (event && worldEvent.invoked) emittedEvents += 1;

    const occupation = schedule && state.phase === 'patrol'
      ? freeze({ phase: schedule.phase, activityId: schedule.activityId, locationId: schedule.locationId, shouldTravel: schedule.shouldTravel })
      : null;

    const telemetry = freeze({
      actorId: state.id,
      phase: state.phase,
      targetId: state.targetId,
      lod,
      elapsedInPhase: state.elapsedInPhase,
      relation,
      directive,
      occupation,
      navigation,
      combat,
      law,
      worldEvent,
      signal: bestSignal,
      randomSample: random01(),
      digest: digest({ actorId: state.id, phase: state.phase, targetId: state.targetId, lod }),
    });
    writeActorTelemetry(actor, telemetry);
    return telemetry;
  }

  function tick({ deltaSeconds = 0, playerPosition = null, actors: tickActors = normalizedActors, options = {} } = {}) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed' });
    const delta = Math.max(0, Math.min(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxDeltaSeconds, finite(deltaSeconds)));
    nowSeconds += delta;
    const actorsForTick = normalizeActors(tickActors);
    const results = [];
    for (let index = 0; index < actorsForTick.length; index += 1) {
      const actor = actorsForTick[index];
      if (!states.has(actor)) states.set(actor, createActorState(actor, index));
      results.push(actorTick(actor, states.get(actor), delta, playerPosition, options));
    }
    tickCount += 1;
    return freeze({
      accepted: true,
      tick: tickCount,
      clockSeconds: nowSeconds,
      actorCount: results.length,
      simulatedActors: results.filter((result) => result.simulated !== false).length,
      results: freeze(results),
      stats: freeze({ tickCount, emittedEvents, trackedActors: states.size }),
      policyId: LIVING_WORLD_REACTION_RUNTIME_POLICY.id,
      digest: digest(results.map((result) => ({ actorId: result.actorId, phase: result.phase, targetId: result.targetId, lod: result.lod }))),
    });
  }

  function snapshot() {
    return freeze({
      clockSeconds: nowSeconds,
      tickCount,
      emittedEvents,
      actors: freeze([...states.values()].map((state) => freeze({
        id: state.id,
        phase: state.phase,
        elapsedInPhase: state.elapsedInPhase,
        targetId: state.targetId,
        lod: state.lod,
        history: freeze([...state.history]),
      }))),
      policyId: LIVING_WORLD_REACTION_RUNTIME_POLICY.id,
    });
  }

  function reset() {
    for (const state of states.values()) {
      state.phase = 'patrol';
      state.elapsedInPhase = 0;
      state.lastSenseSeconds = -Infinity;
      state.lastTickSeconds = -Infinity;
      state.lastAttackSeconds = -Infinity;
      state.targetId = '';
      state.history = [];
    }
    nowSeconds = 0;
    tickCount = 0;
    emittedEvents = 0;
    return true;
  }

  function audit() {
    const errors = [];
    const snap = snapshot();
    if (disposed) errors.push('disposed');
    if (snap.actors.length > LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors) errors.push('actor-overflow');
    for (const actor of snap.actors) {
      if (!REACTION_PHASES.includes(actor.phase)) errors.push(`invalid-phase:${actor.id}`);
      if (!LOD_LEVELS.includes(actor.lod)) errors.push(`invalid-lod:${actor.id}`);
      if (actor.history.length > MAX_HISTORY) errors.push(`history-overflow:${actor.id}`);
    }
    return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(snap) });
  }

  return {
    tick,
    snapshot,
    audit,
    reset,
    dispose() { disposed = true; return true; },
    get disposed() { return disposed; },
  };
}

export function auditLivingWorldReactionResult(result) {
  const errors = [];
  if (!result || result.accepted !== true) errors.push('tick-not-accepted');
  if (result?.actorCount > LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors) errors.push('actor-count-overflow');
  for (const actor of result?.results ?? []) {
    if (actor.simulated !== false && !REACTION_PHASES.includes(actor.phase)) errors.push(`invalid-phase:${actor.actorId}`);
    if (!LOD_LEVELS.includes(actor.lod)) errors.push(`invalid-lod:${actor.actorId}`);
    if (actor?.relation?.wanted != null && (actor.relation.wanted < 0 || actor.relation.wanted > 100)) errors.push(`invalid-wanted:${actor.actorId}`);
    if (actor?.relation?.reputation != null && (actor.relation.reputation < -100 || actor.relation.reputation > 100)) errors.push(`invalid-reputation:${actor.actorId}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(result) });
}

export function livingWorldReactionDigest(result) {
  return digest(result);
}
