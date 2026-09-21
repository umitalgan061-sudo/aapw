/**
 * Read-only query surface over the bounded living-world reaction ledger.
 *
 * The ledger owns retention/dedupe; this module owns no state and performs no writes.
 * It is deliberately useful to DOM/UI/event adapters without becoming an EventBus,
 * ActorRegistry, navigation layer or combat system.
 */

const freeze = (value) => Object.freeze(value);
const asId = (value, fallback = '') => value == null ? fallback : String(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));

const PHASES = freeze(['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee']);
const LODS = freeze(['near', 'distant', 'far', 'culled']);
const RELATIONS = freeze(['friendly', 'neutral', 'hostile']);
const EVENT_TYPES = freeze(['reaction', 'combat-intent', 'transition']);

export const LIVING_WORLD_REACTION_PROJECTION_POLICY = freeze({
  id: 'living-world-reaction-projection-2026-09-08-v1',
  deterministic: true,
  maxActors: 128,
  maxEvents: 96,
  maxMatches: 32,
  distanceTieEpsilon: 1e-9,
  scoreFloor: 0,
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

function normalizePhase(value) {
  const phase = asId(value, 'patrol');
  return PHASES.includes(phase) ? phase : 'patrol';
}

function normalizeLod(value) {
  const lod = asId(value, 'near');
  return LODS.includes(lod) ? lod : 'near';
}

function normalizeRelation(value) {
  const relation = asId(value, 'neutral');
  return RELATIONS.includes(relation) ? relation : 'neutral';
}

function normalizeEventType(value) {
  const type = asId(value, 'reaction');
  return EVENT_TYPES.includes(type) ? type : 'reaction';
}

function normalizeDistance(value) {
  const distance = Number(value);
  return Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const actorId = asId(actor.actorId, '');
  if (!actorId) return null;
  return freeze({
    actorId,
    phase: normalizePhase(actor.phase),
    targetId: asId(actor.targetId, ''),
    lod: normalizeLod(actor.lod),
    relation: normalizeRelation(actor.relation?.relation),
    reputation: clamp(actor.relation?.reputation, -100, 100),
    wanted: clamp(actor.relation?.wanted, 0, 100),
    crimeSeverity: clamp(actor.relation?.crimeSeverity, 0, 100),
    hostile: Boolean(actor.relation?.hostile),
    reportable: Boolean(actor.relation?.reportable),
    directiveKind: asId(actor.directiveKind, 'none'),
    hasSignal: Boolean(actor.hasSignal),
    cachedSignalCount: Math.max(0, Math.floor(finite(actor.cachedSignalCount))),
    elapsedInPhase: Math.max(0, finite(actor.elapsedInPhase)),
    clockSeconds: Math.max(0, finite(actor.clockSeconds)),
    previousPhase: asId(actor.previousPhase, ''),
    changed: Boolean(actor.changed),
    digest: asId(actor.digest, ''),
  });
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const actorId = asId(event.actorId, '');
  if (!actorId) return null;
  return freeze({
    sequence: Math.max(0, Math.floor(finite(event.sequence))),
    type: normalizeEventType(event.type),
    clockSeconds: Math.max(0, finite(event.clockSeconds)),
    tick: Math.max(0, Math.floor(finite(event.tick))),
    actorId,
    targetId: asId(event.targetId, ''),
    phase: normalizePhase(event.phase),
    lod: normalizeLod(event.lod),
    relation: normalizeRelation(event.relation),
    wanted: clamp(event.wanted, 0, 100),
    crimeSeverity: clamp(event.crimeSeverity, 0, 100),
    reportable: Boolean(event.reportable),
    directive: event.directive && typeof event.directive === 'object'
      ? freeze({
        kind: asId(event.directive.kind, 'patrol'),
        targetId: asId(event.directive.targetId, ''),
        speedMultiplier: clamp(event.directive.speedMultiplier, 0, 4),
      })
      : null,
    from: event.from == null ? '' : normalizePhase(event.from),
    to: event.to == null ? '' : normalizePhase(event.to),
    reason: asId(event.reason, ''),
    digest: asId(event.digest, ''),
    key: asId(event.key, ''),
  });
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return freeze({
    policyId: '',
    acceptedTicks: 0,
    rejectedTicks: 0,
    projectedEvents: 0,
    droppedEvents: 0,
    duplicateEvents: 0,
    queuedEvents: 0,
    trackedActors: 0,
    clockSeconds: 0,
    actors: freeze([]),
    queue: freeze([]),
    digest: digest(null),
  });
  const actors = Array.isArray(snapshot.actors)
    ? snapshot.actors.map(normalizeActor).filter(Boolean).slice(0, LIVING_WORLD_REACTION_PROJECTION_POLICY.maxActors)
    : [];
  const queue = Array.isArray(snapshot.queue)
    ? snapshot.queue.map(normalizeEvent).filter(Boolean).slice(-LIVING_WORLD_REACTION_PROJECTION_POLICY.maxEvents)
    : [];
  return freeze({
    policyId: asId(snapshot.policyId, ''),
    acceptedTicks: Math.max(0, Math.floor(finite(snapshot.acceptedTicks))),
    rejectedTicks: Math.max(0, Math.floor(finite(snapshot.rejectedTicks))),
    projectedEvents: Math.max(0, Math.floor(finite(snapshot.projectedEvents))),
    droppedEvents: Math.max(0, Math.floor(finite(snapshot.droppedEvents))),
    duplicateEvents: Math.max(0, Math.floor(finite(snapshot.duplicateEvents))),
    queuedEvents: Math.max(0, Math.floor(finite(snapshot.queuedEvents, queue.length))),
    trackedActors: Math.max(0, Math.floor(finite(snapshot.trackedActors, actors.length))),
    clockSeconds: Math.max(0, finite(snapshot.clockSeconds)),
    actors: freeze(actors),
    queue: freeze(queue),
    digest: asId(snapshot.digest, ''),
  });
}

function eventPriority(type) {
  if (type === 'combat-intent') return 3;
  if (type === 'transition') return 2;
  return 1;
}

function sortEvents(events) {
  return [...events].sort((a, b) =>
    eventPriority(b.type) - eventPriority(a.type)
    || a.actorId.localeCompare(b.actorId)
    || a.phase.localeCompare(b.phase)
    || a.targetId.localeCompare(b.targetId)
    || a.type.localeCompare(b.type)
    || a.clockSeconds - b.clockSeconds
    || a.key.localeCompare(b.key)
    || a.sequence - b.sequence,
  );
}

function sortActors(actors) {
  return [...actors].sort((a, b) => a.actorId.localeCompare(b.actorId));
}

function phaseWeight(phase) {
  const weights = { patrol: 0, detect: 1, investigate: 2, return: 2, flee: 3, chase: 4, attack: 5 };
  return weights[phase] ?? 0;
}

function relationWeight(relation) {
  const weights = { friendly: 0, neutral: 1, hostile: 2 };
  return weights[relation] ?? 1;
}

function actorMatches(actor, filter) {
  if (!filter || typeof filter !== 'object') return true;
  if (filter.phase && actor.phase !== normalizePhase(filter.phase)) return false;
  if (filter.lod && actor.lod !== normalizeLod(filter.lod)) return false;
  if (filter.relation && actor.relation !== normalizeRelation(filter.relation)) return false;
  if (filter.targetId != null && actor.targetId !== asId(filter.targetId)) return false;
  if (filter.actorId != null && actor.actorId !== asId(filter.actorId)) return false;
  if (filter.hostile === true && actor.hostile !== true) return false;
  if (filter.reportable === true && actor.reportable !== true) return false;
  if (filter.hasSignal === true && actor.hasSignal !== true) return false;
  return true;
}

function eventMatches(event, filter) {
  if (!filter || typeof filter !== 'object') return true;
  if (filter.type && event.type !== normalizeEventType(filter.type)) return false;
  if (filter.phase && event.phase !== normalizePhase(filter.phase)) return false;
  if (filter.lod && event.lod !== normalizeLod(filter.lod)) return false;
  if (filter.relation && event.relation !== normalizeRelation(filter.relation)) return false;
  if (filter.actorId != null && event.actorId !== asId(filter.actorId)) return false;
  if (filter.targetId != null && event.targetId !== asId(filter.targetId)) return false;
  if (filter.reportable === true && event.reportable !== true) return false;
  if (filter.afterClockSeconds != null && event.clockSeconds <= finite(filter.afterClockSeconds)) return false;
  if (filter.beforeClockSeconds != null && event.clockSeconds >= finite(filter.beforeClockSeconds)) return false;
  return true;
}

function actorScore(actor) {
  let score = 0;
  score += phaseWeight(actor.phase) * 0.25;
  score += relationWeight(actor.relation) * 0.2;
  score += actor.reportable ? 0.35 : 0;
  score += actor.hostile ? 0.25 : 0;
  score += actor.hasSignal ? 0.1 : 0;
  score += Math.min(0.1, actor.wanted / 1000);
  return score;
}

function eventScore(event) {
  let score = eventPriority(event.type) * 0.3;
  score += phaseWeight(event.phase) * 0.15;
  score += event.reportable ? 0.25 : 0;
  score += Math.min(0.15, event.wanted / 667);
  score += Math.min(0.15, event.crimeSeverity / 667);
  return score;
}

export function normalizeLivingWorldReactionProjectionSnapshot(snapshot) {
  return normalizeSnapshot(snapshot);
}

export function listLivingWorldReactionActors(snapshot, filter = {}, limit = LIVING_WORLD_REACTION_PROJECTION_POLICY.maxMatches) {
  const normalized = normalizeSnapshot(snapshot);
  const count = Math.max(0, Math.min(LIVING_WORLD_REACTION_PROJECTION_POLICY.maxMatches, Math.floor(finite(limit, LIVING_WORLD_REACTION_PROJECTION_POLICY.maxMatches))));
  return freeze(sortActors(normalized.actors.filter((actor) => actorMatches(actor, filter))).slice(0, count));
}

export function listLivingWorldReactionEvents(snapshot, filter = {}, limit = LIVING_WORLD_REACTION_PROJECTION_POLICY.maxMatches) {
  const normalized = normalizeSnapshot(snapshot);
  const count = Math.max(0, Math.min(LIVING_WORLD_REACTION_PROJECTION_POLICY.maxMatches, Math.floor(finite(limit, LIVING_WORLD_REACTION_PROJECTION_POLICY.maxMatches))));
  return freeze(sortEvents(normalized.queue.filter((event) => eventMatches(event, filter))).slice(0, count));
}

export function findLivingWorldReactionActor(snapshot, actorId) {
  const actors = listLivingWorldReactionActors(snapshot, { actorId }, 1);
  return actors[0] || null;
}

export function findLivingWorldReactionTargetEvents(snapshot, targetId, limit = 16) {
  return listLivingWorldReactionEvents(snapshot, { targetId }, limit);
}

export function getLivingWorldReactionHotspots(snapshot, limit = 8) {
  const normalized = normalizeSnapshot(snapshot);
  const count = Math.max(0, Math.min(16, Math.floor(finite(limit, 8))));
  const hotspots = normalized.actors.map((actor) => ({
    actorId: actor.actorId,
    phase: actor.phase,
    targetId: actor.targetId,
    relation: actor.relation,
    lod: actor.lod,
    score: actorScore(actor),
    digest: digest({ actorId: actor.actorId, phase: actor.phase, targetId: actor.targetId, relation: actor.relation }),
  }));
  hotspots.sort((a, b) => b.score - a.score || a.actorId.localeCompare(b.actorId));
  return freeze(hotspots.slice(0, count).map(freeze));
}

export function getLivingWorldReactionEventPriorities(snapshot, limit = 16) {
  const normalized = normalizeSnapshot(snapshot);
  const count = Math.max(0, Math.min(LIVING_WORLD_REACTION_PROJECTION_POLICY.maxEvents, Math.floor(finite(limit, 16))));
  const events = sortEvents(normalized.queue).slice(0, count).map((event) => freeze({
    key: event.key,
    actorId: event.actorId,
    targetId: event.targetId,
    type: event.type,
    phase: event.phase,
    priority: eventPriority(event.type),
    score: eventScore(event),
    clockSeconds: event.clockSeconds,
    reportable: event.reportable,
  }));
  return freeze(events);
}

export function summarizeLivingWorldReactionProjection(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const phaseCounts = Object.fromEntries(PHASES.map((phase) => [phase, 0]));
  const lodCounts = Object.fromEntries(LODS.map((lod) => [lod, 0]));
  const relationCounts = Object.fromEntries(RELATIONS.map((relation) => [relation, 0]));
  const eventCounts = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]));
  let reportableActors = 0;
  let hostileActors = 0;
  let signaledActors = 0;
  let finiteActors = 0;
  for (const actor of normalized.actors) {
    phaseCounts[actor.phase] += 1;
    lodCounts[actor.lod] += 1;
    relationCounts[actor.relation] += 1;
    if (actor.reportable) reportableActors += 1;
    if (actor.hostile) hostileActors += 1;
    if (actor.hasSignal) signaledActors += 1;
    if (Number.isFinite(actor.clockSeconds)) finiteActors += 1;
  }
  for (const event of normalized.queue) eventCounts[event.type] += 1;
  const activeActors = normalized.actors.filter((actor) => actor.phase !== 'patrol').length;
  const summary = {
    policyId: LIVING_WORLD_REACTION_PROJECTION_POLICY.id,
    clockSeconds: normalized.clockSeconds,
    trackedActors: normalized.actors.length,
    queuedEvents: normalized.queue.length,
    activeActors,
    reportableActors,
    hostileActors,
    signaledActors,
    finiteActors,
    phaseCounts,
    lodCounts,
    relationCounts,
    eventCounts,
    acceptedTicks: normalized.acceptedTicks,
    rejectedTicks: normalized.rejectedTicks,
    droppedEvents: normalized.droppedEvents,
    duplicateEvents: normalized.duplicateEvents,
  };
  return freeze({ ...summary, digest: digest(summary) });
}

export function buildLivingWorldReactionActorCard(snapshot, actorId) {
  const actor = findLivingWorldReactionActor(snapshot, actorId);
  if (!actor) return null;
  const events = listLivingWorldReactionEvents(snapshot, { actorId }, 8);
  const targets = [...new Set(events.map((event) => event.targetId).filter(Boolean))].sort();
  return freeze({
    actorId: actor.actorId,
    phase: actor.phase,
    targetId: actor.targetId,
    lod: actor.lod,
    relation: actor.relation,
    reputation: actor.reputation,
    wanted: actor.wanted,
    crimeSeverity: actor.crimeSeverity,
    directiveKind: actor.directiveKind,
    hasSignal: actor.hasSignal,
    changed: actor.changed,
    previousPhase: actor.previousPhase,
    eventCount: events.length,
    targets: freeze(targets.slice(0, 8)),
    digest: digest({ actor, targets }),
  });
}

export function buildLivingWorldReactionTargetCard(snapshot, targetId) {
  const events = findLivingWorldReactionTargetEvents(snapshot, targetId, 16);
  if (!events.length) return null;
  const actorIds = [...new Set(events.map((event) => event.actorId))].sort();
  const highest = sortEvents(events)[0];
  return freeze({
    targetId: asId(targetId),
    actorCount: actorIds.length,
    actorIds: freeze(actorIds),
    highestPriorityType: highest.type,
    highestPriorityPhase: highest.phase,
    reportable: events.some((event) => event.reportable),
    wanted: Math.max(...events.map((event) => event.wanted)),
    crimeSeverity: Math.max(...events.map((event) => event.crimeSeverity)),
    eventCount: events.length,
    digest: digest({ targetId: asId(targetId), actorIds, highest: highest.key }),
  });
}

export function getLivingWorldReactionActiveActors(snapshot, limit = 32) {
  return listLivingWorldReactionActors(snapshot, {}, limit)
    .filter((actor) => actor.phase !== 'patrol')
    .sort((a, b) => phaseWeight(b.phase) - phaseWeight(a.phase) || b.wanted - a.wanted || a.actorId.localeCompare(b.actorId))
    .slice(0, Math.min(32, Math.max(0, Math.floor(finite(limit, 32)))));
}

export function getLivingWorldReactionReportableEvents(snapshot, limit = 32) {
  return listLivingWorldReactionEvents(snapshot, { reportable: true }, limit)
    .sort((a, b) => b.wanted - a.wanted || b.crimeSeverity - a.crimeSeverity || a.actorId.localeCompare(b.actorId))
    .slice(0, Math.min(32, Math.max(0, Math.floor(finite(limit, 32)))));
}

export function getLivingWorldReactionCombatIntents(snapshot, limit = 16) {
  return listLivingWorldReactionEvents(snapshot, { type: 'combat-intent' }, limit);
}

export function getLivingWorldReactionTransitions(snapshot, limit = 16) {
  return listLivingWorldReactionEvents(snapshot, { type: 'transition' }, limit);
}

export function getLivingWorldReactionPhaseChanges(snapshot, phase) {
  return listLivingWorldReactionActors(snapshot, { phase }).filter((actor) => actor.changed);
}

export function getLivingWorldReactionRelationBuckets(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const buckets = {};
  for (const relation of RELATIONS) {
    buckets[relation] = freeze(normalized.actors.filter((actor) => actor.relation === relation).map((actor) => actor.actorId).sort());
  }
  return freeze(buckets);
}

export function getLivingWorldReactionLodBuckets(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const buckets = {};
  for (const lod of LODS) {
    buckets[lod] = freeze(normalized.actors.filter((actor) => actor.lod === lod).map((actor) => actor.actorId).sort());
  }
  return freeze(buckets);
}

export function getLivingWorldReactionPhaseBuckets(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const buckets = {};
  for (const phase of PHASES) {
    buckets[phase] = freeze(normalized.actors.filter((actor) => actor.phase === phase).map((actor) => actor.actorId).sort());
  }
  return freeze(buckets);
}

export function getLivingWorldReactionProjectionDigest(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const canonical = {
    clockSeconds: normalized.clockSeconds,
    actors: sortActors(normalized.actors).map((actor) => ({
      actorId: actor.actorId,
      phase: actor.phase,
      targetId: actor.targetId,
      lod: actor.lod,
      relation: actor.relation,
      wanted: actor.wanted,
      reportable: actor.reportable,
      directiveKind: actor.directiveKind,
      changed: actor.changed,
    })),
    queue: sortEvents(normalized.queue).map((event) => ({
      type: event.type,
      actorId: event.actorId,
      targetId: event.targetId,
      phase: event.phase,
      lod: event.lod,
      relation: event.relation,
      wanted: event.wanted,
      reportable: event.reportable,
      clockSeconds: event.clockSeconds,
      key: event.key,
    })),
  };
  return digest(canonical);
}

export function auditLivingWorldReactionProjectionSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const errors = [];
  if (normalized.actors.length > LIVING_WORLD_REACTION_PROJECTION_POLICY.maxActors) errors.push('actor-overflow');
  if (normalized.queue.length > LIVING_WORLD_REACTION_PROJECTION_POLICY.maxEvents) errors.push('event-overflow');
  if (!Number.isFinite(normalized.clockSeconds) || normalized.clockSeconds < 0) errors.push('invalid-clock');
  const ids = new Set();
  for (const actor of normalized.actors) {
    if (ids.has(actor.actorId)) errors.push(`duplicate-actor:${actor.actorId}`);
    ids.add(actor.actorId);
    if (!PHASES.includes(actor.phase)) errors.push(`invalid-phase:${actor.actorId}`);
    if (!LODS.includes(actor.lod)) errors.push(`invalid-lod:${actor.actorId}`);
    if (!RELATIONS.includes(actor.relation)) errors.push(`invalid-relation:${actor.actorId}`);
    if (actor.wanted < 0 || actor.wanted > 100) errors.push(`invalid-wanted:${actor.actorId}`);
    if (actor.reputation < -100 || actor.reputation > 100) errors.push(`invalid-reputation:${actor.actorId}`);
  }
  for (const event of normalized.queue) {
    if (!EVENT_TYPES.includes(event.type)) errors.push(`invalid-event-type:${event.actorId}`);
    if (!PHASES.includes(event.phase)) errors.push(`invalid-event-phase:${event.actorId}`);
    if (!LODS.includes(event.lod)) errors.push(`invalid-event-lod:${event.actorId}`);
    if (!Number.isFinite(event.clockSeconds) || event.clockSeconds < 0) errors.push(`invalid-event-clock:${event.actorId}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: getLivingWorldReactionProjectionDigest(normalized) });
}

export function compareLivingWorldReactionProjectionSnapshots(left, right) {
  const a = normalizeSnapshot(left);
  const b = normalizeSnapshot(right);
  const digestA = getLivingWorldReactionProjectionDigest(a);
  const digestB = getLivingWorldReactionProjectionDigest(b);
  const summaryA = summarizeLivingWorldReactionProjection(a);
  const summaryB = summarizeLivingWorldReactionProjection(b);
  const equal = digestA === digestB;
  return freeze({
    equal,
    leftDigest: digestA,
    rightDigest: digestB,
    phaseDelta: Object.fromEntries(PHASES.map((phase) => [phase, summaryB.phaseCounts[phase] - summaryA.phaseCounts[phase]])),
    lodDelta: Object.fromEntries(LODS.map((lod) => [lod, summaryB.lodCounts[lod] - summaryA.lodCounts[lod]])),
    relationDelta: Object.fromEntries(RELATIONS.map((relation) => [relation, summaryB.relationCounts[relation] - summaryA.relationCounts[relation]])),
    eventDelta: Object.fromEntries(EVENT_TYPES.map((type) => [type, summaryB.eventCounts[type] - summaryA.eventCounts[type]])),
  });
}

export function selectLivingWorldReactionForUi(snapshot, options = {}) {
  const maxActors = Math.max(1, Math.min(32, Math.floor(finite(options.maxActors, 12))));
  const maxEvents = Math.max(1, Math.min(32, Math.floor(finite(options.maxEvents, 12))));
  const actors = getLivingWorldReactionActiveActors(snapshot, maxActors);
  const events = getLivingWorldReactionEventPriorities(snapshot, maxEvents);
  const summary = summarizeLivingWorldReactionProjection(snapshot);
  return freeze({
    policyId: LIVING_WORLD_REACTION_PROJECTION_POLICY.id,
    summary,
    actors: freeze(actors),
    events: freeze(events),
    reportableEvents: freeze(getLivingWorldReactionReportableEvents(snapshot, Math.min(8, maxEvents))),
    combatIntents: freeze(getLivingWorldReactionCombatIntents(snapshot, Math.min(8, maxEvents))),
    transitions: freeze(getLivingWorldReactionTransitions(snapshot, Math.min(8, maxEvents))),
    hotspots: freeze(getLivingWorldReactionHotspots(snapshot, Math.min(8, maxActors))),
    digest: getLivingWorldReactionProjectionDigest(snapshot),
  });
}

export function auditLivingWorldReactionUiSelection(selection) {
  const errors = [];
  if (!selection || typeof selection !== 'object') errors.push('selection-missing');
  if (selection?.policyId !== LIVING_WORLD_REACTION_PROJECTION_POLICY.id) errors.push('policy-mismatch');
  if ((selection?.actors?.length ?? 0) > 32) errors.push('ui-actor-overflow');
  if ((selection?.events?.length ?? 0) > 32) errors.push('ui-event-overflow');
  if (selection?.summary?.trackedActors < selection?.actors?.length) errors.push('summary-actor-underflow');
  if (selection?.summary?.queuedEvents < selection?.events?.length) errors.push('summary-event-underflow');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(selection ?? null) });
}

export function livingWorldReactionProjectionDigest(value) {
  return getLivingWorldReactionProjectionDigest(value);
}
