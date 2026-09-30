/**
 * Bounded, deterministic projection ledger for the existing living-world reaction runtime.
 *
 * This module deliberately does not publish events, own actors, mutate controllers, route
 * navigation, start combat, or become an event bus. It turns already-produced
 * livingWorldReactionRuntime tick results into a compact, deterministic read model for
 * UI/event adapters that need stable identities, transition edges, deduplication and bounded
 * retention.
 *
 * Ownership boundary:
 *   reaction runtime -> owns perception/decision/delegation
 *   this ledger     -> owns only a read-only projection of returned tick results
 *   downstream     -> owns actual UI/event delivery
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_REACTION_LEDGER_POLICY = freeze({
  id: 'living-world-reaction-ledger-2026-09-08-v1',
  deterministic: true,
  maxQueueEntries: 96,
  maxEventsPerActor: 6,
  dedupeTtlSeconds: 2.5,
  maxAgeSeconds: 30,
  maxActors: 128,
  maxHistoryPerActor: 8,
});

const VALID_PHASES = freeze(['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee']);
const VALID_LODS = freeze(['near', 'distant', 'far', 'culled']);
const VALID_RELATIONS = freeze(['friendly', 'neutral', 'hostile']);
const VALID_EVENT_TYPES = freeze(['reaction', 'combat-intent', 'transition']);

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

function normalizeClock(value) {
  return Math.max(0, finite(value));
}

function normalizePhase(value) {
  const phase = asId(value, 'patrol');
  return VALID_PHASES.includes(phase) ? phase : 'patrol';
}

function normalizeLod(value) {
  const lod = asId(value, 'near');
  return VALID_LODS.includes(lod) ? lod : 'near';
}

function normalizeRelation(value) {
  const relation = asId(value, 'neutral');
  return VALID_RELATIONS.includes(relation) ? relation : 'neutral';
}

function normalizeTargetId(value) {
  return asId(value, '');
}

function normalizeReason(value) {
  return asId(value, 'state-transition');
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return freeze({ x, z });
}

function normalizeDirective(directive) {
  if (!directive || typeof directive !== 'object') return null;
  const destination = normalizePosition(directive.destination);
  return freeze({
    kind: asId(directive.kind, 'patrol'),
    targetId: normalizeTargetId(directive.targetId),
    destination,
    activityId: asId(directive.activityId, ''),
    locationId: asId(directive.locationId, ''),
    speedMultiplier: clamp(directive.speedMultiplier, 0, 4),
    radiusMeters: Math.max(0, finite(directive.radiusMeters, 0)),
    investigate: Boolean(directive.investigate),
  });
}

function normalizeRelationSnapshot(relation) {
  if (!relation || typeof relation !== 'object') {
    return freeze({
      actorFaction: 'neutral',
      targetFaction: 'neutral',
      reputation: 0,
      relation: 'neutral',
      diplomaticRelation: 'unknown',
      wanted: 0,
      crimeSeverity: 0,
      hostile: false,
      reportable: false,
    });
  }
  const reputation = clamp(relation.reputation, -100, 100);
  const wanted = clamp(relation.wanted, 0, 100);
  const crimeSeverity = clamp(relation.crimeSeverity, 0, 100);
  return freeze({
    actorFaction: asId(relation.actorFaction, 'neutral'),
    targetFaction: asId(relation.targetFaction, 'neutral'),
    reputation,
    relation: normalizeRelation(relation.relation),
    diplomaticRelation: asId(relation.diplomaticRelation, 'unknown'),
    wanted,
    crimeSeverity,
    hostile: Boolean(relation.hostile),
    reportable: Boolean(relation.reportable),
  });
}

function normalizeSignal(signal) {
  if (!signal || typeof signal !== 'object') return null;
  const target = signal.target && typeof signal.target === 'object'
    ? freeze({
      id: normalizeTargetId(signal.target.id),
      position: normalizePosition(signal.target.position),
      source: asId(signal.target.source, 'unknown'),
    })
    : null;
  return freeze({
    id: asId(signal.id, ''),
    kind: asId(signal.kind, 'unknown'),
    confidence: clamp(signal.confidence, 0, 1),
    distanceMeters: Math.max(0, finite(signal.distanceMeters, Infinity)),
    bearingRadians: finite(signal.bearingRadians, 0),
    ageSeconds: Math.max(0, finite(signal.ageSeconds, 0)),
    audible: Boolean(signal.audible),
    visible: Boolean(signal.visible),
    suspicious: Boolean(signal.suspicious),
    severity: clamp(signal.severity, 0, 100),
    target,
  });
}

function normalizeReaction(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const actorId = asId(actor.actorId, '');
  if (!actorId) return null;
  const signal = normalizeSignal(actor.signal);
  const transitionHistory = Array.isArray(actor.history) ? actor.history.slice(-LIVING_WORLD_REACTION_LEDGER_POLICY.maxHistoryPerActor).map((entry) => freeze({
    from: normalizePhase(entry?.from),
    to: normalizePhase(entry?.to),
    reason: normalizeReason(entry?.reason),
    targetId: normalizeTargetId(entry?.targetId),
  })) : [];
  return freeze({
    actorId,
    phase: normalizePhase(actor.phase),
    targetId: normalizeTargetId(actor.targetId),
    lod: normalizeLod(actor.lod),
    elapsedInPhase: Math.max(0, finite(actor.elapsedInPhase)),
    relation: normalizeRelationSnapshot(actor.relation),
    directive: normalizeDirective(actor.directive),
    occupation: actor.occupation && typeof actor.occupation === 'object' ? freeze({
      phase: asId(actor.occupation.phase, 'work'),
      activityId: asId(actor.occupation.activityId, 'idle'),
      locationId: asId(actor.occupation.locationId, ''),
      shouldTravel: Boolean(actor.occupation.shouldTravel),
    }) : null,
    navigation: actor.navigation && typeof actor.navigation === 'object' ? freeze({
      accepted: actor.navigation.accepted !== false,
      invoked: Boolean(actor.navigation.invoked),
    }) : null,
    combat: actor.combat && typeof actor.combat === 'object' ? freeze({
      accepted: actor.combat.accepted !== false,
      invoked: Boolean(actor.combat.invoked),
    }) : null,
    law: actor.law && typeof actor.law === 'object' ? freeze({
      accepted: actor.law.accepted !== false,
      invoked: Boolean(actor.law.invoked),
    }) : null,
    worldEvent: actor.worldEvent && typeof actor.worldEvent === 'object' ? freeze({
      accepted: actor.worldEvent.accepted !== false,
      invoked: Boolean(actor.worldEvent.invoked),
    }) : null,
    signal,
    cachedSignalCount: Math.max(0, Math.floor(finite(actor.cachedSignalCount))),
    history: freeze(transitionHistory),
    digest: asId(actor.digest, ''),
  });
}

function normalizeTickResult(result) {
  const results = Array.isArray(result?.results) ? result.results.map(normalizeReaction).filter(Boolean) : [];
  return freeze({
    accepted: result?.accepted === true,
    tick: Math.max(0, Math.floor(finite(result?.tick))),
    clockSeconds: normalizeClock(result?.clockSeconds),
    actorCount: Math.max(0, Math.floor(finite(result?.actorCount, results.length))),
    simulatedActors: Math.max(0, Math.floor(finite(result?.simulatedActors))),
    results: freeze(results.slice(0, LIVING_WORLD_REACTION_LEDGER_POLICY.maxActors)),
    stats: result?.stats && typeof result.stats === 'object' ? freeze({
      tickCount: Math.max(0, Math.floor(finite(result.stats.tickCount))),
      emittedEvents: Math.max(0, Math.floor(finite(result.stats.emittedEvents))),
      trackedActors: Math.max(0, Math.floor(finite(result.stats.trackedActors))),
    }) : freeze({ tickCount: 0, emittedEvents: 0, trackedActors: results.length }),
    policyId: asId(result?.policyId, ''),
    digest: asId(result?.digest, ''),
  });
}

function phaseChanged(previous, current) {
  return Boolean(previous && current && previous !== current);
}

function transitionKey(actorId, from, to, targetId, reason) {
  return `${actorId}|${from}|${to}|${targetId}|${reason}`;
}

function reactionKey(actor, clockSeconds) {
  const digestPart = actor.digest || digest({ actorId: actor.actorId, phase: actor.phase, targetId: actor.targetId, lod: actor.lod });
  return `${actor.actorId}|${actor.phase}|${actor.targetId}|${digestPart}|${Math.floor(clockSeconds * 10)}`;
}

function eventPriority(event) {
  if (event.type === 'combat-intent') return 3;
  if (event.type === 'transition') return 2;
  return 1;
}

function eventSortKey(event) {
  return [
    -eventPriority(event),
    event.actorId,
    event.type,
    event.phase,
    event.targetId,
    event.key,
  ].join('|');
}

function trimQueue(queue, maxQueueEntries) {
  if (queue.length <= maxQueueEntries) return queue;
  return queue.slice(queue.length - maxQueueEntries);
}

function trimActorWindow(entries, maxEventsPerActor) {
  if (entries.length <= maxEventsPerActor) return entries;
  return entries.slice(entries.length - maxEventsPerActor);
}

function transitionFromHistory(history, previousPhase, currentPhase, targetId) {
  if (phaseChanged(previousPhase, currentPhase)) {
    const existing = history[history.length - 1];
    if (existing?.from === previousPhase && existing?.to === currentPhase && existing?.targetId === targetId) {
      return freeze(existing);
    }
    return freeze({ from: previousPhase, to: currentPhase, reason: 'projection-observed-change', targetId });
  }
  return null;
}

function makeReactionEvent(reaction, tickResult, sequence) {
  const relation = reaction.relation;
  const eventType = reaction.phase === 'attack' ? 'combat-intent' : 'reaction';
  return freeze({
    sequence,
    type: eventType,
    clockSeconds: tickResult.clockSeconds,
    tick: tickResult.tick,
    actorId: reaction.actorId,
    targetId: reaction.targetId,
    phase: reaction.phase,
    lod: reaction.lod,
    relation: relation.relation,
    wanted: relation.wanted,
    crimeSeverity: relation.crimeSeverity,
    reportable: relation.reportable,
    directive: reaction.directive,
    digest: reaction.digest || digest({ actorId: reaction.actorId, phase: reaction.phase, targetId: reaction.targetId }),
    key: reactionKey(reaction, tickResult.clockSeconds),
  });
}

function makeTransitionEvent(reaction, previousPhase, tickResult, sequence, reason = 'projection-observed-change') {
  const key = transitionKey(reaction.actorId, previousPhase, reaction.phase, reaction.targetId, reason);
  return freeze({
    sequence,
    type: 'transition',
    clockSeconds: tickResult.clockSeconds,
    tick: tickResult.tick,
    actorId: reaction.actorId,
    targetId: reaction.targetId,
    phase: reaction.phase,
    lod: reaction.lod,
    relation: reaction.relation.relation,
    wanted: reaction.relation.wanted,
    crimeSeverity: reaction.relation.crimeSeverity,
    reportable: reaction.relation.reportable,
    directive: reaction.directive,
    from: previousPhase,
    to: reaction.phase,
    reason,
    digest: digest({ actorId: reaction.actorId, from: previousPhase, to: reaction.phase, targetId: reaction.targetId, reason }),
    key,
  });
}

function normalizeOptions(options = {}) {
  return freeze({
    maxQueueEntries: Math.max(1, Math.min(LIVING_WORLD_REACTION_LEDGER_POLICY.maxQueueEntries, Math.floor(finite(options.maxQueueEntries, LIVING_WORLD_REACTION_LEDGER_POLICY.maxQueueEntries)))),
    maxEventsPerActor: Math.max(1, Math.min(LIVING_WORLD_REACTION_LEDGER_POLICY.maxEventsPerActor, Math.floor(finite(options.maxEventsPerActor, LIVING_WORLD_REACTION_LEDGER_POLICY.maxEventsPerActor)))),
    dedupeTtlSeconds: Math.max(0, Math.min(LIVING_WORLD_REACTION_LEDGER_POLICY.dedupeTtlSeconds, finite(options.dedupeTtlSeconds, LIVING_WORLD_REACTION_LEDGER_POLICY.dedupeTtlSeconds))),
    maxAgeSeconds: Math.max(1, Math.min(LIVING_WORLD_REACTION_LEDGER_POLICY.maxAgeSeconds, finite(options.maxAgeSeconds, LIVING_WORLD_REACTION_LEDGER_POLICY.maxAgeSeconds))),
  });
}

function buildActorProjection(reaction, previous, clockSeconds) {
  return freeze({
    actorId: reaction.actorId,
    phase: reaction.phase,
    targetId: reaction.targetId,
    lod: reaction.lod,
    relation: reaction.relation,
    directiveKind: reaction.directive?.kind || 'none',
    hasSignal: Boolean(reaction.signal),
    cachedSignalCount: reaction.cachedSignalCount,
    elapsedInPhase: reaction.elapsedInPhase,
    clockSeconds,
    previousPhase: previous?.phase || '',
    changed: phaseChanged(previous?.phase, reaction.phase),
    digest: digest({
      actorId: reaction.actorId,
      phase: reaction.phase,
      targetId: reaction.targetId,
      lod: reaction.lod,
      relation: reaction.relation.relation,
    }),
  });
}

function sortEvents(events) {
  return [...events].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)) || a.sequence - b.sequence);
}

export function normalizeLivingWorldReactionTick(result) {
  return normalizeTickResult(result);
}

export function projectLivingWorldReactionEvents(result) {
  const tick = normalizeTickResult(result);
  if (!tick.accepted) return freeze([]);
  const events = [];
  let sequence = 0;
  for (const reaction of tick.results) {
    if (reaction.phase !== 'patrol' || reaction.relation.reportable || reaction.relation.hostile) {
      events.push(makeReactionEvent(reaction, tick, sequence));
      sequence += 1;
    }
    if (reaction.history.length) {
      const last = reaction.history[reaction.history.length - 1];
      if (last && last.from !== last.to) {
        events.push(freeze({
          ...makeTransitionEvent(reaction, last.from, tick, sequence, last.reason),
          transitionEvidence: 'runtime-history',
        }));
        sequence += 1;
      }
    }
  }
  return freeze(sortEvents(events));
}

export function createLivingWorldReactionLedger({ options = {} } = {}) {
  const policy = normalizeOptions(options);
  const queue = [];
  const actorState = new Map();
  const recentKeys = new Map();
  let sequence = 0;
  let acceptedTicks = 0;
  let rejectedTicks = 0;
  let projectedEvents = 0;
  let droppedEvents = 0;
  let duplicateEvents = 0;
  let lastClockSeconds = 0;
  let disposed = false;

  function purgeExpired(clockSeconds) {
    for (const [key, seenAt] of recentKeys) {
      if (clockSeconds - seenAt > policy.dedupeTtlSeconds) recentKeys.delete(key);
    }
    while (queue.length && clockSeconds - queue[0].clockSeconds > policy.maxAgeSeconds) queue.shift();
  }

  function countActorEvents(actorId) {
    let count = 0;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].actorId === actorId) count += 1;
      if (count >= policy.maxEventsPerActor) break;
    }
    return count;
  }

  function ingest(result) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed', events: freeze([]), snapshot: snapshot() });
    const tick = normalizeTickResult(result);
    if (!tick.accepted) {
      rejectedTicks += 1;
      return freeze({ accepted: false, reason: 'tick-not-accepted', events: freeze([]), snapshot: snapshot() });
    }
    acceptedTicks += 1;
    lastClockSeconds = Math.max(lastClockSeconds, tick.clockSeconds);
    purgeExpired(lastClockSeconds);
    const projected = [];
    for (const reaction of tick.results) {
      const previous = actorState.get(reaction.actorId) || null;
      const actorProjection = buildActorProjection(reaction, previous, tick.clockSeconds);
      actorState.set(reaction.actorId, actorProjection);
      if (reaction.phase !== 'patrol' || reaction.relation.reportable || reaction.relation.hostile) {
        projected.push(makeReactionEvent(reaction, tick, sequence));
        sequence += 1;
      }
      const observedTransition = transitionFromHistory(reaction.history, previous?.phase, reaction.phase, reaction.targetId);
      if (observedTransition) {
        projected.push(makeTransitionEvent(reaction, observedTransition.from, tick, sequence, observedTransition.reason));
        sequence += 1;
      }
    }

    const normalizedEvents = [];
    for (const event of projected) {
      projectedEvents += 1;
      if (recentKeys.has(event.key)) {
        duplicateEvents += 1;
        continue;
      }
      recentKeys.set(event.key, tick.clockSeconds);
      if (countActorEvents(event.actorId) >= policy.maxEventsPerActor) {
        droppedEvents += 1;
        continue;
      }
      normalizedEvents.push(event);
      queue.push(event);
    }

    const sorted = sortEvents(normalizedEvents);
    const trimmed = trimQueue(queue, policy.maxQueueEntries);
    if (trimmed.length !== queue.length) droppedEvents += queue.length - trimmed.length;
    queue.length = 0;
    queue.push(...trimmed);
    return freeze({
      accepted: true,
      tick: tick.tick,
      clockSeconds: tick.clockSeconds,
      events: freeze(sorted),
      snapshot: snapshot(),
    });
  }

  function drain(limit = policy.maxQueueEntries) {
    if (disposed) return freeze([]);
    const count = Math.max(0, Math.min(policy.maxQueueEntries, Math.floor(finite(limit, policy.maxQueueEntries))));
    const drained = queue.splice(0, count);
    return freeze(drained);
  }

  function snapshot() {
    const actors = [...actorState.values()].sort((a, b) => a.actorId.localeCompare(b.actorId));
    return freeze({
      policyId: LIVING_WORLD_REACTION_LEDGER_POLICY.id,
      acceptedTicks,
      rejectedTicks,
      projectedEvents,
      droppedEvents,
      duplicateEvents,
      queuedEvents: queue.length,
      trackedActors: actors.length,
      clockSeconds: lastClockSeconds,
      actors: freeze(actors.map((actor) => freeze({ ...actor }))),
      queue: freeze([...queue]),
      digest: digest({ acceptedTicks, rejectedTicks, projectedEvents, droppedEvents, duplicateEvents, queue, actors }),
    });
  }

  function audit() {
    const errors = [];
    const snap = snapshot();
    if (snap.queuedEvents > policy.maxQueueEntries) errors.push('queue-overflow');
    if (snap.trackedActors > LIVING_WORLD_REACTION_LEDGER_POLICY.maxActors) errors.push('actor-overflow');
    for (const event of snap.queue) {
      if (!VALID_EVENT_TYPES.includes(event.type)) errors.push(`invalid-event-type:${event.actorId}`);
      if (!VALID_PHASES.includes(event.phase)) errors.push(`invalid-event-phase:${event.actorId}`);
      if (!VALID_LODS.includes(event.lod)) errors.push(`invalid-event-lod:${event.actorId}`);
      if (event.clockSeconds < 0 || !Number.isFinite(event.clockSeconds)) errors.push(`invalid-event-clock:${event.actorId}`);
      if (event.relation && !VALID_RELATIONS.includes(event.relation)) errors.push(`invalid-event-relation:${event.actorId}`);
    }
    for (const actor of snap.actors) {
      if (!VALID_PHASES.includes(actor.phase)) errors.push(`invalid-actor-phase:${actor.actorId}`);
      if (!VALID_LODS.includes(actor.lod)) errors.push(`invalid-actor-lod:${actor.actorId}`);
      if (actor.cachedSignalCount < 0) errors.push(`invalid-actor-signal-count:${actor.actorId}`);
    }
    return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest({ policyId: snap.policyId, errors }) });
  }

  function reset() {
    queue.length = 0;
    actorState.clear();
    recentKeys.clear();
    sequence = 0;
    acceptedTicks = 0;
    rejectedTicks = 0;
    projectedEvents = 0;
    droppedEvents = 0;
    duplicateEvents = 0;
    lastClockSeconds = 0;
    disposed = false;
    return true;
  }

  function dispose() {
    disposed = true;
    queue.length = 0;
    actorState.clear();
    recentKeys.clear();
    return true;
  }

  return {
    ingest,
    drain,
    snapshot,
    audit,
    reset,
    dispose,
    get disposed() { return disposed; },
  };
}

export function auditLivingWorldReactionLedgerSnapshot(snapshotValue) {
  const errors = [];
  const snapshotData = snapshotValue && typeof snapshotValue === 'object' ? snapshotValue : null;
  if (!snapshotData) return freeze({ ok: false, errors: freeze(['snapshot-missing']), digest: digest(null) });
  if (snapshotData.queuedEvents > LIVING_WORLD_REACTION_LEDGER_POLICY.maxQueueEntries) errors.push('queue-overflow');
  if (snapshotData.trackedActors > LIVING_WORLD_REACTION_LEDGER_POLICY.maxActors) errors.push('actor-overflow');
  if (snapshotData.clockSeconds < 0 || !Number.isFinite(snapshotData.clockSeconds)) errors.push('invalid-clock');
  for (const actor of snapshotData.actors ?? []) {
    if (!VALID_PHASES.includes(actor.phase)) errors.push(`invalid-phase:${actor.actorId}`);
    if (!VALID_LODS.includes(actor.lod)) errors.push(`invalid-lod:${actor.actorId}`);
    if (actor.cachedSignalCount > 12) errors.push(`signal-overflow:${actor.actorId}`);
  }
  for (const event of snapshotData.queue ?? []) {
    if (!VALID_EVENT_TYPES.includes(event.type)) errors.push(`invalid-event-type:${event.actorId}`);
    if (!VALID_PHASES.includes(event.phase)) errors.push(`invalid-event-phase:${event.actorId}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(snapshotData) });
}

export function livingWorldReactionLedgerDigest(value) {
  return digest(value);
}
